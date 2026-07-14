# `src/core/nodes`

Canonical **Node** config/runtime surface.

## What lives here

- configured Node schemas (`nodeType`, `nodeId`, params)
- Node registries and execution contracts
- Node graph traversal/execution primitives
- Node runner event/timing helpers
- generic core Node types for runtime proving, including `core.timer` and `core.human-ack`

## Rules

- Nodes own execution contracts.
- `nodeType` is reusable behavior; `nodeId` is configured instance identity.
- Do not reintroduce retired pre-Flow/Node execution substrates as implementation dependencies.

## Generic core Nodes

- `core.timer` (`generic/timer/`) waits for a configured `delayMs` and emits a configured `message`. It is intentionally small and deterministic so Flow runner tests can prove ordering, timing, and parallel scheduling behavior without live providers.
- `core.human-ack` (`generic/human-ack/`) is an enter-only human acknowledgement checkpoint. It fails closed when no interaction surface is available (no injected `interaction`, no TTY, no explicit `interactionMode`), never auto-acknowledges, and emits normal accepted-artifact candidates (`human-ack.json` and `human-ack.md`, or `<artifactBaseName>.*`) so downstream Nodes can use the acknowledgement as durable context archaeology.
  - **Interaction modes** (param `interactionMode`):
    - `"readline"` — wait for Enter in terminal (requires TTY)
    - `"alert"` — pop a blocking macOS dialog (Acknowledge/Dismiss buttons)
    - `"alert+readline"` — race both; whichever the user responds to first wins
    - *(unset)* — auto-detect: use readline if TTY available, else fail closed
  - **Notification** (param `notifyOnWait`, default `true`): fires a macOS Notification Center banner + sound when the node starts waiting, so the user knows to come back.
  - See `src/core/notifications/` for the underlying primitives.
- `core.web-search` (`generic/web-search/`) calls OpenRouter's `perplexity/sonar-pro` by default and emits `web-search.json` plus `web-search.md` so downstream Nodes can depend on a cited research artifact instead of asking an agent CLI to browse implicitly.
