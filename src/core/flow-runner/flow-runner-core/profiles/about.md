# Run-profiles behavior

Owns declarative Flow Runner Run Profile helpers.

## Includes

- Profile id resolution with default-profile fallback.
- Compilation from package-authored execution-plan recipes into `FlowRunnerExecutionPlan`.
- Generic plan description projection for plan-only CLIs and UIs.

## Invariants

- Profiles are metadata, not a second runtime.
- Whole-flow execution remains available without profiles.
- Domain-specific selections map to profiles outside the Flow Runner core.
- The compiled output is the existing neutral `FlowRunnerExecutionPlan` shape.
