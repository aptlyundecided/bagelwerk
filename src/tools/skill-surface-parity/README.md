# Skill surface parity CLI

Mirrors `.pi/skills/<skill>/` trees into the matching local harness skill surfaces.

## Scope

- source of truth for this tool: `.pi/skills/`
- default targets: `.codex/skills/`, `.claude/skills/`, `.cursor/skills/`, `.antigravitycli/skills/`
- preserves target-only skills
- copies missing files and overwrites outdated files deterministically
- supports `--report-only` for no-write inspection
- supports `--skill <name>` to limit sync to one or more skills

## Usage

```bash
npm run skills:sync:report
npm run skills:sync
```

Target one skill:

```bash
tsx src/tools/skill-surface-parity/skillSurfaceParityCli.ts --report-only --skill todo-monitor
```
