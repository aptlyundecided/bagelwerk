#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";

function usage(): string {
  return [
    "artifacts-purge CLI — delete contents of repo-root `.artifacts/`",
    "",
    "Usage: npm run artifacts:purge -- [--yes] [--root <path>]",
    "   or: npx tsx .pi/skills/artifacts-purge/cli/artifactsPurgeCli.ts [--yes] [--root <path>]",
    "",
    "Default is dry-run: lists entries that would be deleted, no filesystem changes.",
    "`--yes` performs deletion. Leaves the `.artifacts/` directory itself in place.",
    "Refuses if `.artifacts/` resolves outside the repo root or is a symlink.",
    "",
    "Options:",
    "  --yes              Actually delete (no-op without this flag).",
    "  --root <path>      Repo root (default: cwd).",
    "  -h, --help         Show help.",
  ].join("\n");
}

type Entry = {
  absPath: string;
  relPath: string;
  kind: "file" | "dir" | "symlink";
};

async function listArtifactsEntries(artifactsDir: string, repoRoot: string): Promise<Entry[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(artifactsDir);
  } catch {
    return [];
  }
  const entries: Entry[] = [];
  for (const name of names) {
    const abs = path.join(artifactsDir, name);
    const stat = await fs.lstat(abs);
    const kind: Entry["kind"] = stat.isSymbolicLink()
      ? "symlink"
      : stat.isDirectory()
        ? "dir"
        : "file";
    entries.push({
      absPath: abs,
      relPath: path.relative(repoRoot, abs).split(path.sep).join("/"),
      kind,
    });
  }
  return entries.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

async function removeEntry(entry: Entry): Promise<void> {
  if (entry.kind === "dir") {
    await fs.rm(entry.absPath, { recursive: true, force: true });
    return;
  }
  await fs.unlink(entry.absPath);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(usage());
    return 0;
  }

  let repoRoot = process.cwd();
  let yes = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      const next = argv[i + 1];
      if (!next) {
        console.error("Missing value for --root");
        return 1;
      }
      repoRoot = path.resolve(next);
      i += 1;
      continue;
    }
    if (arg === "--yes") {
      yes = true;
      continue;
    }
    console.error(`Unknown argument: ${arg}`);
    console.error(usage());
    return 1;
  }

  const repoRootResolved = path.resolve(repoRoot);
  const artifactsDir = path.resolve(repoRootResolved, ".artifacts");

  const relFromRoot = path.relative(repoRootResolved, artifactsDir);
  if (relFromRoot !== ".artifacts") {
    console.error(`Refusing: resolved artifacts path "${relFromRoot}" is not directly ".artifacts" under repo root`);
    return 1;
  }

  let topStat: import("node:fs").Stats | null = null;
  try {
    topStat = await fs.lstat(artifactsDir);
  } catch {
    topStat = null;
  }

  if (!topStat) {
    console.error(`No .artifacts/ directory at ${artifactsDir}; nothing to do.`);
    return 0;
  }
  if (topStat.isSymbolicLink()) {
    console.error(`Refusing: ${artifactsDir} is a symlink; resolve manually before purging`);
    return 1;
  }
  if (!topStat.isDirectory()) {
    console.error(`Refusing: ${artifactsDir} exists but is not a directory`);
    return 1;
  }

  const entries = await listArtifactsEntries(artifactsDir, repoRootResolved);
  if (entries.length === 0) {
    console.error(`${path.relative(repoRootResolved, artifactsDir).split(path.sep).join("/")} is already empty.`);
    return 0;
  }

  if (!yes) {
    console.error(
      `DRY-RUN: would delete ${entries.length} top-level entr${entries.length === 1 ? "y" : "ies"} under .artifacts/ (re-run with --yes to actually delete).`,
    );
    for (const entry of entries) {
      console.log(`${entry.kind === "dir" ? "dir " : entry.kind === "symlink" ? "link" : "file"} ${entry.relPath}`);
    }
    return 0;
  }

  let removed = 0;
  let failed = 0;
  for (const entry of entries) {
    try {
      await removeEntry(entry);
      removed += 1;
      console.log(`${entry.kind === "dir" ? "dir " : entry.kind === "symlink" ? "link" : "file"} ${entry.relPath}`);
    } catch (e) {
      failed += 1;
      console.error(`FAILED ${entry.relPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.error(
    `Removed ${removed} entr${removed === 1 ? "y" : "ies"}${failed ? `; ${failed} failed` : ""}.`,
  );
  return failed > 0 ? 1 : 0;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error instanceof Error ? error.stack ?? error.message : String(error));
      process.exit(1);
    });
}
