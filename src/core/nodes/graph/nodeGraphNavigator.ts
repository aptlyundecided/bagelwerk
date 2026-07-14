import type { NodeGraph, NodeGraphEdge, NodeTransitionInput } from "./nodeGraphTypes";

export class NodeGraphNavigator {
  resolveNext<TPayload>(
    nodeId: string,
    transitionInput: NodeTransitionInput<TPayload>,
    graph: NodeGraph,
  ): string {
    const node = graph.nodes[nodeId];
    const edges = node?.edges ?? [];
    if (edges.length === 0) {
      throw new Error(`Node graph has no outgoing edges for node ${nodeId}.`);
    }

    const matches = edges.filter((edge: NodeGraphEdge<TPayload>, index: number) => {
      try {
        return edge.when(transitionInput);
      } catch (error) {
        throw new Error(
          `Edge predicate threw for node ${nodeId} edge ${index}${edge.label ? ` (${edge.label})` : ""}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });

    if (matches.length !== 1) {
      throw new Error(
        `Node ${nodeId} violated single-match transition rule: expected exactly one matching edge, got ${matches.length}.`,
      );
    }

    return matches[0]!.to;
  }
}
