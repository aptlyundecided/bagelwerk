import { spawn } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_RENDER_TIMEOUT_MS = 30_000;
const SAFE_BASE_NAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export type MermaidCommandInvocation = {
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  env: NodeJS.ProcessEnv;
};

export type MermaidCommandResult = {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  errorMessage?: string;
};

export type RenderMermaidSvgDeps = {
  runCommand?: (invocation: MermaidCommandInvocation) => Promise<MermaidCommandResult>;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
};

export type RenderMermaidSvgInput = {
  mermaidSource: string;
  outputDirectory: string;
  baseName: string;
  mmdcCommand?: string;
  timeoutMs?: number;
  additionalArgs?: string[];
};

export type RenderMermaidSvgResult = {
  ok: boolean;
  mermaidPath: string;
  svgPath: string;
  command: string;
  args: string[];
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  errorMessage?: string;
};

function validateRenderInput(input: RenderMermaidSvgInput): void {
  if (!input.mermaidSource.trim()) throw new Error("mermaidSource is required");
  if (!input.outputDirectory.trim()) throw new Error("outputDirectory is required");
  if (!SAFE_BASE_NAME_PATTERN.test(input.baseName)) {
    throw new Error("baseName must contain only letters, numbers, dots, underscores, or hyphens");
  }
  if (input.timeoutMs !== undefined && (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0)) {
    throw new Error("timeoutMs must be a positive integer when provided");
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function assertSvgLooksRenderable(svgPath: string): Promise<string | undefined> {
  if (!(await fileExists(svgPath))) return `mmdc completed but did not create SVG output: ${svgPath}`;
  const contents = await readFile(svgPath, "utf8");
  if (!contents.includes("<svg")) return `mmdc created output that does not look like SVG: ${svgPath}`;
  return undefined;
}

type MermaidCliLaunch = {
  command: string;
  argsPrefix: string[];
};

async function resolveMermaidCliLaunch(cwd: string, explicitCommand: string | undefined): Promise<MermaidCliLaunch> {
  if (explicitCommand?.trim()) return { command: explicitCommand.trim(), argsPrefix: [] };

  const localCliPath = path.join(cwd, "node_modules", "@mermaid-js", "mermaid-cli", "src", "cli.js");
  if (await fileExists(localCliPath)) return { command: process.execPath, argsPrefix: [localCliPath] };

  return { command: "mmdc", argsPrefix: [] };
}

export async function runMermaidCliCommand(invocation: MermaidCommandInvocation): Promise<MermaidCommandResult> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, invocation.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: null, signal: null, stdout, stderr, timedOut, errorMessage: error.message });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, signal, stdout, stderr, timedOut });
    });
  });
}

export async function renderMermaidSvg(
  input: RenderMermaidSvgInput,
  deps: RenderMermaidSvgDeps = {},
): Promise<RenderMermaidSvgResult> {
  validateRenderInput(input);

  const outputDirectory = path.resolve(input.outputDirectory);
  const mermaidPath = path.join(outputDirectory, `${input.baseName}.mmd`);
  const svgPath = path.join(outputDirectory, `${input.baseName}.svg`);
  const cwd = path.resolve(deps.cwd ?? process.cwd());
  const launch = await resolveMermaidCliLaunch(cwd, input.mmdcCommand);
  const command = launch.command;
  const timeoutMs = input.timeoutMs ?? DEFAULT_RENDER_TIMEOUT_MS;
  const args = [...launch.argsPrefix, "-i", mermaidPath, "-o", svgPath, ...(input.additionalArgs ?? [])];

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(mermaidPath, input.mermaidSource, "utf8");

  const runCommand = deps.runCommand ?? runMermaidCliCommand;
  const result = await runCommand({
    command,
    args,
    cwd,
    timeoutMs,
    env: deps.env ?? process.env,
  });

  if (result.exitCode !== 0 || result.errorMessage || result.timedOut) {
    const errorMessage = result.errorMessage ?? (result.timedOut ? `mmdc timed out after ${timeoutMs}ms` : `mmdc exited with code ${result.exitCode}`);
    return {
      ok: false,
      mermaidPath,
      svgPath,
      command,
      args,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut ?? false,
      errorMessage,
    };
  }

  const svgError = await assertSvgLooksRenderable(svgPath);
  return {
    ok: !svgError,
    mermaidPath,
    svgPath,
    command,
    args,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: false,
    errorMessage: svgError,
  };
}
