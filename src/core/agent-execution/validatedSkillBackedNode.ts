import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  executeSkillBackedNodeSession,
  type ExecuteSkillBackedNodeSessionDeps,
  type SkillBackedNodeSessionParams,
  type SkillBackedNodeInputArtifact,
  type SkillBackedNodeSessionResult,
} from "./skillBackedCore";

export type ValidatedSkillBackedNodeValidation = {
  ok: boolean;
  issues?: string[];
  summary?: string;
  structuralState?: string;
  missingArtifactIds?: string[];
  publishedArtifactIds?: string[];
  rawArtifactText?: string;
  artifact?: unknown;
  [key: string]: unknown;
};

export type ValidatedSkillBackedNodeAttempt<TValidation extends ValidatedSkillBackedNodeValidation = ValidatedSkillBackedNodeValidation> = {
  attempt: number;
  kind: "initial" | "retry" | "repair";
  status: "valid" | "invalid" | "error";
  attemptDir: string;
  startedAt: string;
  finishedAt: string;
  issueCount: number;
  issues: string[];
  skillResult?: SkillBackedNodeSessionResult;
  validation?: TValidation;
  errorMessage?: string;
  promptPath?: string;
  rawOutputPath?: string;
  outputArtifactsPath?: string;
  validationPath?: string;
  retryContextPath?: string;
  failureContextPath?: string;
  observationDir?: string;
  provider?: string;
  model?: string;
  agentRuntime?: string;
};

export type SkillBackedHealingSummary = {
  schemaVersion: 1;
  status: "completed_clean" | "completed_after_retry" | "failed_after_retries" | "in_progress";
  maxRetries: number;
  finalAttempt: number;
  recovered: boolean;
  attempts: Array<{
    attempt: number;
    kind: "initial" | "retry" | "repair";
    status: "valid" | "invalid" | "error";
    startedAt: string;
    finishedAt: string;
    issueCount: number;
    issues: string[];
    validationPath?: string;
    rawOutputPath?: string;
    promptPath?: string;
    retryContextPath?: string;
    failureContextPath?: string;
    observationDir?: string;
    provider?: string;
    model?: string;
    agentRuntime?: string;
    errorMessage?: string;
  }>;
};

export type ValidatedSkillBackedNodeRetryPolicy<TValidation extends ValidatedSkillBackedNodeValidation = ValidatedSkillBackedNodeValidation> = {
  /** Defaults to 2 retries after the initial attempt. */
  maxRetries?: number;
  /** Set false for explicit custom/exempt behavior. */
  enabled?: boolean;
  shouldRetry?: (args: {
    attempt: ValidatedSkillBackedNodeAttempt<TValidation>;
    attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
    maxRetries: number;
  }) => boolean | Promise<boolean>;
  buildRetryInstructions?: (args: {
    nextAttempt: number;
    attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
    defaultInstructions: string;
  }) => string;
};

/** Outcome of the judgement step: salvage the existing output, or re-run the full node. */
export type RepairJudgement = { action: "repair" | "rerun"; json?: string };

export type RepairJudgeArgs = {
  failingText: string;
  issues: string[];
  attemptDir: string;
  session: SkillBackedNodeSessionParams;
  deps: ExecuteSkillBackedNodeSessionDeps;
  model: string;
};

/**
 * Generic "judgement repair" for any agent-backed Node that must emit fixed JSON. When validation
 * fails, a fast/low-reasoning judge decides repair-vs-rerun; a repaired candidate is RE-VALIDATED
 * against the same schema (`revalidate`) before acceptance — the judge is never trusted.
 */
export type ValidatedSkillBackedRepairPolicy<TValidation extends ValidatedSkillBackedNodeValidation = ValidatedSkillBackedNodeValidation> = {
  enabled?: boolean;          // default true when the policy is provided
  maxRepairs?: number;        // default 1 (across the whole run, before full retries)
  model?: string;             // default: params.session.model
  /** Re-validate a candidate JSON string against the SAME schema as the initial validate(). */
  revalidate: (repairedText: string, attemptDir: string) => Promise<TValidation> | TValidation;
  /** Injectable for tests; defaults to a skill-backed low-reasoning judge. */
  judge?: (args: RepairJudgeArgs) => Promise<RepairJudgement> | RepairJudgement;
};

export type ExecuteValidatedSkillBackedNodeParams<TValidation extends ValidatedSkillBackedNodeValidation> = {
  session: SkillBackedNodeSessionParams;
  deps?: ExecuteSkillBackedNodeSessionDeps;
  healingArtifactRoot: string;
  validate: (args: {
    skillResult: SkillBackedNodeSessionResult;
    attempt: number;
    attemptDir: string;
  }) => Promise<TValidation> | TValidation;
  retryPolicy?: ValidatedSkillBackedNodeRetryPolicy<TValidation>;
  repair?: ValidatedSkillBackedRepairPolicy<TValidation>;
};

export type ExecuteValidatedSkillBackedNodeResult<TValidation extends ValidatedSkillBackedNodeValidation> = {
  skillResult: SkillBackedNodeSessionResult;
  validation: TValidation;
  attempts: ValidatedSkillBackedNodeAttempt<TValidation>[];
  summary: SkillBackedHealingSummary;
  summaryPath: string;
};

const DEFAULT_MAX_RETRIES = 2;

/**
 * Load prior attempt history from an existing skill-healing-summary.json in
 * `healingArtifactRoot`. When `executeValidatedSkillBackedNode` is called again
 * on the same root (e.g. after a resume), prior failed attempts are carried
 * forward as context so the fresh run starts from where history left off
 * instead of repeating already-exhausted attempts from scratch.
 */
async function loadPriorAttemptHistory<TValidation extends ValidatedSkillBackedNodeValidation>(
  healingArtifactRoot: string,
): Promise<ValidatedSkillBackedNodeAttempt<TValidation>[]> {
  const summaryPath = path.join(healingArtifactRoot, "skill-healing-summary.json");
  try {
    const summary = await readSkillHealingSummary(summaryPath);
    // If a previous run already completed successfully, don't carry stale history —
    // the flow runner should have accepted the node; if it didn't, start fresh.
    if (summary.status === "completed_clean" || summary.status === "completed_after_retry") {
      return [];
    }
    // Reconstruct minimal attempt records from the serialised summary.
    return summary.attempts.map((a) => ({
      attempt: a.attempt,
      kind: a.kind,
      status: a.status,
      attemptDir: path.join(healingArtifactRoot, "skill-attempts", attemptLabel(a.attempt)),
      startedAt: a.startedAt,
      finishedAt: a.finishedAt,
      issueCount: a.issueCount,
      issues: a.issues,
      ...(a.validationPath ? { validationPath: a.validationPath } : {}),
      ...(a.rawOutputPath ? { rawOutputPath: a.rawOutputPath } : {}),
      ...(a.promptPath ? { promptPath: a.promptPath } : {}),
      ...(a.retryContextPath ? { retryContextPath: a.retryContextPath } : {}),
      ...(a.failureContextPath ? { failureContextPath: a.failureContextPath } : {}),
      ...(a.observationDir ? { observationDir: a.observationDir } : {}),
      ...(a.provider ? { provider: a.provider } : {}),
      ...(a.model ? { model: a.model } : {}),
      ...(a.agentRuntime ? { agentRuntime: a.agentRuntime } : {}),
      ...(a.errorMessage ? { errorMessage: a.errorMessage } : {}),
    })) as ValidatedSkillBackedNodeAttempt<TValidation>[];
  } catch {
    return [];
  }
}

export async function executeValidatedSkillBackedNode<TValidation extends ValidatedSkillBackedNodeValidation>(
  params: ExecuteValidatedSkillBackedNodeParams<TValidation>,
): Promise<ExecuteValidatedSkillBackedNodeResult<TValidation>> {
  const maxRetries = normalizeMaxRetries(params.retryPolicy);
  const maxAttempts = maxRetries + 1;
  let lastError: unknown;

  await mkdir(params.healingArtifactRoot, { recursive: true });

  // Carry prior attempt history from a previous invocation on the same root.
  // This means a resumed run starts fresh attempts from attempt N+1 (after the
  // prior failed attempts) rather than overwriting them from attempt-001.
  const priorAttempts = await loadPriorAttemptHistory<TValidation>(params.healingArtifactRoot);
  const attempts: ValidatedSkillBackedNodeAttempt<TValidation>[] = [...priorAttempts];
  const freshAttemptStart = priorAttempts.length + 1;

  const repairPolicy = params.repair;
  const repairEnabled = Boolean(repairPolicy) && repairPolicy!.enabled !== false;
  const maxRepairs = repairPolicy?.maxRepairs ?? 1;
  let repairsUsed = 0;

  for (let freshIndex = 0; freshIndex < maxAttempts; freshIndex += 1) {
    const attemptNumber = freshAttemptStart + freshIndex;
    const attemptDir = path.join(params.healingArtifactRoot, "skill-attempts", attemptLabel(attemptNumber));
    await mkdir(attemptDir, { recursive: true });
    // Write retry context when there is any prior history — either from earlier
    // attempts in this run or carried from a previous run on the same root.
    const retryContextPath = attempts.length > 0
      ? await writeRetryContext({ attemptDir, nextAttempt: attemptNumber, attempts, retryPolicy: params.retryPolicy })
      : undefined;
    const session = retryContextPath
      ? sessionWithRetryContext({ session: params.session, retryContextPath, nextAttempt: attemptNumber, attempts, retryPolicy: params.retryPolicy })
      : params.session;

    const startedAt = new Date().toISOString();
    try {
      const skillResult = await executeSkillBackedNodeSession(session, params.deps ?? {});
      const validation = await params.validate({ skillResult, attempt: attemptNumber, attemptDir });
      const finishedAt = new Date().toISOString();
      const issues = normalizeIssues(validation.issues);
      const attempt: ValidatedSkillBackedNodeAttempt<TValidation> = {
        attempt: attemptNumber,
        kind: freshIndex === 0 && priorAttempts.length === 0 ? "initial" : "retry",
        status: validation.ok ? "valid" : "invalid",
        attemptDir,
        startedAt,
        finishedAt,
        issueCount: issues.length,
        issues,
        skillResult,
        validation,
        ...(retryContextPath ? { retryContextPath } : {}),
        ...(skillResult.observationDir ? { observationDir: skillResult.observationDir } : {}),
        provider: skillResult.provider,
        model: skillResult.model,
        agentRuntime: skillResult.agentRuntime,
      };
      await persistAttemptArtifacts(attempt);
      attempts.push(attempt);

      if (validation.ok) {
        const { summary, summaryPath } = await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries, { isFinal: true });
        return { skillResult, validation, attempts, summary, summaryPath };
      }

      // Judgement repair: try to salvage a close-but-invalid result before spending a full rerun.
      // The repaired candidate is re-validated against the same schema; the judge is never trusted.
      if (repairEnabled && repairsUsed < maxRepairs) {
        repairsUsed += 1;
        const repaired = await runRepairStep({
          repair: repairPolicy!,
          failedAttempt: attempt,
          validation,
          session: params.session,
          deps: params.deps ?? {},
          attemptDir,
          model: repairPolicy!.model ?? params.session.model,
        });
        if (repaired) {
          const repairAttempt: ValidatedSkillBackedNodeAttempt<TValidation> = {
            attempt: attemptNumber,
            kind: "repair",
            status: "valid",
            attemptDir: repaired.attemptDir,
            startedAt: repaired.startedAt,
            finishedAt: repaired.finishedAt,
            issueCount: 0,
            issues: [],
            skillResult,
            validation: repaired.validation,
            provider: skillResult.provider,
            model: skillResult.model,
            agentRuntime: skillResult.agentRuntime,
          };
          await persistAttemptArtifacts(repairAttempt);
          attempts.push(repairAttempt);
          const { summary, summaryPath } = await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries, { isFinal: true });
          return { skillResult, validation: repaired.validation, attempts, summary, summaryPath };
        }
      }

      attempt.failureContextPath = await writeFailureContext({ attempt, attempts });
      const isLastAttempt = !(await shouldRetry({ attempt, attempts, maxRetries, retryPolicy: params.retryPolicy })) || (freshIndex + 1) >= maxAttempts;
      if (isLastAttempt) {
        const { summary, summaryPath } = await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries, { isFinal: true });
        return { skillResult, validation, attempts, summary, summaryPath };
      }
      // Interim write — still have retries remaining.
      await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries, { isFinal: false });
    } catch (error) {
      lastError = error;
      const finishedAt = new Date().toISOString();
      const attempt: ValidatedSkillBackedNodeAttempt<TValidation> = {
        attempt: attemptNumber,
        kind: freshIndex === 0 && priorAttempts.length === 0 ? "initial" : "retry",
        status: "error",
        attemptDir,
        startedAt,
        finishedAt,
        issueCount: 1,
        issues: [error instanceof Error ? error.message : String(error)],
        errorMessage: error instanceof Error ? error.stack ?? error.message : String(error),
        ...(retryContextPath ? { retryContextPath } : {}),
      };
      await persistAttemptArtifacts(attempt);
      attempts.push(attempt);
      attempt.failureContextPath = await writeFailureContext({ attempt, attempts });
      const isLastAttempt = !(await shouldRetry({ attempt, attempts, maxRetries, retryPolicy: params.retryPolicy })) || (freshIndex + 1) >= maxAttempts;
      if (isLastAttempt) break;
      await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries, { isFinal: false });
    }
  }

  const { summaryPath } = await writeHealingSummary(params.healingArtifactRoot, attempts, maxRetries);
  const message = lastError instanceof Error ? lastError.message : lastError ? String(lastError) : "Validated skill-backed Node session failed without producing a valid skill result.";
  const error = new Error(`${message} (healing summary: ${summaryPath})`);
  if (lastError instanceof Error && lastError.stack) error.stack = lastError.stack;
  throw error;
}

function normalizeMaxRetries<TValidation extends ValidatedSkillBackedNodeValidation>(policy: ValidatedSkillBackedNodeRetryPolicy<TValidation> | undefined): number {
  if (policy?.enabled === false) return 0;
  const value = policy?.maxRetries ?? DEFAULT_MAX_RETRIES;
  if (!Number.isFinite(value) || value < 0) return DEFAULT_MAX_RETRIES;
  return Math.floor(value);
}

async function shouldRetry<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  attempt: ValidatedSkillBackedNodeAttempt<TValidation>;
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
  maxRetries: number;
  retryPolicy?: ValidatedSkillBackedNodeRetryPolicy<TValidation>;
}): Promise<boolean> {
  if (args.retryPolicy?.enabled === false || args.maxRetries <= 0) return false;
  if (args.retryPolicy?.shouldRetry) return args.retryPolicy.shouldRetry(args);
  return true;
}

function normalizeIssues(issues: string[] | undefined): string[] {
  return (issues ?? []).map((issue) => String(issue).trim()).filter(Boolean);
}

function attemptLabel(attempt: number): string {
  return `attempt-${String(attempt).padStart(3, "0")}`;
}

function defaultRetryInstructions(): string {
  return [
    "This is a retry of a failed agent-backed Node.",
    "",
    "Below are prior attempts, the validation failures, and any raw outputs we captured.",
    "",
    "If you can correct the failure by fixing output formatting, schema shape, omissions, duplicates, or contract compliance without redoing the full analysis, prefer that to conserve tokens.",
    "",
    "If the failure means the analysis itself must be redone, perform the full node task again.",
    "",
    "You must publish the required artifacts exactly as requested by the node contract.",
  ].join("\n");
}

function extractRepairJson(rawText: string): string {
  const trimmed = rawText.trim();
  const block = trimmed.match(/<<<ARTIFACT:structured-output-repair-json>>>([\s\S]*?)<<<END_ARTIFACT>>>/);
  if (block && block[1]) return block[1].trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1].trim();
  return trimmed;
}

const REPAIR_SKILL_DIRECTORY = path.join(__dirname, "skills", "structured-output-repair");

// Default judge: a low-reasoning, read-only skill-backed pass that triages repair-vs-rerun and,
// when repairing, reshapes the already-present data. Mirrors implication-scan-batch's repair agent.
const defaultRepairJudge = async (args: RepairJudgeArgs): Promise<RepairJudgement> => {
  const contextPath = path.join(args.attemptDir, "repair-context.md");
  await writeFile(contextPath, [
    "# Structured output repair request",
    "",
    "A prior agent step produced JSON that failed schema validation. Decide whether the failure can be",
    "fixed by reshaping the data already present (repair), or requires re-running the node (rerun).",
    "",
    "## Validation issues",
    ...(args.issues.length ? args.issues.map((issue) => `- ${issue}`) : ["- (none recorded)"]),
    "",
    "## Failing output",
    "```",
    args.failingText,
    "```",
  ].join("\n"), "utf8");

  const repairSession: SkillBackedNodeSessionParams = {
    ...args.session,
    model: args.model,
    thinkingLevel: "low",
    allowedTools: ["read"],
    skillDirectory: REPAIR_SKILL_DIRECTORY,
    inputArtifacts: [{ label: "structured output repair context", path: contextPath, summary: "Failing JSON + validation issues to triage and repair." }],
    outputArtifacts: [{ label: "structured output repair json", relativePath: "structured-output-repair.json", responseBlockId: "structured-output-repair-json" }],
    promptInputMode: "staged_paths",
    outputTransport: "response_blocks_preferred",
    extraInstructions: [
      "CRITICAL: Only reshape / relabel / normalise data that is ALREADY PRESENT in the failing output.",
      "CRITICAL: If a required field's content is genuinely missing, return action 'rerun' — never invent values.",
      "CRITICAL: Publish exact JSON only for structured-output-repair.json.",
    ].join("\n"),
  };
  const result = await executeSkillBackedNodeSession(repairSession, args.deps);
  const record = result.outputArtifacts.find((artifact) => artifact.path.endsWith("structured-output-repair.json"));
  if (!record || record.recoveryMethod === "missing") return { action: "rerun" };
  let parsed: { action?: unknown; json?: unknown };
  try {
    parsed = JSON.parse(extractRepairJson(await readFile(record.path, "utf8"))) as { action?: unknown; json?: unknown };
  } catch {
    return { action: "rerun" };
  }
  if (parsed.action === "repair" && parsed.json !== undefined) {
    return { action: "repair", json: typeof parsed.json === "string" ? parsed.json : JSON.stringify(parsed.json) };
  }
  return { action: "rerun" };
};

async function runRepairStep<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  repair: ValidatedSkillBackedRepairPolicy<TValidation>;
  failedAttempt: ValidatedSkillBackedNodeAttempt<TValidation>;
  validation: TValidation;
  session: SkillBackedNodeSessionParams;
  deps: ExecuteSkillBackedNodeSessionDeps;
  attemptDir: string;
  model: string;
}): Promise<{ validation: TValidation; attemptDir: string; startedAt: string; finishedAt: string } | undefined> {
  const startedAt = new Date().toISOString();
  const repairDir = path.join(args.attemptDir, "repair");
  await mkdir(repairDir, { recursive: true });
  const failingText = (args.validation as { rawArtifactText?: string; rawText?: string }).rawArtifactText
    ?? (args.validation as { rawText?: string }).rawText
    ?? args.failedAttempt.skillResult?.rawText
    ?? "";
  const judge = args.repair.judge ?? defaultRepairJudge;
  let judgement: RepairJudgement;
  try {
    judgement = await judge({ failingText, issues: args.failedAttempt.issues, attemptDir: repairDir, session: args.session, deps: args.deps, model: args.model });
  } catch (error) {
    await writeJson(path.join(repairDir, "repair-judgement.json"), { action: "rerun", error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }
  await writeJson(path.join(repairDir, "repair-judgement.json"), { action: judgement.action, hasJson: Boolean(judgement.json) });
  if (judgement.action !== "repair" || !judgement.json) return undefined;
  await writeFile(path.join(repairDir, "repaired.json"), judgement.json, "utf8");
  const revalidated = await args.repair.revalidate(judgement.json, repairDir);
  const finishedAt = new Date().toISOString();
  await writeJson(path.join(repairDir, "repair-revalidation.json"), { ok: revalidated.ok, issues: normalizeIssues(revalidated.issues) });
  if (!revalidated.ok) return undefined;
  return { validation: revalidated, attemptDir: repairDir, startedAt, finishedAt };
}

function sessionWithRetryContext<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  session: SkillBackedNodeSessionParams;
  retryContextPath: string;
  nextAttempt: number;
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
  retryPolicy?: ValidatedSkillBackedNodeRetryPolicy<TValidation>;
}): SkillBackedNodeSessionParams {
  const defaultInstructions = defaultRetryInstructions();
  const retryInstructions = args.retryPolicy?.buildRetryInstructions?.({ nextAttempt: args.nextAttempt, attempts: args.attempts, defaultInstructions }) ?? defaultInstructions;
  const retryArtifact: SkillBackedNodeInputArtifact = {
    label: "skill healing retry context",
    path: args.retryContextPath,
    summary: "Prior failed skill-backed attempts, validation issues, and raw output artifact paths for this retry.",
  };
  return {
    ...args.session,
    inputArtifacts: [...args.session.inputArtifacts, retryArtifact],
    extraInstructions: [
      retryInstructions.trim(),
      args.session.extraInstructions?.trim() ? `Original node instructions:\n${args.session.extraInstructions.trim()}` : undefined,
    ].filter((item): item is string => Boolean(item)).join("\n\n"),
  };
}

async function writeRetryContext<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  attemptDir: string;
  nextAttempt: number;
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
  retryPolicy?: ValidatedSkillBackedNodeRetryPolicy<TValidation>;
}): Promise<string> {
  const retryContextPath = path.join(args.attemptDir, "retry-context.md");
  await writeFile(retryContextPath, retryContextMarkdown({ nextAttempt: args.nextAttempt, attempts: args.attempts }), "utf8");
  return retryContextPath;
}

function retryContextMarkdown<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  nextAttempt: number;
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
}): string {
  const lines = [
    "# Skill healing retry context",
    "",
    `Next attempt: ${args.nextAttempt}`,
    "",
    "The previous attempt(s) failed validation or execution. Use the diagnostics below to repair the required output artifacts.",
  ];

  for (const attempt of args.attempts) {
    lines.push(
      "",
      `## Attempt ${attempt.attempt} (${attempt.kind})`,
      "",
      `Status: ${attempt.status}`,
      `Started at: ${attempt.startedAt}`,
      `Finished at: ${attempt.finishedAt}`,
      `Issues (${attempt.issues.length}):`,
    );
    if (attempt.issues.length === 0) lines.push("- none");
    else for (const issue of attempt.issues) lines.push(`- ${issue}`);
    if (attempt.validationPath) lines.push(`Validation JSON: ${attempt.validationPath}`);
    if (attempt.rawOutputPath) lines.push(`Raw output: ${attempt.rawOutputPath}`);
    if (attempt.outputArtifactsPath) lines.push(`Output artifacts JSON: ${attempt.outputArtifactsPath}`);
    if (attempt.promptPath) lines.push(`Prompt: ${attempt.promptPath}`);
    if (attempt.errorMessage) lines.push("", "Error:", "", fenced(attempt.errorMessage));
  }

  return `${lines.join("\n")}\n`;
}

async function persistAttemptArtifacts<TValidation extends ValidatedSkillBackedNodeValidation>(attempt: ValidatedSkillBackedNodeAttempt<TValidation>): Promise<void> {
  await mkdir(attempt.attemptDir, { recursive: true });
  if (attempt.skillResult) {
    attempt.rawOutputPath = path.join(attempt.attemptDir, "raw-output.txt");
    await writeFile(attempt.rawOutputPath, attempt.skillResult.rawText, "utf8");

    attempt.outputArtifactsPath = path.join(attempt.attemptDir, "output-artifacts.json");
    await writeJson(attempt.outputArtifactsPath, attempt.skillResult.outputArtifacts);

    const sourcePromptPath = attempt.skillResult.observationDir ? path.join(attempt.skillResult.observationDir, "prompt.md") : undefined;
    if (sourcePromptPath) {
      const promptPath = path.join(attempt.attemptDir, "prompt.md");
      try {
        await copyFile(sourcePromptPath, promptPath);
        attempt.promptPath = promptPath;
      } catch {
        // Prompt copy is best-effort; observationDir still points at the source prompt.
      }
    }
  }

  if (attempt.validation) {
    attempt.validationPath = path.join(attempt.attemptDir, "validation.json");
    await writeJson(attempt.validationPath, attempt.validation);
  } else if (attempt.errorMessage) {
    attempt.validationPath = path.join(attempt.attemptDir, "validation.json");
    await writeJson(attempt.validationPath, { ok: false, issues: attempt.issues, errorMessage: attempt.errorMessage });
  }
}

async function writeFailureContext<TValidation extends ValidatedSkillBackedNodeValidation>(args: {
  attempt: ValidatedSkillBackedNodeAttempt<TValidation>;
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[];
}): Promise<string> {
  const failureContextPath = path.join(args.attempt.attemptDir, "failure-context.md");
  await writeFile(failureContextPath, retryContextMarkdown({ nextAttempt: args.attempt.attempt + 1, attempts: args.attempts }), "utf8");
  return failureContextPath;
}

async function writeHealingSummary<TValidation extends ValidatedSkillBackedNodeValidation>(
  healingArtifactRoot: string,
  attempts: readonly ValidatedSkillBackedNodeAttempt<TValidation>[],
  maxRetries: number,
  options?: { isFinal?: boolean },
): Promise<{ summary: SkillBackedHealingSummary; summaryPath: string }> {
  const final = attempts[attempts.length - 1];
  const validAttempt = attempts.find((attempt) => attempt.status === "valid");
  const summary: SkillBackedHealingSummary = {
    schemaVersion: 1,
    status: validAttempt
      ? validAttempt.attempt === 1 ? "completed_clean" : "completed_after_retry"
      : options?.isFinal ? "failed_after_retries" : "in_progress",
    maxRetries,
    finalAttempt: final?.attempt ?? 0,
    recovered: Boolean(validAttempt && validAttempt.attempt > 1),
    attempts: attempts.map((attempt) => ({
      attempt: attempt.attempt,
      kind: attempt.kind,
      status: attempt.status,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      issueCount: attempt.issueCount,
      issues: attempt.issues,
      ...(attempt.validationPath ? { validationPath: attempt.validationPath } : {}),
      ...(attempt.rawOutputPath ? { rawOutputPath: attempt.rawOutputPath } : {}),
      ...(attempt.promptPath ? { promptPath: attempt.promptPath } : {}),
      ...(attempt.retryContextPath ? { retryContextPath: attempt.retryContextPath } : {}),
      ...(attempt.failureContextPath ? { failureContextPath: attempt.failureContextPath } : {}),
      ...(attempt.observationDir ? { observationDir: attempt.observationDir } : {}),
      ...(attempt.provider ? { provider: attempt.provider } : {}),
      ...(attempt.model ? { model: attempt.model } : {}),
      ...(attempt.agentRuntime ? { agentRuntime: attempt.agentRuntime } : {}),
      ...(attempt.errorMessage ? { errorMessage: attempt.errorMessage } : {}),
    })),
  };
  const summaryPath = path.join(healingArtifactRoot, "skill-healing-summary.json");
  await writeJson(summaryPath, summary);
  return { summary, summaryPath };
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function fenced(value: string): string {
  return ["```", value, "```"].join("\n");
}

export async function readSkillHealingSummary(filePath: string): Promise<SkillBackedHealingSummary> {
  return JSON.parse(await readFile(filePath, "utf8")) as SkillBackedHealingSummary;
}
