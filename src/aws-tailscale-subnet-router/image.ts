import { Repository } from "@pulumi/aws/ecr";
import { Image } from "@pulumi/awsx/ecr";
import { ComponentResourceOptions, output, Output } from "@pulumi/pulumi";

/** @internal */
export type EnsureDockerImageArgs = {
    tailscaleImage?: string,
}

/** @internal */
export type EnsureDockerImageResult = {
    imageName: Output<string>,
}

/** @internal */
export function ensureDockerImage(args: EnsureDockerImageArgs, opts?: ComponentResourceOptions): EnsureDockerImageResult {
    if (args.tailscaleImage) {
        return {
            imageName: output(args.tailscaleImage),
        };
    }
    const repo = new Repository("tailscale", {}, opts);

    const image = new Image("tailscale", {
        repositoryUrl: repo.repositoryUrl,
        dockerfile: "docker/tailscale.Dockerfile",
        path: "docker",
        env: {
            "DOCKER_BUILDKIT": "1",
        },
        extraOptions: ["--platform", "linux/amd64"],
    }, opts);
    return {
        imageName: image.imageUri,
    };
}