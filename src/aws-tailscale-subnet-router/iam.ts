import { Policy, PolicyDocument, Role, RolePolicyAttachment } from "@pulumi/aws/iam";
import { ComponentResourceOptions, interpolate, Output } from "@pulumi/pulumi";

/** @internal */
export type CreateEcsRolesArgs = {
    vpcName: Output<string>,
    authKeySecretArn: Output<string>
    logGroupArn: Output<string>
};

/** @internal */
export type CreateEcsRolesResult = {
    taskRole: Role,
    taskExecutionRole: Role,
};

/** @internal */
export function createEcsRoles(args: CreateEcsRolesArgs, opts?: ComponentResourceOptions): CreateEcsRolesResult {
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
        name: interpolate`esc-task-execution-${args.vpcName}-tailscale`,
        assumeRolePolicy: assumeRolePolicy,
    }, opts);

    new RolePolicyAttachment("tailscale_task_execution", {
        role: taskExecutionRole.name,
        policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
    }, opts);


    const secretsPolicy = new Policy("tailscale_task_secrets_policy", {
        name: interpolate`ecs-task-secrets-${args.vpcName}-tailscale`,
        description: interpolate`Permissions for ECS task execution to read secrets for Tailscale in VPC ${args.vpcName}`,
        policy: {
            Version: "2012-10-17",
            Statement: [{
                Effect: "Allow",
                Action: "secretsmanager:GetSecretValue",
                Resource: args.authKeySecretArn,
            }],
        },
    }, opts);

    new RolePolicyAttachment("tailscale_task_secrets", {
        role: taskExecutionRole.name,
        policyArn: secretsPolicy.arn,
    }, opts);

    const taskRole = new Role("tailscale_task", {
        name: interpolate`ecs-task-${args.vpcName}-tailscale`,
        assumeRolePolicy: assumeRolePolicy,
    }, opts);

    const logsPolicy = new Policy("tailscale-task-logs", {
        name: interpolate`ecs-task-logs-${args.vpcName}-tailscale`,
        description: interpolate`Permissions for ECS task to write logs for Tailscale to VPC ${args.vpcName}`,
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
                    Resource: [args.logGroupArn],
                },
            ],
        },
    }, opts);

    new RolePolicyAttachment("tailscale-task-logs", {
        role: taskRole.name,
        policyArn: logsPolicy.arn,
    }, opts);

    return {
        taskRole,
        taskExecutionRole,
    };
}