import { useSyncExternalStore } from "react";
import { controller } from "../sim/controller.ts";

/** Re-render on every tick / control change. */
export function useSim() {
  useSyncExternalStore(controller.subscribe, controller.getVersion);
  return controller;
}
