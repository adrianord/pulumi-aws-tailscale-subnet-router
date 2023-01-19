import { ComponentResourceOptions, interpolate, Output } from "@pulumi/pulumi";
import { AccessPoint, FileSystem, MountTarget } from "@pulumi/aws/efs";

/** @internal */
export type CreateEfsFileSystemArgs = {
    vpcName: Output<string>,
    subnetIds: Output<string[]>,
    securityGroupIds: Output<string[]>
};

/** @internal */
export type CreateEfsFileSystemResult = {
    accessPointName: string,
    fileSystem: FileSystem,
};

/** @internal */
export function createEfsFileSystem(args: CreateEfsFileSystemArgs, opts?: ComponentResourceOptions): CreateEfsFileSystemResult {
    const fileSystem = new FileSystem("tailscale", {
        creationToken: interpolate`${args.vpcName}-tailscale`,
        lifecyclePolicies: [
            {
                transitionToIa: "AFTER_30_DAYS",
            },
            {
                transitionToPrimaryStorageClass: "AFTER_1_ACCESS",
            },
        ],
        tags: {
            Name: interpolate`${args.vpcName}-tailscale`,
        },
    }, opts);

    const accessPointName = "var-lib-tailscale";
    new AccessPoint("tailscale", {
        fileSystemId: fileSystem.id,
        rootDirectory: {
            path: "/var/lib/tailscale",
        },
        tags: {
            Name: accessPointName,
        },
    }, opts);

    args.subnetIds.apply(x => [...new Set(x)].map(y => (new MountTarget(`primary-${y}`, {
        fileSystemId: fileSystem.id,
        subnetId: y,
        securityGroups: args.securityGroupIds,
    }, {
        ...opts,
        deleteBeforeReplace: true,
    }))));
    return {
        accessPointName,
        fileSystem,
    };
}