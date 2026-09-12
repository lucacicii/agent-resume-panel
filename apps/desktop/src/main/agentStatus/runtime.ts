/**
 * Process-wide handle to the pane sensor, so `ptyHost` can feed it without
 * taking a dependency on the daemon or on Electron's app lifecycle.
 *
 * Installed once by `main.ts`; absent in unit tests, where every call degrades
 * to a pass-through.
 */

import type { AgentStatusSensor } from "./sensor";

let sensor: AgentStatusSensor | null = null;

export function setAgentStatusSensor(next: AgentStatusSensor | null): void {
  sensor?.dispose();
  sensor = next;
}

export function getAgentStatusSensor(): AgentStatusSensor | null {
  return sensor;
}
