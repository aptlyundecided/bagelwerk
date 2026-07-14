# Platform Tour

The Bagelwerk **hero / welcome flow** — a durable, re-runnable teacher. It is not a slide
demo: it runs real Nodes that leave real files behind, so colleagues learn by doing.

```
intro → demo-code-node(timer) → agent-thinking(timer) → explain-code-node
      → [ context-handoff-demo: create-handoff-packet → handoff-agent-thinking → read-handoff-packet ]
      → draft-tour-graph → render-tour-graph (SVG) → summarize
```

What each beat teaches:

- **intro** — a tiny code Node writes `toy-welcome.md`.
- **demo-code-node / agent-thinking** — the generic `core.timer` Node: plain, model-free code is a first-class Flow citizen.
- **explain-code-node** — what an agent-written note looks like inside a Flow.
- **context-handoff-demo** — a **nested sub-flow**: one Node mints `handoff-packet.json`, a downstream Node opens it into a readable note. Context moves forward through files, not memory.
- **draft-tour-graph / render-tour-graph** — the Flow draws a Mermaid graph of *itself* and renders it to SVG.
- **summarize** — an index of everything the run produced.

## Run it

```bash
npm run flow:tour                          # autonomous run
npm run flow:tour -- --operator "Alex"     # personalized intro
npm run flow:tour -- --session demo --quiet
```

### Interactive demo (`--present`)

```bash
npm run flow:tour -- --present             # step-by-step: press Enter to run each step (no model)
npm run flow:tour -- --present --auto      # narrated playthrough, no input (CI-safe; no model)
npm run flow:tour -- --present --live      # same step-through, but call a real agent per step
```

`--present` opens an Ink TUI that runs the tour **one node at a time**: each step shows what it
does and why, you press **Enter** to run it and see the files it produced, then advance — `a`
auto-runs the rest, `q` quits, `o` opens the SVG at the end. It drives real node-by-node execution
via `runFlowRunnerNode`; the presenter lives in `src/tools/built-ins/platform-tour/`.

The narrated playthrough is **model-free by default**: the agent-note beats use a deterministic
`sampleTourRunAgent` (a canned, `dry-run/sample`-labelled note) so it costs no model quota and is
CI-safe — this is the GETTING-STARTED "fresh clone → run a real Flow, no model cost" first step.
Pass `--live` to opt the presenter back into the real agent backend (`defaultTourRunAgent`, the
pi CLI) on those beats. The autonomous `npm run flow:tour` (no `--present`) always uses the real
agent.

Artifacts land under `.artifacts/platform-tour/<session>/...`; the run prints the accepted
`summaryPath` and `svgPath`. The SVG step shells out to the Mermaid CLI — install it if that
step fails (`npm run mermaid:render` uses the same `mmdc`).

## How it's built

This package runs on the current **Flow Runner** API (`runFlowRunnerFlow`, `executionPlan: { kind: "whole-flow" }`). Nodes live in `nodes/` as small focused files; the Mermaid
renderer is injected (`createPlatformTourNodeRegistry({ renderMermaidSvg })`) so tests run without
the real CLI. It is the sole active built-in and the worked example referenced by `GETTING-STARTED.md` step 7.
