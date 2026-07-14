# Capture inbox format

The capture inbox lives at `OPEN_ITEMS_CAPTURE.md`.

## Literal boundary

```md
Begin Items Capture
---
```

Do not rewrite or delete content above this boundary.

## Entry delimiter

Below the boundary, each H1 section is one capture entry:

```md
# Title for one open item
First paragraph becomes summary.

Everything after the first blank line becomes notes/discoveries.
```

## Promotion behavior

- Promote all entries in file order.
- Create one item file per entry.
- Remove the full H1 section from capture after successful promotion.
- Leave the boundary block intact even when the inbox becomes empty.
