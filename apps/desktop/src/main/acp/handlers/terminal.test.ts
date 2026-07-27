import { afterEach, describe, expect, it } from "vitest";
import {
  createTerminal,
  releaseTerminal,
  terminalOutput,
  waitForTerminalExit
} from "./terminal";

const createdTerminalIds: string[] = [];

afterEach(async () => {
  await Promise.all(createdTerminalIds.splice(0).map((terminalId) => releaseTerminal({ terminalId })));
});

describe("ACP terminal handler", () => {
  it("runs Grok's combined Bash invocation", async () => {
    const terminal = await createTerminal({
      command: "/bin/bash -lc 'printf grok-terminal-ok'",
      args: []
    });
    createdTerminalIds.push(terminal.terminalId);

    await expect(waitForTerminalExit(terminal)).resolves.toEqual({ exitCode: 0 });
    await expect(terminalOutput(terminal)).resolves.toMatchObject({ output: "grok-terminal-ok" });
  });

  it("reports a failed spawn without crashing the host process", async () => {
    const terminal = await createTerminal({ command: "/definitely-missing-agent-resume-command" });
    createdTerminalIds.push(terminal.terminalId);

    await expect(waitForTerminalExit(terminal)).resolves.toEqual({ exitCode: 127 });
    await expect(terminalOutput(terminal)).resolves.toMatchObject({
      output: expect.stringContaining("Failed to start terminal")
    });
  });
});
