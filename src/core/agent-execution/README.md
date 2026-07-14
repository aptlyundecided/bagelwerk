# Agent execution

Agent execution owns the seams that invoke model-backed or harness-backed agents from Flow/Node code.

## Validated skill-backed execution

Agent skill-backed Nodes should use `executeValidatedSkillBackedNode(...)` instead of calling `executeSkillBackedNodeSession(...)` directly.

Default behavior:

1. Run the skill-backed agent primitive normally.
2. Validate the recovered output artifacts with the Node-owned validator.
3. If validation fails, write attempt artifacts and retry with failure context.
4. Retry up to two times by default (`maxRetries: 2`, three attempts total).
5. Write `skill-healing-summary.json` with clean/repaired/final-failure telemetry.

A retry is not a blind rerun. The helper prepends generic failure-healing instructions and adds a retry-context input artifact containing prior validation issues, raw output paths, output artifact metadata, and prompt paths when available. Agents are instructed to fix formatting/schema/contract issues without repeating full work when possible, while still allowing a full rerun when needed.

Stable per-Node artifact layout:

```text
<node-run>/skill-attempts/
  attempt-001/
    prompt.md
    raw-output.txt
    output-artifacts.json
    validation.json
    failure-context.md
  attempt-002/
    retry-context.md
    prompt.md
    raw-output.txt
    output-artifacts.json
    validation.json
<node-run>/skill-healing-summary.json
```

`skill-healing-summary.json` reports one of:

- `completed_clean`
- `completed_after_retry`
- `failed_after_retries`

Frequent `completed_after_retry` results are still a fragility signal: the Flow may pass, but the Node/prompt/contract needed help.

## Direct primitive

`executeSkillBackedNodeSession(...)` remains the low-level primitive used by the validated helper and focused tests. Built-in agent Nodes should not call it directly unless a guard-test exemption documents why the default healing loop is unsafe or intentionally replaced by a custom repair mechanism.
