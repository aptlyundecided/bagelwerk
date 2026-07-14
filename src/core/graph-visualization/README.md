# `src/core/graph-visualization`

Reusable graph rendering utilities for Flowzone surfaces.

## Purpose

`renderMermaidSvg(...)` writes Mermaid source to a deterministic `.mmd` artifact and renders it to `.svg` with the existing Mermaid CLI. By default it prefers the locally installed `@mermaid-js/mermaid-cli` entrypoint and falls back to `mmdc` when needed. This keeps graph visualization reusable by Flow Workbench, Flow Doctor, Guided Flow Builder, generated Flow packages, and docs tooling.

## Boundaries

- Input is Mermaid text. Flow-to-Mermaid conversion belongs in a separate capability.
- Rendering uses `@mermaid-js/mermaid-cli` / `mmdc`; custom SVG rendering is out of scope for now.
- Default tests use an injectable command seam so they do not need to launch Puppeteer/headless Chromium.

## Test entrypoint

```bash
npx tsx --test src/core/graph-visualization/index.test.ts
```

The normal active suite also includes this package via `scripts/active-surface-test-run/run.mjs`.
