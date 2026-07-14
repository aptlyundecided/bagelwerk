# Open-items index format

`INDEX.md` is a derived quick-reference for open items only.

## Canonical shape

```md
# Open Items Index

- OI-0001 — Short title — state: new — ./items/OI-0001.md
- OI-0002 — Another title — state: blocked — ./items/OI-0002.md

## Counter (next OI id)
OI-0003
```

## Rules

- Include only items whose state is not `done` and not `archived`.
- Render one bullet per open item.
- Keep bullets compact and token-cheap.
- Titles may be shortened in the index to the first 5 words plus `…` when longer than 5 words.
- Keep the counter block at the bottom and store the full next id string.
