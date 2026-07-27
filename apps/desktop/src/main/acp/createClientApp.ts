import type { ClientApp } from "@agentclientprotocol/sdk" with { "resolution-mode": "import" };
import * as fsHandlers from "./handlers/fs";
import * as permissionHandlers from "./handlers/permission";
import * as terminalHandlers from "./handlers/terminal";
import { publishSessionUpdate } from "./sessionUpdateBus";
import { getAcpSdk } from "./sdk";
import type { SessionUpdatePayload } from "./types";

export async function createAcpClientApp(): Promise<ClientApp> {
  const acp = await getAcpSdk();
  return acp
    .client({ name: "agent-resume-desktop" })
    .onRequest(acp.methods.client.session.requestPermission, (ctx) =>
      permissionHandlers.requestPermission(ctx.params)
    )
    .onRequest(acp.methods.client.fs.readTextFile, (ctx) => fsHandlers.readTextFile(ctx.params))
    .onRequest(acp.methods.client.fs.writeTextFile, (ctx) => fsHandlers.writeTextFile(ctx.params))
    .onRequest(acp.methods.client.terminal.create, (ctx) => terminalHandlers.createTerminal(ctx.params))
    .onRequest(acp.methods.client.terminal.output, (ctx) => terminalHandlers.terminalOutput(ctx.params))
    .onRequest(acp.methods.client.terminal.release, (ctx) => terminalHandlers.releaseTerminal(ctx.params))
    .onRequest(acp.methods.client.terminal.waitForExit, (ctx) =>
      terminalHandlers.waitForTerminalExit(ctx.params)
    )
    .onRequest(acp.methods.client.terminal.kill, (ctx) => terminalHandlers.killTerminal(ctx.params))
    .onNotification(acp.methods.client.session.update, (ctx) => {
      publishSessionUpdate({
        sessionId: ctx.params.sessionId,
        update: ctx.params.update as SessionUpdatePayload["update"]
      });
    });
}
