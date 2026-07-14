import { spawn } from "node:child_process";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { resolveEnv, resolveRunDir, writeArtifactFile } from "../runtimeAccess";

export const RunCommandNodeParamsSchema = z.object({
  command: z.string().trim().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().trim().min(1).optional(),
  artifactPath: z.string().trim().min(1).default("command-stdout.txt"),
  timeoutMs: z.number().int().positive().max(600_000).default(120_000),
  allowNonZeroExit: z.boolean().default(false),
}).strict();
export type RunCommandNodeParams = z.infer<typeof RunCommandNodeParamsSchema>;

export type RunCommandNodePayload = {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  artifactFiles: EmittedNodeArtifactRecord[];
};

export type CommandRunner = (args: {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
}) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

// Default runner: spawn the command directly (shell:false so args are not re-parsed).
const defaultCommandRunner: CommandRunner = ({ command, args, cwd, timeoutMs, env }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`Command timed out after ${timeoutMs}ms: ${command}`));
      else resolve({ exitCode: code ?? 0, stdout, stderr });
    });
  });

export async function runRunCommandNode(args: {
  params: RunCommandNodeParams;
  input: unknown;
  commandRunner?: CommandRunner;
}): Promise<NodeResult<RunCommandNodePayload>> {
  const runDir = resolveRunDir(args.input);
  const runner = args.commandRunner ?? defaultCommandRunner;
  const result = await runner({
    command: args.params.command,
    args: args.params.args,
    cwd: args.params.cwd ?? process.cwd(),
    timeoutMs: args.params.timeoutMs,
    env: resolveEnv(args.input),
  });
  const file = await writeArtifactFile(runDir, args.params.artifactPath, result.stdout, args.params.artifactPath);
  const ok = result.exitCode === 0 || args.params.allowNonZeroExit;
  const display = [args.params.command, ...args.params.args].join(" ");
  return {
    status: ok ? "completed" : "failed",
    note: ok ? `Command exited ${result.exitCode}: ${display}` : `Command failed (exit ${result.exitCode}): ${display}${result.stderr ? ` — ${result.stderr.trim().slice(0, 200)}` : ""}`,
    payload: { command: display, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, artifactFiles: [file] },
  };
}

export const coreRunCommandNodeTypeEntry: NodeTypeEntry<RunCommandNodeParams, unknown, RunCommandNodePayload> = {
  nodeType: "core.run-command",
  label: "Core Run Command",
  validateParams: (value) => RunCommandNodeParamsSchema.parse(value),
  execute: async ({ params, working }) => runRunCommandNode({ params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = RunCommandNodeParamsSchema.parse(params);
    return { outputs: [{ key: parsed.artifactPath, label: parsed.artifactPath, relativePath: parsed.artifactPath, kind: "report" }] };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
