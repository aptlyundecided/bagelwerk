# Open-items skill verification

Use this checklist to verify the v1 open-items skill behavior.

## Coverage areas

### 1. ID generation
- Start from an empty `.agents/open-items/INDEX.md` counter of `OI-0001`.
- Promote one capture item.
- Verify the created file is `OI-0001.md`.
- Verify the counter advances to `OI-0002`.
- Promote another item later and verify `OI-0002.md` is used.

### 2. Capture parsing and removal
- Put two H1 sections below `Begin Items Capture` / `---`.
- Promote all capture items.
- Verify both item files are created in file order.
- Verify both H1 sections are removed from `OPEN_ITEMS_CAPTURE.md`.
- Verify content above the boundary is unchanged.

### 3. Summary vs notes split
- Use a capture item with a blank line between the first paragraph and later notes.
- Promote it.
- Verify the first paragraph lands in `## summary`.
- Verify later paragraphs land in `## notes/discoveries`.

### 4. Index filtering
- Mark one item `done` and one item `archived`.
- Regenerate `INDEX.md`.
- Verify those ids are omitted.
- Verify `new`, `triaged`, `ready`, `in_progress`, and `blocked` remain listed.

### 5. Counter preservation
- Regenerate `INDEX.md` without creating a new item.
- Verify the counter block is preserved.
- Create a new item afterward and verify the counter advances exactly once.

## Current dogfood artifact

The first dogfood promotion produced:
- `.agents/open-items/items/OI-0001.md`
- `.agents/open-items/INDEX.md`
- cleared `OPEN_ITEMS_CAPTURE.md` below the boundary

Dogfood follow-up captured as an open item:
- `.agents/open-items/items/OI-0002.md` — capture formatting guidance
- `.agents/open-items/INDEX.md` now advances the counter to `OI-0003`
