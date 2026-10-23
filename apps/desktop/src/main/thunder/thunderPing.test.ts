import { describe, expect, it } from "vitest";
import { normalizePingResponse } from "./thunderPing";

describe("normalizePingResponse", () => {
  it("reads the microkernel daemon's `status: \"pong\"` heartbeat", () => {
    // thunder-daemon protocol v3 (crates/thunder-daemon/src/service.rs) answers this
    // exact shape. It used to be reported as offline because only `pong` was read.
    expect(
      normalizePingResponse({ status: "pong", version: "0.1.0", protocol_version: 3 })
    ).toEqual({ pong: true, version: "0.1.0", protocolVersion: 3 });
  });

  it("still reads the pre-rewrite sidecar's `pong: true` heartbeat", () => {
    expect(normalizePingResponse({ pong: true, version: "0.0.9", protocol_version: 2 })).toEqual({
      pong: true,
      version: "0.0.9",
      protocolVersion: 2
    });
  });

  it("does not treat a missing reply or an unrelated status as alive", () => {
    expect(normalizePingResponse(null).pong).toBe(false);
    expect(normalizePingResponse(undefined).pong).toBe(false);
    expect(normalizePingResponse({}).pong).toBe(false);
    expect(normalizePingResponse({ status: "starting" }).pong).toBe(false);
    expect(normalizePingResponse({ pong: false }).pong).toBe(false);
  });
});
