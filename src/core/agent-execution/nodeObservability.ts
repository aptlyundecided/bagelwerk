import { randomUUID } from "node:crypto";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type NodeExecutionStatus = "completed" | "failed";
export type NodeQualityStatus = "success" | "degraded" | "failed";

export type NodeObservationSummary = {
  runId?: string;
  nodeId: string;
  startedAt: string;
  finishedAt?: string;
  executionStatus?: NodeExecutionStatus;
  qualityStatus?: NodeQualityStatus;
  qualityReasons?: string[];
  errorMessage?: string;
  [key: string]: unknown;
};

export type NodeObservation = {
  artifactDir: string;
  writeText(relativePath: string, content: string): Promise<void>;
  writeJson(relativePath: string, value: unknown): Promise<void>;
  appendNdjson(relativePath: string, value: unknown): Promise<void>;
  finalize(summary: Omit<NodeObservationSummary, "runId" | "nodeId" | "startedAt" | "finishedAt">): Promise<void>;
};

function safePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "value";
}

function timestamp(date: Date): string {
  return date.toISOString().replace(/:/g, "-").replace(/\./g, "-");
}

function resolveArtifactsRoot(env: NodeJS.ProcessEnv): string {
  return path.resolve(env.BAGELWERK_AGENT_ARTIFACTS_ROOT?.trim() || path.join(process.cwd(), ".artifacts", "agents"));
}

export async function beginNodeObservation(
  params: { runId?: string; nodeId: string },
  deps: { env?: NodeJS.ProcessEnv; now?: () => Date; randomId?: () => string } = {},
): Promise<NodeObservation> {
  const now = deps.now ?? (() => new Date());
  const started = now();
  const root = resolveArtifactsRoot(deps.env ?? process.env);
  const artifactDir = path.join(
    root,
    safePart(params.runId ?? "run"),
    `${timestamp(started)}-${safePart(params.nodeId)}-${safePart(deps.randomId?.() ?? randomUUID())}`,
  );
  await mkdir(artifactDir, { recursive: true });

  async function writeText(relativePath: string, content: string): Promise<void> {
    const out = path.join(artifactDir, relativePath);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, content, "utf8");
  }

  async function writeJson(relativePath: string, value: unknown): Promise<void> {
    await writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
  }

  await writeJson("summary.json", { runId: params.runId, nodeId: params.nodeId, startedAt: started.toISOString() });

  return {
    artifactDir,
    writeText,
    writeJson,
    async appendNdjson(relativePath: string, value: unknown): Promise<void> {
      const out = path.join(artifactDir, relativePath);
      await mkdir(path.dirname(out), { recursive: true });
      await appendFile(out, `${JSON.stringify(value)}\n`, "utf8");
    },
    async finalize(summary) {
      await writeJson("summary.json", {
        runId: params.runId,
        nodeId: params.nodeId,
        startedAt: started.toISOString(),
        finishedAt: now().toISOString(),
        ...summary,
      });
    },
  };
}

