import { subscribe } from "../hook-broker";
import { onPostGeneration } from "./on-post-generation";
import { onBuildFailure } from "./on-build-failure";
import { onCycleEnd } from "./on-cycle-end";
import { onBuildSuccess } from "./on-build-success";

export function registerAllHooks(): void {
  subscribe("POST_EXECUTE", onPostGeneration);
  subscribe("ON_FAILURE", onBuildFailure);
  subscribe("STATE_MUTATED", onCycleEnd);
  subscribe("AFTER_BUILD", onBuildSuccess);
}
