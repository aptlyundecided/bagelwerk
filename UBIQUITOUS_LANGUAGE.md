# UBIQUITOUS LANGUAGE

This glossary is intentionally short. It defines the terms we actively want people to use now.

## Canonical terms

| Term | Meaning |
| --- | --- |
| **Flow** | The canonical composition/grouping unit. A Flow may contain nested structure and configured Node references, and can compile into a resolved graph. |
| **Node** | The canonical executable unit and contract boundary. |
| **nodeType** | Reusable code-owned behavior for a class of Nodes. |
| **nodeId** | Configured instance identity for one Node inside a Flow or library. |
| **Configured Node** | A checked-in declarative Node instance bound to a `nodeType` plus params/config. |
| **Configured Flow** | A checked-in declarative Flow definition that references configured Nodes and optional nested Flows. |
| **Resolved Flow** | The compiled/flattened Flow representation used for execution and tooling. |
| **Qualified Node Path** | Canonical fully qualified path to a Node inside a resolved Flow. |
| **Flow Runner** | Canonical Workbench-free execution service for Configured/Resolved Flows. It runs Nodes through the canonical Node seam and owns production-capable execution concerns such as run context, accepted Node results, preflight, progress events, and resume. |
| **Flow Runner Execution Plan** | Neutral description of how a Flow Runner organizes a run, such as running the whole Flow, stopping after a prefix, or running child Flow lanes with configurable concurrency. |
| **Flow Workbench** | Developer-mode runner and inspection surface over canonical Flow/Node services. It should consume or mirror Flow Runner behavior rather than act as the production execution substrate. |
| **Accepted Node Result** | The accepted output/artifact surface for a Node, used as downstream precedent. |
| **Preflight** | Validation before a Node run starts, especially upstream accepted-artifact checks. |
| **Execution Policy** | Contextual execution settings attached to a Flow and resolved before Node execution. Policy can influence how a Node runs, but does not move artifact contracts away from the Node boundary. |
| **Work Orchestrator** | The layer above Flow Supervisor (reserved in `src/core/flow-supervisor/README.md`) that selects the next unit of work, chooses a Flow, delegates each run to Flow Supervisor, and decides the next unit from the supervisor report. It does not call Flow Runner or Nodes directly and is not a runtime. The Night Shift prototype (sibling repo) is its first implementation. |

## Usage rules

### Prefer these

- say **Flow**, not Circuit or Trace
- say **Node**, not Cell, Step, or Job for active architecture work
- say **Flow Runner** for Workbench-free execution of real Flow runs
- say **Flow Runner Execution Plan** for neutral execution-loop organization, not Workbench mode names
- say **Flow Workbench** for developer-mode inspection/debugging, not production execution
- say **accepted Node result**, not vague “latest output” when downstream precedent matters

### Use only for historical reference

These terms are no longer preferred for active design language:

- **Cell**
- **Circuit**
- **Trace**
- **Job**
- **Step**
- **flow-runtime**

## Boundary rules

- **Nodes own contracts.**
- **Flows are structural/contextual.**
- **Flow Runner is the canonical Workbench-free execution surface.**
- **Flow Workbench uses the same canonical Node seam and should sit over Flow Runner behavior where practical.**
- **Accepted results are Node-scoped.**
- **Execution Policy is contextual.** Flow policy may be inherited by descendant Nodes, and artifact contracts remain Node-owned.

## Naming intent

When naming new files, docs, functions, CLIs, or concepts:

1. choose **Flow** for composition/grouping
2. choose **Node** for execution/contract boundaries
3. avoid restoring retired Cell/Circuit/Trace/Job/Step top-level surfaces
