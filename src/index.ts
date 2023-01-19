import { SubnetRouter } from "./aws-tailscale-subnet-router";
import { Vpc } from "@pulumi/awsx/ec2";
import { PrivateKey } from "@pulumi/tls";
import { getAmiOutput, Instance, InstanceTypes, KeyPair } from "@pulumi/aws/ec2";
import { Secret, SecretVersion } from "@pulumi/aws/secretsmanager";
import { all, interpolate } from "@pulumi/pulumi";

const vpcName = "test-tailscale-vpc";
const defaultVpc = new Vpc(vpcName, {
    enableDnsHostnames: true,
});

const subnetRouter = new SubnetRouter("test", {
    vpc: defaultVpc.vpc,
    subnetIds: defaultVpc.privateSubnetIds,
    securityGroupIds: defaultVpc.vpc.defaultSecurityGroupId.apply(x => [x]),
});

const sshkey = new PrivateKey("test", {
    algorithm: "ED25519",
});

const keypair = new KeyPair("test", {
    publicKey: sshkey.publicKeyOpenssh,
});

const secret = new Secret("test-keypair", {
    name: keypair.keyName,
    description: interpolate`Public and Private key for keypair ${keypair.keyName}`,
});
const secretVersion = new SecretVersion("test-keypair", {
    secretId: secret.id,
    secretString: all([sshkey.publicKeyOpenssh, sshkey.privateKeyOpenssh])
        .apply(([publicKey, privateKey]) => JSON.stringify({
            publicKey: publicKey,
            privateKey: privateKey,
        })),
});

const ubuntu = getAmiOutput({
    mostRecent: true,
    filters: [
        {
            name: "name",
            values: ["ubuntu/images/hvm-ssd/ubuntu-focal-20.04-amd64-server-*"],
        },
        {
            name: "virtualization-type",
            values: ["hvm"],
        },
    ],
    owners: ["099720109477"],
});

const instance = new Instance("test", {
    ami: ubuntu.id,
    instanceType: InstanceTypes.T3_Micro,
    subnetId: defaultVpc.privateSubnetIds.apply(x => x[0]),
    keyName: keypair.keyName,
});

export const ipAddress = instance.privateIp;