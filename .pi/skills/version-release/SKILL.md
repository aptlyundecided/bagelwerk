---
name: version-release
description: >
  Use when the user asks to bump/increment the package version, prepare a release, produce
  changelog/release notes, or decide whether a change should be called out in the changelog.
---

# Version Release

A release-prep skill for coordinating package version bumps and changelog notes.

## Repo surfaces

- Package version: `package.json` and lockfile metadata when present.
- Changelog policy: `changelog/about.md`.
- Current notes: `changelog/unreleased.md`.
- Cut releases: `changelog/releases/<version>.md`.

## Modes

Infer the requested mode from the user:

1. **Changelog note only** — add or refine notes in `changelog/unreleased.md`; do not change package version.
2. **Version bump only** — increment package metadata; do not cut release notes unless requested.
3. **Release prep** — bump version, create release notes, and reset `changelog/unreleased.md`.

If the mode or bump type is ambiguous, ask before editing.

## Bump rules

Use SemVer language unless the operator gives an exact version:

- `patch` — fixes or polish that do not add a capability.
- `minor` — new user-visible capability, command, workflow, or supported surface.
- `major` — intentional breaking change for users/operators.
- exact version — use exactly what the operator gives.

Prefer `npm version <patch|minor|major|version> --no-git-tag-version` from the repo root so `package.json` and lockfiles stay aligned. Do **not** create git tags, commits, or publish packages unless explicitly asked.

## Changelog rules

`changelog/unreleased.md` is for user-visible notes only. Include things colleagues would notice:

- new or removed npm scripts / CLI commands,
- behavior changes,
- workflow changes,
- renamed or moved supported surfaces,
- release/process changes that affect operators.

Avoid logging purely internal refactors, test-only changes, formatting, or cleanup unless they change how someone uses the project.

Keep sections simple and Keep-a-Changelog-shaped when useful:

```md
# Unreleased

## Added

- ...

## Changed

- ...

## Removed

- ...
```

Remove empty sections when they add noise, unless preparing a reset stub after a release.

## Release prep flow

1. Read `package.json`, `changelog/about.md`, and `changelog/unreleased.md`.
2. Confirm the bump type or exact version if the user did not provide one.
3. Run `npm version <bump-or-version> --no-git-tag-version`.
4. Read the new version from `package.json`.
5. Create `changelog/releases/<version>.md` with today's date and release notes copied or summarized from `changelog/unreleased.md`.
6. Reset `changelog/unreleased.md` to an empty current stub.
7. Report changed files and suggested validation.

Suggested release file shape:

```md
# <version> - <YYYY-MM-DD>

## Added

- ...
```

Suggested reset stub:

```md
# Unreleased

No user-visible changes recorded yet.
```

## Safety

- Do not run live Flow/dogfood commands as part of release prep unless explicitly asked.
- If there are existing unrelated working-tree changes, call that out and avoid claiming the release diff is isolated.
- If `npm version` fails or the lockfile cannot be updated cleanly, stop and report the failure instead of hand-editing around it.
