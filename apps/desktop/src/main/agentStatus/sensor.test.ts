import { describe, expect, it, vi } from "vitest";
import type { AgentStatusBridge } from "./bridge";
import { PROGRAM_STATUS_REPLY } from "./scan";
import { AgentStatusSensor } from "./sensor";
import type { NativeReport } from "./types";

/** The sensor only calls the bridge, so a stub is the whole contract. */
function bridgeWith(overrides: Partial<AgentStatusBridge>): AgentStatusBridge {
  return {
    connect: () => undefined,
    reconnect: () => undefined,
    publishTelemetry: () => undefined,
    publishNativeReport: () => undefined,
    forgetPane: () => undefined,
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    onTransition: () => () => undefined,
    connected: false,
    dispose: () => undefined,
    ...overrides
  };
}

describe("AgentStatusSensor program status", () => {
  it("publishes an OSC 7501 report under the program's own source", () => {
    const publishNativeReport = vi.fn<(report: NativeReport) => void>();
    const sensor = new AgentStatusSensor({
      bridge: bridgeWith({ publishNativeReport }),
      getPtyPid: () => null
    });
    sensor.attach(7, { cols: 80, rows: 24, sessionKey: "cli:abc" });

    // The sequence is swallowed, exactly like Agent Resume's own status channel.
    expect(sensor.ingest(7, "\x1b]7501;state=blocked:kind=permission:app=claude-code\x1b\\")).toBe("");

    expect(publishNativeReport).toHaveBeenCalledTimes(1);
    expect(publishNativeReport.mock.calls[0]?.[0]).toMatchObject({
      paneId: 7,
      source: "osc7501:claude-code",
      state: "blocked",
      seq: 1,
      sessionKey: "cli:abc"
    });
    sensor.dispose();
  });

  it("hands the feature-detection reply back exactly once per query", () => {
    const sensor = new AgentStatusSensor({ bridge: bridgeWith({}), getPtyPid: () => null });
    sensor.attach(7, { cols: 80, rows: 24 });

    expect(sensor.takeProgramStatusReply(7)).toBeNull();

    sensor.ingest(7, "\x1b]7501;?\x07");
    expect(sensor.takeProgramStatusReply(7)).toBe(PROGRAM_STATUS_REPLY);
    expect(sensor.takeProgramStatusReply(7)).toBeNull();
    expect(sensor.takeProgramStatusReply(9)).toBeNull();

    sensor.ingest(7, "\x1b]7501;?\x1b\\");
    expect(sensor.takeProgramStatusReply(7)).toBe(PROGRAM_STATUS_REPLY);
    sensor.dispose();
  });
});
