#!/usr/bin/env tsx
import { scaffoldFlow } from "./flowInit";

function parseArgs(argv: string[]): { name?: string; parentDir?: string; force: boolean; help: boolean } {
  const parsed: { name?: string; parentDir?: string; force: boolean; help: boolean } = { force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--dir") parsed.parentDir = argv[++index];
    else if (arg === "--force") parsed.force = true;
    else if (!arg.startsWith("-") && !parsed.name) parsed.name = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
}

function printUsage(): void {
  console.log([
    "Usage:",
    "  npm run flow:init -- <flow-name> [--dir <parent>] [--force]",
    "",
    "Scaffolds a runnable, chained starter Flow built from the generic primitive Nodes.",
    "",
    "Arguments:",
    "  <flow-name>      Lowercase name, e.g. my-first-flow (becomes flow-library/<name>/)",
    "",
    "Options:",
    "  --dir <parent>   Parent directory for the new Flow (default: flow-library)",
    "  --force          Scaffold into a non-empty directory",
  ].join("\n"));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.name) {
    printUsage();
    if (!args.name && !args.help) process.exitCode = 2;
    return;
  }
  const result = await scaffoldFlow({ name: args.name, ...(args.parentDir ? { parentDir: args.parentDir } : {}), force: args.force });
  console.log([
    `✓ Scaffolded ${result.flowId} in ${result.targetDir}`,
    `  files: ${result.files.join(", ")}`,
    "",
    "Run it:",
    `  ${result.runCommand}`,
    "",
    "Then open the generated README.md to make it your own (add an agent step, fan in more inputs).",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
