import type { ExecutionPolicy } from "../../flows/config/executionPolicy";
import type { NodeResult, NodeRunnerWorkingContext } from "../graph";

export type NodeTypeId = string;

export type DeclaredNodeArtifactSlot = {
  key: string;
  label: string;
  relativePath: string;
  required?: boolean;
  kind?: "contract" | "report" | "note" | "handoff" | "observability" | "other";
};

export type DeclaredNodeArtifactShape = {
  outputs: DeclaredNodeArtifactSlot[];
};

/** Built-in validation kinds for a declared input. `custom` defers to `validate`. */
export type DeclaredInputKind = "string" | "uuid" | "zededa-device-id" | "number" | "boolean" | "custom";

/**
 * A single piece of information a Node needs from the caller before it can run.
 *
 * The declaration is the single source of truth for BOTH behaviours:
 *  - at run time: if a value was supplied (param/flag/input) it is used without
 *    prompting; otherwise the caller is prompted via the interaction surface;
 *    otherwise a required input is reported as missing (fail closed).
 *  - ahead of time: a flow can enumerate every declared input as a "flagged item"
 *    (the questions the REPL would ask) without executing anything.
 */
export type DeclaredRequiredInput = {
  /** Stable key. Maps to provided[key] and to a --key CLI flag. */
  key: string;
  /** Question shown when prompting interactively. */
  prompt: string;
  /** Longer help text shown in the flagged-items dump. */
  description?: string;
  /** Drives built-in validation and UI hints. Defaults to "string". */
  kind?: DeclaredInputKind;
  /** Whether the input must be resolved before the Node can run. Defaults to true. */
  required?: boolean;
  /** Mask the value when echoing/dumping (secrets, tokens). Defaults to false. */
  sensitive?: boolean;
  /** Example/placeholder surfaced in the flagged-items dump. */
  example?: string;
  /** Custom validator: return an error string if invalid, or undefined if valid. */
  validate?: (raw: string) => string | undefined;
};

export type DeclaredNodeInputShape = {
  inputs: DeclaredRequiredInput[];
};

export type EmittedNodeArtifactRecord = {
  key?: string;
  label: string;
  path: string;
  relativePath?: string;
  required?: boolean;
};

export type NodeContractVisibility = "strict_contract" | "declared" | "opaque";

export type NodeTypeEntry<TParams = unknown, TInput = unknown, TPayload = unknown> = {
  nodeType: NodeTypeId;
  label?: string;
  validateParams: (value: unknown) => TParams;
  execute: (args: {
    nodeId: string;
    instanceId: string;
    params: TParams;
    working: Readonly<NodeRunnerWorkingContext<TInput>>;
    executionPolicy?: ExecutionPolicy;
  }) => Promise<NodeResult<TPayload>>;
  describeArtifacts?: (args: { nodeId: string; params: TParams }) => DeclaredNodeArtifactShape;
  /**
   * Declare the inputs this Node needs from the caller. Enables both interactive
   * prompting (when a value is absent) and ahead-of-time enumeration of a flow's
   * questions ("flagged items") without executing. Mirrors describeArtifacts.
   */
  describeInputs?: (args: { nodeId: string; params: TParams }) => DeclaredNodeInputShape;
  contractVisibility?: NodeContractVisibility;
  collectArtifacts?: (args: { nodeId: string; params: TParams; payload: TPayload | undefined }) => EmittedNodeArtifactRecord[];
};

export type AnyNodeTypeEntry = NodeTypeEntry<any, any, any>;

export type NodeRegistry = {
  get(nodeType: NodeTypeId): AnyNodeTypeEntry | undefined;
  list(): AnyNodeTypeEntry[];
};

export function createStaticNodeRegistry(entries: AnyNodeTypeEntry[]): NodeRegistry {
  const byType = new Map<NodeTypeId, AnyNodeTypeEntry>();
  for (const entry of entries) {
    if (byType.has(entry.nodeType)) {
      throw new Error(`Duplicate nodeType registration: ${entry.nodeType}`);
    }
    byType.set(entry.nodeType, entry);
  }

  return {
    get(nodeType) {
      return byType.get(nodeType);
    },
    list() {
      return [...byType.values()];
    },
  };
}

export function requireNodeTypeEntry(registry: NodeRegistry, nodeType: NodeTypeId): AnyNodeTypeEntry {
  const entry = registry.get(nodeType);
  if (!entry) {
    throw new Error(`Unknown configured nodeType: ${nodeType}`);
  }
  return entry;
}
