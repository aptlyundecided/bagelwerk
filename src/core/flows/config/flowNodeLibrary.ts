import type { ConfiguredNodeSpec } from "../../nodes/config";
import { parseConfiguredNodeSpec } from "../../nodes/config";

export type FlowNodeLibrary = {
  get(nodeId: string): ConfiguredNodeSpec | undefined;
  list(): ConfiguredNodeSpec[];
};

export function createStaticFlowNodeLibrary(configuredNodes: unknown[]): FlowNodeLibrary {
  const nodes = configuredNodes.map((entry) => parseConfiguredNodeSpec(entry));
  const byId = new Map<string, ConfiguredNodeSpec>();
  for (const node of nodes) {
    if (byId.has(node.nodeId)) {
      throw new Error(`Duplicate configured nodeId: ${node.nodeId}`);
    }
    byId.set(node.nodeId, node);
  }
  return {
    get(nodeId) {
      return byId.get(nodeId);
    },
    list() {
      return [...byId.values()];
    },
  };
}

export function requireConfiguredNode(library: FlowNodeLibrary, nodeId: string): ConfiguredNodeSpec {
  const node = library.get(nodeId);
  if (!node) {
    throw new Error(`Unknown configured nodeId: ${nodeId}`);
  }
  return node;
}
