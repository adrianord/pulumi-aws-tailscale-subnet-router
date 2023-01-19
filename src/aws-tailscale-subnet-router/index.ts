import { all, ComponentResource, ComponentResourceOptions, Config, Input, interpolate, Output } from "@pulumi/pulumi";
import { DeviceSubnetRoutes, getDeviceOutput, TailnetKey } from "@pulumi/tailscale";
import { getSecretOutput, GetSecretOutputArgs, GetSecretResult, Secret, SecretVersion } from "@pulumi/aws/secretsmanager";
import { Role, RolePolicyAttachment, Policy, PolicyDocument } from "@pulumi/aws/iam";
import { cloudwatch } from "@pulumi/aws";
import { AccessPoint, FileSystem, MountTarget } from "@pulumi/aws/efs";
import { Vpc } from "@pulumi/aws/ec2";
import { Repository } from "@pulumi/aws/ecr";
import { Cluster, Service, TaskDefinition } from "@pulumi/aws/ecs";
import { Image } from "@pulumi/awsx/ecr";

export type SubnetRouterOptions = {
    vpc: Output<Vpc>,
    subnetIds: Output<string[]>
    securityGroupIds: Input<string[]>,
    targetEcsCluster?: string,
    /**
     * Name or arn, if empty an auth key and secret will be made using the tailscale provider
     */
    tailscaleAuthKeySecret?: string,
};

function getAuthKeySecret(authKeySecret: string, opts?: ComponentResourceOptions): Output<GetSecretResult> {
    const args: GetSecretOutputArgs = authKeySecret.startsWith("arn:aws:secretsmanager")
        ? { arn: authKeySecret }
        : { name: authKeySecret };
    const secret = getSecretOutput(args, opts);
    return secret;
}

function createAuthKeySecret(opts?: ComponentResourceOptions): Secret {
    const authKey = new TailnetKey("auth-key", {
        preauthorized: true,
        reusable: true,
    }, opts);
    const secret = new Secret("tailscale-auth-key-secret", {}, opts);
    new SecretVersion("tailscale-auth-key-secret", {
        secretId: secret.id,
        secretString: authKey.key,
    }, opts);
    return secret;
}

function ensureAuthKeySecret(authKeySecretArn?: string, opts?: ComponentResourceOptions): Output<GetSecretResult> | Secret {
    return authKeySecretArn
        ? getAuthKeySecret(authKeySecretArn, opts)
        : createAuthKeySecret(opts);
}

export class SubnetRouter extends ComponentResource {
    constructor(name: string, args: SubnetRouterOptions, opts?: ComponentResourceOptions) {
        const type = "awsTailscale:index:subnetRouter";
        super(type, name, args, opts);
        const vpcName = args.vpc.id;
        const deviceName = interpolate`${vpcName}-tailscale`;
        const authKeySecret = ensureAuthKeySecret(args.tailscaleAuthKeySecret, { parent: this });
        const awsConfig = new Config("aws");
        // IAM
        const assumeRolePolicy: PolicyDocument = {
            Version: "2012-10-17",
            Statement: [{
                Action: ["sts:AssumeRole"],
                Effect: "Allow",
                Principal: {
                    Service: "ecs-tasks.amazonaws.com",
                },
            }],
        };

        const taskExecutionRole = new Role("tailscale_task_execution", {
            name: interpolate`esc-task-execution-${vpcName}-tailscale`,
            assumeRolePolicy: assumeRolePolicy,
        }, { parent: this });
        new RolePolicyAttachment("tailscale_task_execution", {
            role: taskExecutionRole.name,
            policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
        }, { parent: this });


        const secretsPolicy = new Policy("tailscale_task_secrets_policy", {
            name: interpolate`ecs-task-secrets-${vpcName}-tailscale`,
            description: interpolate`Permissions for ECS task execution to read secrets for Tailscale in VPC ${vpcName}`,
            policy: {
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Action: "secretsmanager:GetSecretValue",
                    Resource: authKeySecret.arn,
                }],
            },
        }, { parent: this });
        new RolePolicyAttachment("tailscale_task_secrets", {
            role: taskExecutionRole.name,
            policyArn: secretsPolicy.arn,
        }, { parent: this });

        const taskRole = new Role("tailscale_task", {
            name: interpolate`ecs-task-${vpcName}-tailscale`,
            assumeRolePolicy: assumeRolePolicy,
        }, { parent: this });

        const logGroup = new cloudwatch.LogGroup("tailscale", {
            name: interpolate`/ecs/${vpcName}-tailscale`,
            retentionInDays: 1,
        }, { parent: this });
        const taskLogsPolicy = new Policy("tailscale-task-logs", {
            name: interpolate`ecs-task-logs-${vpcName}-tailscale`,
            description: interpolate`Permissions for ECS task to write logs for Tailscale to VPC ${vpcName}`,
            policy: {
                Version: "2012-10-17",
                Statement: [
                    {
                        Effect: "Allow",
                        Action: ["logs:DescribeLogGroups"],
                        Resource: ["*"],
                    },
                    {
                        Effect: "Allow",
                        Action: [
                            "logs:CreateLogStream",
                            "logs:DescribeLogStreams",
                            "logs:PutLogEvents",
                        ],
                        Resource: [logGroup.arn],
                    },
                ],
            },
        }, { parent: this });

        new RolePolicyAttachment("tailscale-task-logs", {
            role: taskRole.name,
            policyArn: taskLogsPolicy.arn,
        }, { parent: this });

        // EFS
        const efsFileSystem = new FileSystem("tailscale", {
            creationToken: interpolate`${vpcName}-tailscale`,
            lifecyclePolicies: [
                {
                    transitionToIa: "AFTER_30_DAYS",
                },
                {
                    transitionToPrimaryStorageClass: "AFTER_1_ACCESS",
                },
            ],
            tags: {
                Name: interpolate`${vpcName}-tailscale`,
            },
        }, { parent: this });

        const accessPointName = "var-lib-tailscale";
        new AccessPoint("tailscale", {
            fileSystemId: efsFileSystem.id,
            rootDirectory: {
                path: "/var/lib/tailscale",
            },
            tags: {
                Name: accessPointName,
            },
        }, { parent: this });

        args.subnetIds.apply(x => [...new Set(x)].map(y => (new MountTarget(`primary-${y}`, {
            fileSystemId: efsFileSystem.id,
            subnetId: y,
            securityGroups: args.securityGroupIds,
        }, {
            parent: this,
            deleteBeforeReplace: true,
        }))));

        const repo = new Repository("tailscale", {}, { parent: this });

        const image = new Image("tailscale", {
            repositoryUrl: repo.repositoryUrl,
            dockerfile: "docker/tailscale.Dockerfile",
            path: "docker",
            env: {
                "DOCKER_BUILDKIT": "1",
            },
            extraOptions: ["--platform", "linux/amd64"],
        }, { parent: this });

        const taskDefinition = new TaskDefinition("tailscale", {
            family: interpolate`${vpcName}-tailscale`,
            requiresCompatibilities: ["FARGATE"],
            networkMode: "awsvpc",
            cpu: "256",
            memory: "512",
            executionRoleArn: taskExecutionRole.arn,
            taskRoleArn: taskRole.arn,
            volumes: [{
                name: accessPointName,
                efsVolumeConfiguration: {
                    fileSystemId: efsFileSystem.id,
                    transitEncryption: "ENABLED",
                },
            }],
            containerDefinitions: all([image.imageUri, deviceName, authKeySecret.id, logGroup.name, args.vpc.cidrBlock])
                .apply(([imageName, deviceName, secretId, logGroupName, cidrBlock]) => JSON.stringify([{
                    name: "tailscale",
                    image: imageName,
                    essential: true,
                    cpu: 256,
                    memory: 512,
                    memoryReservation: 512,
                    environment: [
                        {
                            name: "TAILSCALE_HOSTNAME",
                            value: deviceName,
                        },
                        {
                            name: "TAILSCALE_ADVERTISE_ROUTES",
                            value: cidrBlock,
                        },
                    ],
                    secrets: [
                        {
                            name: "TAILSCALE_AUTH_KEY",
                            valueFrom: secretId,
                        },
                    ],
                    mountPoints: [{
                        containerPath: "/var/lib/tailscale",
                        sourceVolume: accessPointName,
                        readOnly: false,
                    }],
                    healthCheck: {
                        command: ["tailscale", "status"],
                        interval: 30,
                        timeout: 5,
                        retries: 3,
                        startPeriod: 0,
                    },
                    linuxParameters: {
                        initProcessEnabled: true,
                    },
                    logConfiguration: {
                        logDriver: "awslogs",
                        options: {
                            "awslogs-group": logGroupName,
                            "awslogs-region": awsConfig.require("region"),
                            "awslogs-stream-prefix": "ecs",
                        },
                    },
                }])),
        }, { parent: this });

        const cluster = new Cluster("tailscale", {
            name: interpolate`tailscale-${vpcName}`,
        });

        const service = new Service("tailscale", {
            name: "tailscale",
            cluster: cluster.id,
            taskDefinition: taskDefinition.arn,
            desiredCount: 1,
            launchType: "FARGATE",
            enableExecuteCommand: true,
            deploymentController: {
                type: "ECS",
            },
            deploymentCircuitBreaker: {
                enable: false,
                rollback: false,
            },
            networkConfiguration: {
                assignPublicIp: false,
                securityGroups: args.securityGroupIds,
                subnets: args.subnetIds,
            },
        }, { parent: this });

        service.name.apply(() => {
            const device = getDeviceOutput({
                name: interpolate`${deviceName}.tailc9b40.ts.net`,
                waitFor: "5m",
            });
            new DeviceSubnetRoutes("tailscale", {
                deviceId: device.id,
                routes: [args.vpc.cidrBlock],
            }, { parent: this });
        });
    }
}