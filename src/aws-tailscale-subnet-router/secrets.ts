import { getSecretOutput, GetSecretOutputArgs, GetSecretResult, Secret, SecretVersion } from "@pulumi/aws/secretsmanager";
import { ComponentResourceOptions, Output } from "@pulumi/pulumi";
import { TailnetKey } from "@pulumi/tailscale";

/** @internal */
export function getAuthKeySecret(authKeySecret: string, opts?: ComponentResourceOptions): Output<GetSecretResult> {
    const args: GetSecretOutputArgs = authKeySecret.startsWith("arn:aws:secretsmanager")
        ? { arn: authKeySecret }
        : { name: authKeySecret };
    const secret = getSecretOutput(args, opts);
    return secret;
}

/** @internal */
export function createAuthKeySecret(opts?: ComponentResourceOptions): Secret {
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

/** @internal */
export function ensureAuthKeySecret(authKeySecretArn?: string, opts?: ComponentResourceOptions): Output<GetSecretResult> | Secret {
    return authKeySecretArn
        ? getAuthKeySecret(authKeySecretArn, opts)
        : createAuthKeySecret(opts);
}

