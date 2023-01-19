import { getClusterOutput, Cluster, Service, TaskDefinition } from "@pulumi/aws/ecs";
import { all, ComponentResourceOptions, interpolate, Output } from "@pulumi/pulumi";

/** @internal */
export function ensureCluster(vpcName: Output<string>, clusterName?: string, opts?: ComponentResourceOptions) {
    return clusterName
        ? getClusterOutput({ clusterName }, opts)
        : new Cluster("tailscale", {
            name: interpolate`tailscale-${vpcName}`,
        }, opts);
}

/** @internal */
export type CreateEcsServiceArgs = {
    vpcName: Output<string>,
    taskRoleArn: Output<string>,
    taskExecutionRoleArn: Output<string>,
    accessPointName: Output<string>,
    fileSystemId: Output<string>,
    imageName: Output<string>,
    deviceName: Output<string>,
    authKeySecretId: Output<string>,
    logGroupName: Output<string>,
    cidrBlock: Output<string>,
    region: string,
    subnetIds: Output<string[]>,
    securityGroupIds: Output<string[]>,
    clusterName?: string,
}

/** @internal */
export type CreateEcsServiceResult = {
    service: Service,
}

/** @internal */
export function createEcsService(args: CreateEcsServiceArgs, opts?: ComponentResourceOptions): CreateEcsServiceResult {
    const taskDefinition = new TaskDefinition("tailscale", {
        family: interpolate`${args.vpcName}-tailscale`,
        requiresCompatibilities: ["FARGATE"],
        networkMode: "awsvpc",
        cpu: "256",
        memory: "512",
        executionRoleArn: args.taskExecutionRoleArn,
        taskRoleArn: args.taskRoleArn,
        volumes: [{
            name: args.accessPointName,
            efsVolumeConfiguration: {
                fileSystemId: args.fileSystemId,
                transitEncryption: "ENABLED",
            },
        }],
        containerDefinitions: all([args.imageName, args.deviceName, args.authKeySecretId, args.logGroupName, args.cidrBlock, args.accessPointName])
            .apply(([imageName, deviceName, secretId, logGroupName, cidrBlock, accessPointName]) => JSON.stringify([{
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
                        "awslogs-region": args.region,
                        "awslogs-stream-prefix": "ecs",
                    },
                },
            }])),
    }, opts);

    const cluster = ensureCluster(args.vpcName, args.clusterName);

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
    }, opts);

    return {
        service,
    };
}