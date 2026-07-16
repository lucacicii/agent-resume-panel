import { HandoffDeliveryChannel } from "../types";
import { acpHandoffDeliverer } from "./acpDeliverer";
import { cliHandoffDeliverer } from "./cliDeliverer";
import { clipboardHandoffDeliverer } from "./clipboardDeliverer";
import { HandoffDeliverer } from "./types";

const DELIVERERS: HandoffDeliverer[] = [
  acpHandoffDeliverer,
  cliHandoffDeliverer,
  clipboardHandoffDeliverer
];

export function getHandoffDeliverer(channel: HandoffDeliveryChannel): HandoffDeliverer | undefined {
  return DELIVERERS.find((deliverer) => deliverer.channel === channel);
}