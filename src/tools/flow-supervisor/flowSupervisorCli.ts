#!/usr/bin/env tsx
import path from "node:path";
import { confirm, input, number, select } from "@inquirer/prompts";
import { config as loadDotEnv } from "dotenv";

import {
  discoverExternalFlowCatalog,
  parseJsonInput,
  resolveExternalFlowCatalogEntry,
  type ExternalFlowCatalog,
  type ExternalFlowCatalogEntry,
  type ExternalFlowInputPrompt,
  type ExternalFlowRunProfile,
} from "../../core/flow-runner";
import { runSupervisedExternalFlow } from "../../core/flow-supervisor";

loadDotEnv({ quiet: true });

type SupervisorRunMode = "advanced" | "local" | "managed-worktree" | "sandbox";

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`${name} requires a value.`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function printUsage(): void {
  console.error(`Usage:
  npm run flow:supervisor                         # pick a Flow interactively
  npm run flow:supervisor -- list [--json] [--cwd <path>]
  npm run flow:supervisor -- run <flow-or-alias> [inputJson] [--session <id>] [--profile <id>] [--mode local|advanced] [--yes]
  npm run flow:supervisor -- run-flow <flow-id> <session-id> [inputJson] --target-worktree <path> [--cwd <path>] [--allow-dirty-worktree]

Friendly commands discover external Flows from flow-library/*/flow.config.json. Advanced run-flow keeps explicit flags.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cwd = takeOption(args, "--cwd");
  const targetWorkspace = takeOption(args, "--target-worktree");
  const sessionOption = takeOption(args, "--session");
  const profileOption = takeOption(args, "--profile");
  const modeOption = takeOption(args, "--mode") as SupervisorRunMode | undefined;
  const asJson = takeFlag(args, "--json");
  const allowDirtyWorktree = takeFlag(args, "--allow-dirty-worktree");
  const noPrompt = takeFlag(args, "--yes") || takeFlag(args, "--no-input");
  const command = args.shift() ?? "pick";

  if (command === "-h" || command === "--help" || command === "help") {
    printUsage();
    return;
  }

  if (command === "list") {
    const catalog = await discoverExternalFlowCatalog({ ...(cwd ? { cwd, includeCwd: true } : {}) });
    if (asJson) console.log(JSON.stringify(catalog, null, 2));
    else console.log(renderFlowCatalogTable(catalog));
    return;
  }

  if (command === "pick") {
    const catalog = await discoverExternalFlowCatalog({ ...(cwd ? { cwd, includeCwd: true } : {}) });
    const entry = await pickFlow(catalog);
    await runFriendlyFlow({ entry, inputJson: undefined, sessionOption, profileOption, modeOption, targetWorkspace, allowDirtyWorktree });
    return;
  }

  if (command === "run") {
    const [selector, inputJson] = args;
    if (!selector) {
      printUsage();
      process.exitCode = 2;
      return;
    }
    const catalog = await discoverExternalFlowCatalog({ ...(cwd ? { cwd, includeCwd: true } : {}) });
    const resolved = resolveExternalFlowCatalogEntry(catalog, selector);
    if (!resolved.ok) throw new Error(resolved.message);
    await runFriendlyFlow({ entry: resolved.entry, inputJson, sessionOption, profileOption, modeOption, targetWorkspace, allowDirtyWorktree, noPrompt });
    return;
  }

  if (command === "run-flow") {
    await runAdvancedFlow({ args, cwd, targetWorkspace, allowDirtyWorktree });
    return;
  }

  printUsage();
  throw new Error(`Unknown command: ${command}`);
}

async function runAdvancedFlow(args: { args: string[]; cwd?: string; targetWorkspace?: string; allowDirtyWorktree: boolean }): Promise<void> {
  const [flowId, sessionId, inputJson] = args.args;
  if (!flowId || !sessionId || !args.targetWorkspace) {
    printUsage();
    process.exitCode = 2;
    return;
  }
  const parsedInput = parseJsonInput(inputJson);
  const result = await runSupervisedExternalFlow({
    ...(args.cwd ? { cwd: args.cwd } : {}),
    targetWorkspace: args.targetWorkspace,
    flowId,
    sessionId,
    input: parsedInput,
    supervisorPolicy: args.allowDirtyWorktree ? { workspace: { allowDirtyWorktree: true } } : undefined,
  });
  printRunResult({ flowId, sessionId, result });
}

async function runFriendlyFlow(args: {
  entry: ExternalFlowCatalogEntry;
  inputJson?: string;
  sessionOption?: string;
  profileOption?: string;
  modeOption?: SupervisorRunMode;
  targetWorkspace?: string;
  allowDirtyWorktree: boolean;
  noPrompt?: boolean;
}): Promise<void> {
  const profile = await resolveProfile(args.entry, args.profileOption);
  const parsedInput = parseJsonInput(args.inputJson);
  const promptInput = await collectPromptInput(args.entry.prompts ?? [], profile?.inputDefaults ?? {}, { interactive: !args.noPrompt, provided: parsedInput });
  const runInput = { ...(profile?.inputDefaults ?? {}), ...promptInput, ...parsedInput };
  const sessionId = args.sessionOption ?? generateSessionId(args.entry.supervisor?.sessionPrefix ?? args.entry.aliases[0] ?? args.entry.localId);
  const mode = args.modeOption ?? args.entry.supervisor?.runMode ?? "local";
  const runContext = resolveRunContext({ entry: args.entry, mode, targetWorkspace: args.targetWorkspace, allowDirtyWorktree: args.allowDirtyWorktree });

  printPreRunSummary({ entry: args.entry, sessionId, mode, profile, runInput, runContext });
  const result = await runSupervisedExternalFlow({
    cwd: runContext.cwd,
    targetWorkspace: runContext.targetWorkspace,
    flowId: args.entry.id,
    sessionId,
    input: runInput,
    ...(profile?.executionPlan ? { executionPlan: profile.executionPlan } : {}),
    supervisorPolicy: runContext.supervisorPolicy,
  });
  printRunResult({ flowId: args.entry.id, sessionId, result, label: args.entry.label });
}

function renderFlowCatalogTable(catalog: ExternalFlowCatalog): string {
  if (catalog.flows.length === 0) return "No external Flows discovered. Add flow.config.json under flow-library/<name>/ or pass --cwd <path>.";
  const idWidth = Math.max("FLOW".length, ...catalog.flows.map((flow) => flow.id.length));
  const aliasWidth = Math.max("ALIASES".length, ...catalog.flows.map((flow) => flow.aliases.join(", ").length));
  const pad = (value: string, width: number) => value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
  return [
    "Available external Flows:",
    "",
    `  ${pad("FLOW", idWidth)}  ${pad("ALIASES", aliasWidth)}  LABEL`,
    `  ${"-".repeat(idWidth)}  ${"-".repeat(aliasWidth)}  -----`,
    ...catalog.flows.map((flow) => `  ${pad(flow.id, idWidth)}  ${pad(flow.aliases.join(", "), aliasWidth)}  ${flow.label}`),
    ...(catalog.diagnostics.length > 0 ? ["", "Diagnostics:", ...catalog.diagnostics.map((diag) => `  ${diag.severity.toUpperCase()} ${diag.sourceRoot}: ${diag.message}`)] : []),
  ].join("\n");
}

async function pickFlow(catalog: ExternalFlowCatalog): Promise<ExternalFlowCatalogEntry> {
  if (catalog.flows.length === 0) throw new Error("No external Flows discovered.");
  return select({
    message: "Pick a Flow to run",
    pageSize: 20,
    choices: catalog.flows.map((flow) => ({ name: `${flow.label} (${flow.aliases[0] ?? flow.id})`, value: flow, description: flow.description })),
  });
}

async function resolveProfile(entry: ExternalFlowCatalogEntry, profileId: string | undefined): Promise<ExternalFlowRunProfile | undefined> {
  const profiles = entry.profiles ?? [];
  if (profiles.length === 0) return undefined;
  if (profileId) {
    const match = profiles.find((profile) => profile.id === profileId);
    if (!match) throw new Error(`Unknown profile '${profileId}'. Known profiles: ${profiles.map((profile) => profile.id).join(", ")}`);
    return match;
  }
  if (profiles.length === 1) return profiles[0];
  return select({
    message: "Pick a run profile",
    choices: profiles.map((profile) => ({ name: profile.label, value: profile, description: profile.description })),
  });
}

async function collectPromptInput(
  prompts: ExternalFlowInputPrompt[],
  defaults: Record<string, unknown>,
  options: { interactive?: boolean; provided?: Record<string, unknown> } = {},
): Promise<Record<string, unknown>> {
  const interactive = options.interactive ?? true;
  const provided = options.provided ?? {};
  const values: Record<string, unknown> = {};
  for (const prompt of prompts) {
    const defaultValue = provided[prompt.key] ?? defaults[prompt.key] ?? prompt.default;
    // Non-interactive (--yes) or an already-provided value: use the resolved default without prompting.
    if (!interactive || provided[prompt.key] !== undefined) {
      if (defaultValue !== undefined) values[prompt.key] = defaultValue;
      continue;
    }
    if (prompt.kind === "confirm") values[prompt.key] = await confirm({ message: prompt.label, default: Boolean(defaultValue) });
    else if (prompt.kind === "number") values[prompt.key] = await number({ message: prompt.label, default: typeof defaultValue === "number" ? defaultValue : undefined, min: prompt.min, max: prompt.max, required: prompt.required ?? false });
    else if (prompt.kind === "select") values[prompt.key] = await select({ message: prompt.label, choices: (prompt.choices ?? []).map((choice) => ({ name: choice.label, value: choice.value })) });
    else values[prompt.key] = await input({ message: prompt.label, default: typeof defaultValue === "string" ? defaultValue : undefined, required: prompt.required ?? false });
  }
  return values;
}

function resolveRunContext(args: { entry: ExternalFlowCatalogEntry; mode: SupervisorRunMode; targetWorkspace?: string; allowDirtyWorktree: boolean }) {
  if (args.mode !== "local" && args.mode !== "advanced") {
    throw new Error(`Run mode '${args.mode}' is reserved for a future managed workspace implementation. Use --mode local or explicit run-flow for now.`);
  }
  const cwd = args.entry.cwd;
  const targetWorkspace = path.resolve(args.targetWorkspace ?? args.entry.supervisor?.targetWorkspace ?? cwd);
  const localMode = args.mode === "local";
  return {
    cwd,
    targetWorkspace,
    supervisorPolicy: {
      workspace: {
        requireIsolatedWorktree: !localMode,
        allowDirtyWorktree: args.allowDirtyWorktree || localMode || args.entry.supervisor?.allowDirtyWorktree === true,
        allowMainWorktreeOverride: localMode,
      },
    },
  };
}

function generateSessionId(seed: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z").replace("T", "-");
  const safeSeed = seed.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "flow";
  return `${safeSeed}-${stamp}`;
}

function printPreRunSummary(args: {
  entry: ExternalFlowCatalogEntry;
  sessionId: string;
  mode: SupervisorRunMode;
  profile?: ExternalFlowRunProfile;
  runInput: Record<string, unknown>;
  runContext: { cwd: string; targetWorkspace: string };
}): void {
  const req = args.entry.requirements;
  console.error([
    "",
    "Flow Supervisor",
    `Flow:      ${args.entry.label} (${args.entry.id})`,
    `Session:   ${args.sessionId}`,
    `Mode:      ${args.mode}`,
    `CWD:       ${args.runContext.cwd}`,
    `Target:    ${args.runContext.targetWorkspace}`,
    ...(args.profile ? [`Profile:   ${args.profile.label}`] : []),
    ...(req ? [`Requires:  ${[
      req.agentRuntime ? `agent=${req.agentRuntime}` : undefined,
      req.network ? "network" : undefined,
      req.writesDurableState ? "writes-state" : undefined,
      req.estimatedDurationMinutes ? `~${req.estimatedDurationMinutes}m` : undefined,
    ].filter(Boolean).join(", ") || "none declared"}`] : []),
    Object.keys(args.runInput).length > 0 ? `Input:     ${JSON.stringify(args.runInput)}` : "Input:     {}",
    "",
  ].join("\n"));
}

function printRunResult(args: { flowId: string; sessionId: string; result: Awaited<ReturnType<typeof runSupervisedExternalFlow>>; label?: string }): void {
  const summary = {
    flowId: args.flowId,
    ...(args.label ? { label: args.label } : {}),
    sessionId: args.sessionId,
    supervisorStatus: args.result.supervisor.status,
    flowStatus: args.result.flowResult?.run.runTree.status,
    summaryPath: args.result.supervisor.artifacts.summaryPath,
    metricsPath: args.result.supervisor.artifacts.metricsPath,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.error(`\nFlow Supervisor summary: ${args.result.supervisor.artifacts.summaryPath}`);

  if (args.result.supervisor.status === "aborted" || args.result.supervisor.status === "blocked" || args.result.supervisor.status === "failed" || args.result.flowResult?.run.runTree.status !== "completed") {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
