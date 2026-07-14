import type { ConfiguredFlowNodeAcceptedArtifactRef } from "../../../../flows/config";
import type { FlowBoundary, ResolveState } from "../state/resolveState";
import { joinPath } from "../refs/pathRefs";

export function resolveAcceptedArtifactSource(params: {
  artifact: ConfiguredFlowNodeAcceptedArtifactRef;
  boundary: FlowBoundary;
  state: ResolveState;
}): string {
  const from = params.artifact.from;
  if (!from.includes(".")) {
    if (params.boundary.localFlowKeys.has(from)) {
      throw new Error(
        `Configured flow accepted-artifact source '${from}' resolves to flow boundary '${joinPath([...params.boundary.flowPath, from])}'. Artifacts are Node-scoped; use a Transition Node to adapt Flow handoffs.`,
      );
    }
    if (params.boundary.localNodeKeys.has(from)) return joinPath([...params.boundary.flowPath, from]);
    throw new Error(`Unable to qualify accepted-artifact source '${from}' under '${params.boundary.qualifiedPath}'.`);
  }

  if (params.state.flowsByPath[from]) {
    throw new Error(
      `Configured flow accepted-artifact source '${from}' resolves to flow boundary '${from}'. Artifacts are Node-scoped; use a Transition Node to adapt Flow handoffs.`,
    );
  }
  return from;
}
