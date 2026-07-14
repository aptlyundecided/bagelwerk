# `src/core/flow-runner`

Canonical Workbench-free Flow Runner plus external-flow adapter.

## Purpose

`flow-runner` owns the neutral execution surface for real Flow runs. It runs configured Flow/Node bindings without depending on Flow Workbench, while preserving the accepted Node Result model, per-Node artifact surfaces, preflight dependency checks, and typed events. `FlowRunnerEvent` is the canonical progress/observability stream; Nodes may emit `node-progress` events for internal queue/count/message progress without coupling views to built-in-specific event shapes.

The package also contains the `flow.config.json` loader/CLI adapter for external Flow workspaces. Active built-ins can also expose thin CLI adapters and run-profile metadata that compile into generic Flow Runner execution plans; those adapters should not become separate execution engines.

## `flow.config.json`

```json
{
  "schemaVersion": 1,
  "flows": [
    {
      "id": "external-powers-smoke",
      "module": "./externalPowersFlow.ts",
      "exportName": "default",
      "label": "External powers smoke"
    }
  ]
}
```

The runner namespaces ids with the config directory name. A config in `C:/flows/external-powers` with local id `smoke` is addressed as `external-powers:smoke`.

For now, long-lived non-built-in Flows can live in the repo-root gitignored `flow-library/` workspace while the package/import boundary matures. `examples/` is reserved for teaching fixtures and short examples.

## Flow catalog metadata

External Flow workspaces are discoverable through `flow.config.json`. In addition to the required `id` and `module`, entries may declare operator-facing metadata used by Flow Supervisor and future pickers:

```json
{
  "id": "recipe-discovery",
  "module": "./recipeDiscoveryFlow.ts",
  "label": "Recipe Discovery",
  "aliases": ["recipes", "recipe"],
  "requirements": { "network": true, "agentRuntime": "cursor", "writesDurableState": true },
  "prompts": [{ "key": "recipesPerRun", "kind": "number", "label": "How many recipes?", "default": 5 }],
  "supervisor": { "runMode": "local", "sessionPrefix": "recipes" },
  "profiles": [{ "id": "dry-run", "label": "Curate only", "executionPlan": { "kind": "prefix", "stopAfter": "recipe-discovery.curate-new-recipes" } }]
}
```

`npm run flow:supervisor -- list` scans local dogfood sources such as `flow-library/*/flow.config.json`; `npm run flow:supervisor -- run recipes` can use aliases and prompt metadata for a friendlier run.

## External binding contract

The target module exports an object with:

- `flow` — configured Flow spec
- `configuredNodes` — configured Node specs
- `nodeRegistry` — core Node registry (`get` / `list`)
- optional `workspaceName`, `label`, `description`

## Execution

Use the external Flow CLI:

```powershell
npm run flow:runner -- list --cwd flow-library/external-powers-smoke
npm run flow:runner -- run-flow external-powers-smoke:smoke demo --cwd flow-library/external-powers-smoke
```

Built-in CLIs should be thin adapters over this same runner surface. For example, `platform-tour`'s package-local run profiles compile to `FlowRunnerExecutionPlan` values before `npm run flow:tour` invokes the generic runner.

Artifacts are written under the external cwd using the neutral Flow Runner layout:

```text
<external-cwd>/.artifacts/flows/external/<namespace>/<workspace>/<flow-id>/<session>/
```

Each Node has stable semantic surfaces:

```text
nodes/<qualified-node-path>/runs/run-001/
nodes/<qualified-node-path>/latest/
nodes/<qualified-node-path>/accepted/
```

## Runtime input

Flow Runner Nodes receive `working.input.runtime` as the canonical runtime context. Workbench-specific compatibility is intentionally not part of the core runner; debugger/workbench behavior can be reintroduced later through middleware/adapters if needed.

## Middleware

Flow Runner supports lightweight ordered lifecycle middleware around Flow start/complete, Node enter/exit/crash, and inter-node transition time. The external CLI wires `createFlowRunnerConsoleProgressMiddleware(...)` by default so operators can see Node progress while a Flow runs; pass `--no-progress` to suppress that projection for scripted output.

## Invariants

- Flow Runner is the Workbench-free execution surface.
- Flow Workbench remains a developer-mode/debug surface and should not be required for external/product Flow runs.
- Preserve core Flow/Node contracts and accepted Node Result semantics.
- Do not depend on built-ins packages or built-ins CLIs for the external-flow adapter.
