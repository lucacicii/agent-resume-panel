import type { RequestPermissionRequest, RequestPermissionResponse } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import * as vscode from "vscode";
import { autoApprovePermissions } from "../config";

export async function requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
  const title = params.toolCall.title ?? "Agent action";

  if (autoApprovePermissions()) {
    const allow = params.options.find((option) => option.kind === "allow_once" || option.kind === "allow_always");
    if (allow) {
      return { outcome: { outcome: "selected", optionId: allow.optionId } };
    }
  }

  const picked = await vscode.window.showQuickPick(
    params.options.map((option) => ({
      label: option.name,
      description: option.kind,
      optionId: option.optionId
    })),
    {
      title: `Agent permission: ${title}`,
      placeHolder: "Allow this agent action?"
    }
  );

  if (!picked) {
    return { outcome: { outcome: "cancelled" } };
  }

  return { outcome: { outcome: "selected", optionId: picked.optionId } };
}