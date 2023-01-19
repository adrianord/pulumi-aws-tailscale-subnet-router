import { ComponentResource, ComponentResourceOptions, Config, interpolate, output, Output } from "@pulumi/pulumi";
import { DeviceSubnetRoutes, getDeviceOutput } from "@pulumi/tailscale";
import { cloudwatch } from "@pulumi/aws";
import { GetVpcResult, Vpc } from "@pulumi/aws/ec2";
import { ensureAuthKeySecret } from "./secrets";
import { createEcsRoles } from "./iam";
import { createEfsFileSystem } from "./efs";
import { ensureDockerImage } from "./image";
import { createEcsService } from "./ecs";

export type SubnetRouterOptions = {
    /**
     * Vpc to deploy subnet router to
     */
    vpc: Output<Vpc> | Output<GetVpcResult>,
    /**
     * Subnet ids associated with EFS
     */
    subnetIds: Output<string[]>
    /**
     * Security groups associated with EFS
     */
    securityGroupIds: Output<string[]>,
    /**
     * Existing ECS Cluster name. If empty, one will be created
     */
    targetEcsCluster?: string,
    /**
     * Name or arn, if empty an auth key and secret will be made using the tailscale provider
     */
    tailscaleAuthKeySecret?: string,
    /**
     * Existing tailscale docker image name. If empty, prepackaged docker image will be built and used
     */
    tailscaleImage?: string,
};

export class SubnetRouter extends ComponentResource {
    constructor(name: string, args: SubnetRouterOptions, opts?: ComponentResourceOptions) {
        const type = "awsTailscale:index:subnetRouter";
        super(type, name, args, opts);

        const vpcName = args.vpc.id;
        const deviceName = interpolate`${vpcName}-tailscale`;
        const awsConfig = new Config("aws");

        const authKeySecret = ensureAuthKeySecret(args.tailscaleAuthKeySecret, { parent: this });

        const logGroup = new cloudwatch.LogGroup("tailscale", {
            name: interpolate`/ecs/${vpcName}-tailscale`,
            retentionInDays: 1,
        }, { parent: this });

        const ecsRoles = createEcsRoles({
            vpcName: vpcName,
            authKeySecretArn: authKeySecret.arn,
            logGroupArn: logGroup.arn,
        }, { parent: this });


        const efs = createEfsFileSystem({
            vpcName,
            subnetIds: args.subnetIds,
            securityGroupIds: args.securityGroupIds,
        }, { parent: this });

        const image = ensureDockerImage({
            tailscaleImage: args.tailscaleImage,
        }, { parent: this });

        const service = createEcsService({
            vpcName: vpcName,
            region: awsConfig.require("region"),
            taskExecutionRoleArn: ecsRoles.taskExecutionRole.arn,
            taskRoleArn: ecsRoles.taskRole.arn,
            fileSystemId: efs.fileSystem.id,
            accessPointName: output(efs.accessPointName),
            deviceName: output(deviceName),
            authKeySecretId: authKeySecret.id,
            imageName: image.imageName,
            logGroupName: logGroup.name,
            cidrBlock: args.vpc.cidrBlock,
            securityGroupIds: args.securityGroupIds,
            subnetIds: args.subnetIds,
            clusterName: args.targetEcsCluster,

        }, { parent: this });

        service.service.name.apply(() => {
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