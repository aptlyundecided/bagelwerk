import { platformTourConfiguredNodes, platformTourNodeRegistry } from "./nodes";
import { platformTourFlow } from "./platformTourFlow";

export * from "./platformTourTypes";
export * from "./platformTourFlow";
export * from "./nodes";

export const PLATFORM_TOUR_FLOW_RUNNER_ARTIFACT_ROOT = ".artifacts/platform-tour";

/**
 * External-flow binding for this built-in, so it can be discovered/run through the same
 * flow.config.json loader as colleague flows (e.g. by the Flow Supervisor). A `flow.config.json`
 * can point its `module` + `exportName` here from any directory.
 */
export const platformTourBinding = {
  workspaceName: "platform-tour",
  label: "Bagelwerk Platform Tour",
  description: "The hero / welcome flow: create files, hand context forward through a nested sub-flow, draw a graph of itself, and summarize.",
  flow: platformTourFlow,
  configuredNodes: [...platformTourConfiguredNodes],
  nodeRegistry: platformTourNodeRegistry,
};
