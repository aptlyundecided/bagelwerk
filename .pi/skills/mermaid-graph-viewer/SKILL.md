---
name: mermaid-graph-viewer
description: >-
  Visualize a Flow / Node graph as a Mermaid diagram: ensure
  @mermaid-js/mermaid-cli is available, elicit the target Flow or resolved graph
  from the operator, transcribe it to Mermaid, validate by rendering with mmdc,
  and open the SVG. Use when the user wants a Mermaid chart, graph diagram, or
  visual view of a Flow graph in this repository.
disable-model-invocation: true
---

# Mermaid graph viewer (Flow / Node)

Turn a **named graph object** in the codebase into a **rendered SVG** using **Mermaid CLI** (`mmdc`), with a validation pass (render = proof the syntax is accepted).

## Operating system

Read repo-root **`.current-os`** and match shell conventions (PowerShell vs bash, path style, how to open a file).

## 1. Ensure the renderer is installed

- Confirm **`@mermaid-js/mermaid-cli`** is listed under **`devDependencies`** in repo-root **`package.json`**.
- Confirm **`node_modules/.bin/mmdc`** exists (or that `npx mmdc --version` succeeds from the repo root).
- If either check fails: add **`@mermaid-js/mermaid-cli`** to **`devDependencies`**, run **`npm install`** from the repo root, then re-check.

**Note:** the first install may download a headless browser for Puppeteer; that is expected and can take time.

## 2. Elicit which graph to visualize

Ask the operator (do not guess in silence) for one of:

- The **identifier** of the Flow or resolved-graph constant (for example, `platformTourFlow`), **or**
- The **file path** plus rough location (for example, `src/core/built-ins/platform-tour/platformTourFlow.ts`), **or**
- Enough context to **find** the graph via search (`rg "ConfiguredFlow|flow" src/core` or the name).

If multiple Flows or graph objects exist in one file, the operator must pick **one** by **constant name**.

## 3. Build the Mermaid source from the graph

1. **Open the source** and locate the **Configured Flow / Resolved Flow** shape (for example: `initial`, `nodes`, nested `flows`, and `edges`).
2. Prefer **flowchart TD** (top-down) unless the graph is explicitly state-like and reads better as **`stateDiagram-v2`**.
3. **Mapping rules** (adapt if the object differs slightly):
   - Use **`initial`** as the entry: either a synthetic **`start`** node that points to **`initial`**, or label the **`initial`** node clearly.
   - For each **Node**: one Mermaid node id per Flow node key / qualified Node path (sanitize only if Mermaid rejects an id; underscore keys are usually fine).
   - For nested **Flow** boundaries: prefer Mermaid `subgraph` blocks when the source shape makes boundaries clear.
   - For each **edge** in **`edges`**: `fromId -->|short label| toId`.
     - Derive a **short edge label** from **`on`** / transition metadata: e.g. `completed`, `failed`, `retry`, `else`, or a one-word hint — never paste raw TS into the diagram.
   - If **`label`** or configured Node metadata exists, show it in the node text; otherwise use the node key or qualified path.
4. Write the diagram to **`.artifacts/mermaid/<sanitized-graph-name>.mmd`** (create directories as needed). This path stays under gitignored **`.artifacts/`** per repo rules.

## 4. Validate (Mermaid acceptance)

**Validation = render.** There is no separate “Mermaid linter” required if **`mmdc`** succeeds.

From repo root:

```bash
npm run mermaid:render -- -i .artifacts/mermaid/<name>.mmd -o .artifacts/mermaid/<name>.svg
```

- **Exit code 0:** syntax and renderer accepted the diagram.
- **Non-zero:** read **`stderr`**, fix the **`.mmd`** (common issues: unquoted special characters in labels, illegal node ids, conflicting subgraph syntax), then re-run until success.

Optional: add **`--backgroundColor transparent`** or **`-t dark`** if the operator prefers; default is fine for validation.

## 5. Open the result for the operator

After a successful render, **open the SVG** with the OS-appropriate command (from **`.current-os`**), e.g.:

- Windows: `Start-Process` / `explorer` the **`.svg`** path
- macOS: `open <path>`
- Linux: `xdg-open <path>`

Tell the operator the **absolute paths** to both **`.mmd`** and **`.svg`**.

## Quick reference

| Phase | Action |
| --- | --- |
| Tooling | `package.json` + `npm install`; invoke via **`npm run mermaid:render --`** |
| Input | Operator names graph constant / file |
| Output | `.artifacts/mermaid/<name>.mmd` + `.svg` |
| Proof | `mmdc` exits 0 |

## Related Flow / Node surfaces

Canonical Flow and Node shapes live under **`src/core/flows/`**, **`src/core/nodes/`**, and the canonical Workbench-free runner under **`src/core/flow-runner/`**. Prefer Flow Runner / resolved Flow facts over retired runtime surfaces.
