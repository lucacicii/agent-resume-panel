import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk" with {
  "resolution-mode": "import"
};

export type PermissionPromptHandler = (
  params: RequestPermissionRequest
) => Promise<RequestPermissionResponse>;

let promptHandler: PermissionPromptHandler | null = null;

export function setPermissionPromptHandler(handler: PermissionPromptHandler | null): void {
  promptHandler = handler;
}

export async function requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  if (!promptHandler) {
    return { outcome: { outcome: "cancelled" } };
  }
  return promptHandler(params);
}
