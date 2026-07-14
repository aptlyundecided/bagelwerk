import type { FlowRunnerAcceptancePolicy, FlowRunnerExecutionPlan, FlowRunnerResumePolicy } from "../api/contracts";

export type FlowRunnerExecutionPlanRecipe =
  | { kind: "whole-flow" }
  | { kind: "prefix"; stopAfter: string }
  | {
      kind: "lanes";
      prefix?: { stopAfter: string; runByDefault?: boolean };
      lanes: Array<{ id?: string; flowPath: string; label?: string }>;
      laneConcurrency?: number | "unbounded";
      join?: string;
    };

export type FlowRunnerOutputSummaryDeclaration = {
  key: string;
  label?: string;
  description?: string;
  from: string;
  relativePath: string;
  kind?: "report" | "summary" | "contract" | "artifact";
  profileIds?: string[];
};

export type FlowRunnerRunProfile = {
  id: string;
  label?: string;
  description?: string;
  plan: FlowRunnerExecutionPlanRecipe;
  defaults?: {
    resume?: FlowRunnerResumePolicy;
    acceptance?: FlowRunnerAcceptancePolicy;
  };
  outputs?: FlowRunnerOutputSummaryDeclaration[];
};

export type FlowRunnerRunProfilePlanDescription = {
  profileId: string;
  label?: string;
  description?: string;
  executionPlan: FlowRunnerExecutionPlan;
  lanes: string[];
  prefix?: { stopAfter: string; run: boolean };
  join?: string;
  outputs?: FlowRunnerOutputSummaryDeclaration[];
};

export function defaultFlowRunnerLaneId(flowPath: string): string {
  return flowPath.split(".").filter(Boolean).pop() ?? flowPath;
}

export function resolveFlowRunnerRunProfile(args: {
  profiles: readonly FlowRunnerRunProfile[];
  profileId?: string;
  defaultProfileId?: string;
}): FlowRunnerRunProfile {
  const requestedId = args.profileId ?? args.defaultProfileId;
  if (!requestedId) {
    throw new Error("Flow Runner profile id is required when no defaultProfileId is provided.");
  }
  const profile = args.profiles.find((candidate) => candidate.id === requestedId);
  if (!profile) {
    const known = args.profiles.map((candidate) => candidate.id).join(", ") || "<none>";
    throw new Error(`Unknown Flow Runner profile '${requestedId}'. Known profiles: ${known}`);
  }
  return profile;
}

export function compileFlowRunnerExecutionPlanRecipe(args: {
  recipe: FlowRunnerExecutionPlanRecipe;
  runPrefix?: boolean;
}): FlowRunnerExecutionPlan {
  const { recipe } = args;
  if (recipe.kind === "whole-flow") return { kind: "whole-flow" };
  if (recipe.kind === "prefix") return { kind: "prefix", stopAfter: recipe.stopAfter };

  const plan: FlowRunnerExecutionPlan = {
    kind: "lanes",
    lanes: recipe.lanes.map((lane) => ({ id: lane.id ?? defaultFlowRunnerLaneId(lane.flowPath), flowPath: lane.flowPath })),
    ...(recipe.prefix ? { prefix: { stopAfter: recipe.prefix.stopAfter, run: args.runPrefix ?? recipe.prefix.runByDefault ?? true } } : {}),
    ...(recipe.laneConcurrency !== undefined ? { laneConcurrency: recipe.laneConcurrency } : {}),
    ...(recipe.join ? { join: recipe.join } : {}),
  };
  return plan;
}

export function describeFlowRunnerRunProfilePlan(args: {
  profile: FlowRunnerRunProfile;
  executionPlan: FlowRunnerExecutionPlan;
  outputs?: FlowRunnerOutputSummaryDeclaration[];
}): FlowRunnerRunProfilePlanDescription {
  const base = {
    profileId: args.profile.id,
    ...(args.profile.label ? { label: args.profile.label } : {}),
    ...(args.profile.description ? { description: args.profile.description } : {}),
    executionPlan: args.executionPlan,
    lanes: args.executionPlan.kind === "lanes" ? args.executionPlan.lanes.map((lane) => lane.flowPath) : [],
    ...(args.executionPlan.kind === "lanes" && args.executionPlan.prefix ? { prefix: { stopAfter: args.executionPlan.prefix.stopAfter, run: args.executionPlan.prefix.run !== false } } : {}),
    ...(args.executionPlan.kind === "lanes" && args.executionPlan.join ? { join: args.executionPlan.join } : {}),
    ...(args.outputs ?? args.profile.outputs ? { outputs: args.outputs ?? args.profile.outputs } : {}),
  } satisfies FlowRunnerRunProfilePlanDescription;
  return base;
}
