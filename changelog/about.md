# Changelog

All notable **user-visible** changes to **Bagelwerk** are documented here.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning follows repo package releases.

**Policy (OI-0064):** add entries under `[Unreleased]` only when colleagues would notice—new onboarding flows, CLI commands, behavior changes—not refactors, tests, or internal-only work.

## Versioning pull requests

Each PR into `main` carries one patch bump from the current version on `main` (for example, `0.4.1` → `0.4.2`). Use a minor bump instead only by explicit agreement. If another PR merges first, refresh the version and release-note filename before merging; review fixes on the same PR do not need another bump.

Update `package.json` and the lockfile together with `npm version <bump> --no-git-tag-version`. Include a dated `changelog/releases/<version>.md` describing what this PR changes. For internal-only work, a short description is enough. Tagging and publishing are separate from the PR version bump.

## Structure

- `unreleased.md` — current user-visible changes not yet cut into a package version.
- `releases/` — archived release notes by version.

## Policy

Add entries only when colleagues would notice: new CLI commands, behavior changes, workflow changes, or removed surfaces. Avoid logging refactors, test-only changes, and internal cleanup unless they change how someone uses the project.
