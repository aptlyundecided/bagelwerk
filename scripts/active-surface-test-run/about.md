# active-surface-test-run

Repo-level test selector for the living Flow / Node surface.

## Why this exists

The repo has retired and experimental surfaces that should not automatically define the default test authority. This script keeps `npm run test` centered on active, deterministic packages while still allowing model-backed tests to live beside code under an explicit opt-in suffix.

## Entrypoints

From `package.json`:

```json
"test": "npm run test:active",
"test:active": "node scripts/active-surface-test-run/run.mjs default",
"test:active:models": "node scripts/active-surface-test-run/run.mjs models"
```

## Modes

- `default` — runs active `*.test.ts` files and excludes `*.model.test.ts`.
- `models` — runs only active `*.model.test.ts` files.

If a mode finds no matching tests, it exits successfully.

## Active roots

The script currently scans:

- `src/core/nodes/`
- `src/core/flows/`
- `src/core/flow-workbench/`
- `src/core/flow-runner/`
- `src/core/graph-visualization/`
- `src/core/built-ins/`
- `src/tools/`

Update this list when a package becomes part of the active Flow / Node validation surface.

## Contract

Default tests must be deterministic and must not require live model/provider calls. Put real-provider tests behind the `*.model.test.ts` suffix and document any required environment beside those tests.
