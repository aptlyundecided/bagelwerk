# `src/core/notifications`

macOS-native notification and interactive alert primitives for Flow checkpoints.

## What lives here

| File | Purpose |
|------|---------|
| `notify.ts` | Core implementation — banner notifications + blocking alert dialogs |
| `index.ts` | Barrel export |
| `notify.test.ts` | Unit tests (banner tests fire real notifications on macOS) |
| `demo.ts` | Interactive demo script (`npx tsx src/core/notifications/demo.ts`) |

## Exports

### `notify(opts)` — Non-blocking banner notification

Fires a Notification Center banner and returns immediately. Uses `terminal-notifier` when installed (Homebrew), falls back to `osascript display notification`.

```typescript
await notify({ title: "Flow Done", message: "platform-tour completed", sound: "Glass" });
```

### `alert(opts)` — Blocking interactive dialog

Shows a modal macOS dialog via `osascript display alert`. **Blocks the process** until the user clicks a button. Returns which button was clicked.

```typescript
const result = await alert({
  title: "🔔 Checkpoint",
  message: "Acknowledge to proceed?",
  buttons: ["Dismiss", "Acknowledge"],
  defaultButton: "Acknowledge",
  cancelButton: "Dismiss",
});
// result.button === "Acknowledge" | "Dismiss"
// result.dismissed === true if cancel button was pressed
```

## Platform behavior

| Platform | `notify()` | `alert()` |
|----------|-----------|-----------|
| macOS | ✅ Native notification | ✅ Blocking dialog |
| Linux/Windows | Silent no-op | Resolves with default button |

## Dependencies

**Zero npm dependencies.** Uses only:
- `node:child_process` (exec/execSync)
- `node:os` (platform detection)
- macOS system `osascript` binary
- Optionally `terminal-notifier` (Homebrew) for richer banners

## Usage in Flows

The `core.human-ack` node uses these primitives. Configure via its `interactionMode` and `notifyOnWait` params. See `src/core/nodes/README.md`.
