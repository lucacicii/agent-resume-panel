import type * as AcpSdk from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };

let sdkModule: typeof AcpSdk | undefined;

export async function getAcpSdk(): Promise<typeof AcpSdk> {
  if (!sdkModule) {
    sdkModule = await import("@agentclientprotocol/sdk");
  }
  return sdkModule;
}

export type AcpSdkModule = typeof AcpSdk;
