import type { ExecutionPolicy, ExecutionPolicyRunOverlay } from "../../../../flows/config";
import { hasExecutionPolicy, mergeExecutionPolicy, policyWithoutOverlayPaths } from "../../../../flows/config";
import { joinPath, requireBoundary } from "../refs/pathRefs";
import type { ResolveState } from "../state/resolveState";

function validateExecutionPolicyOverlayPaths(state: ResolveState, overlay: ExecutionPolicyRunOverlay | undefined): void {
  for (const flowPath of Object.keys(overlay?.paths ?? {})) {
    if (!state.flowsByPath[flowPath]) {
      throw new Error(`Execution policy overlay references unknown Flow path: ${flowPath}`);
    }
  }
}

function overlayPoliciesForFlowPath(overlay: ExecutionPolicyRunOverlay | undefined, flowPath: string[]): Array<{ path: string; policy: ExecutionPolicy }> {
  if (!overlay) return [];
  const policies: Array<{ path: string; policy: ExecutionPolicy }> = [];
  const globalPolicy = policyWithoutOverlayPaths(overlay);
  if (globalPolicy) policies.push({ path: "<global>", policy: globalPolicy });
  for (let index = 1; index <= flowPath.length; index += 1) {
    const qualifiedPath = joinPath(flowPath.slice(0, index));
    const policy = overlay.paths?.[qualifiedPath];
    if (policy && hasExecutionPolicy(policy)) policies.push({ path: qualifiedPath, policy });
  }
  return policies;
}

export function applyExecutionPolicyOverlay(state: ResolveState, overlay: ExecutionPolicyRunOverlay | undefined): void {
  validateExecutionPolicyOverlayPaths(state, overlay);
  if (!overlay) return;

  for (const boundary of Object.values(state.flowsByPath)) {
    let executionPolicy = boundary.executionPolicy;
    const executionPolicySources = [...(boundary.executionPolicySources ?? [])];
    for (const item of overlayPoliciesForFlowPath(overlay, boundary.flowPath)) {
      executionPolicy = mergeExecutionPolicy(executionPolicy, item.policy);
      executionPolicySources.push({ kind: "run-overlay", path: item.path });
    }
    if (executionPolicy) boundary.executionPolicy = executionPolicy;
    if (executionPolicySources.length > 0) boundary.executionPolicySources = executionPolicySources;
  }

  for (const node of Object.values(state.nodesByPath)) {
    const boundary = requireBoundary(state, joinPath(node.flowPath));
    if (boundary.executionPolicy) node.executionPolicy = boundary.executionPolicy;
    if (boundary.executionPolicySources) node.executionPolicySources = [...boundary.executionPolicySources];
  }
}
