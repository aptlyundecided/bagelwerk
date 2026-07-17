import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";
import { alert, notify } from "../../../notifications";

export type HumanAckInteraction = {
  ask(args: { prompt: string; contextNote?: string; allowEmpty?: boolean }): Promise<{ answer: string }>;
};

export type HumanAckNodeParams = {
  title: string;
  message: string;
  prompt: string;
  artifactBaseName: string;
  /** When true, fire a macOS notification to alert the user. Defaults to true. */
  notifyOnWait?: boolean;
  /** macOS sound to play with the notification (e.g. "Glass", "Ping", "Hero"). */
  notifySound?: string;
  /**
   * Interaction mode when no injected interaction is provided:
   * - "alert" — show a blocking macOS dialog (default on macOS with no TTY)
   * - "readline" — use stdin readline (default when TTY is available)
   * - "alert+readline" — fire the alert AND wait on readline (both)
   */
  interactionMode?: "alert" | "readline" | "alert+readline";
};

export type HumanAckArtifact = {
  schemaVersion: 1;
  nodeType: "core.human-ack";
  nodeId: string;
  title: string;
  message: string;
  prompt: string;
  acknowledged: boolean;
  acknowledgedAt?: string;
  reason?: "interaction_unavailable";
  answerText?: string;
  answerLength?: number;
};

export type HumanAckNodePayload = {
  finalVerdict: "human_acknowledged" | "human_ack_interaction_unavailable";
  acceptEligible: boolean;
  acknowledgement: HumanAckArtifact;
  artifactFiles: EmittedNodeArtifactRecord[];
};

export const HumanAckNodeParamsSchema = z.object({
  title: z.string().trim().min(1),
  message: z.string().trim().min(1),
  prompt: z.string().trim().min(1).default("Press Enter to acknowledge and continue."),
  artifactBaseName: z.string().trim().min(1).regex(/^[a-zA-Z0-9._-]+$/, "artifactBaseName must be a safe file base name").default("human-ack"),
  notifyOnWait: z.boolean().optional().default(true),
  notifySound: z.string().trim().min(1).optional(),
  interactionMode: z.enum(["alert", "readline", "alert+readline"]).optional(),
}).strict();

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function maybeInteraction(value: unknown): HumanAckInteraction | undefined {
  if (!isRecord(value)) return undefined;
  const ask = value.ask;
  return typeof ask === "function" ? value as HumanAckInteraction : undefined;
}

function resolveInteraction(input: unknown): HumanAckInteraction | undefined {
  if (!isRecord(input)) return undefined;
  const userInput = input.userInput;
  if (isRecord(userInput)) {
    const nested = maybeInteraction(userInput.interaction);
    if (nested) return nested;
  }
  return maybeInteraction(input.interaction);
}

function resolveWorkbenchRunDir(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  // Support both flow-runner (runtime) and legacy workbench (workbench) input shapes.
  for (const key of ["runtime", "workbench"] as const) {
    const surface = input[key];
    if (isRecord(surface)) {
      const record = surface.record;
      if (isRecord(record) && typeof record.runDir === "string" && record.runDir.trim().length > 0) {
        return record.runDir;
      }
    }
  }
  return undefined;
}

/**
 * Creates a built-in readline-based interaction when stdin is a TTY.
 * Returns undefined when no TTY is available (e.g. piped input, CI, headless).
 */
function createStdinInteraction(): HumanAckInteraction | undefined {
  if (!process.stdin.isTTY) return undefined;

  return {
    async ask({ prompt }) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      try {
        const answer = await rl.question(`${prompt}\n> `);
        return { answer };
      } finally {
        rl.close();
      }
    },
  };
}

/**
 * Creates an interaction backed by a macOS alert dialog.
 * The alert blocks until the user clicks Acknowledge or Dismiss.
 * Available on macOS only; returns undefined on other platforms.
 */
function createAlertInteraction(params: HumanAckNodeParams): HumanAckInteraction | undefined {
  if (process.platform !== "darwin") return undefined;

  return {
    async ask() {
      const result = await alert({
        title: `🔔 ${params.title}`,
        message: `${params.message}\n\n${params.prompt}`,
        buttons: ["Dismiss", "Acknowledge"],
        defaultButton: "Acknowledge",
        cancelButton: "Dismiss",
        icon: "note",
      });
      return { answer: result.dismissed ? "" : "acknowledged" };
    },
  };
}

function renderAskPrompt(params: HumanAckNodeParams): string {
  return `${params.title}\n\n${params.message}\n\n${params.prompt}`;
}

/**
 * Resolves the built-in interaction to use when no injected interaction is available.
 *
 * Priority:
 * 1. Explicit `interactionMode` param if set
 * 2. TTY available → readline
 * 3. macOS → alert dialog
 * 4. Nothing available → undefined (node fails closed)
 */
function resolveBuiltInInteraction(params: HumanAckNodeParams): HumanAckInteraction | undefined {
  const mode = params.interactionMode;

  if (mode === "alert") {
    return createAlertInteraction(params);
  }
  if (mode === "readline") {
    return createStdinInteraction();
  }
  if (mode === "alert+readline") {
    // Race: whichever resolves first wins
    const alertInteraction = createAlertInteraction(params);
    const readlineInteraction = createStdinInteraction();
    if (alertInteraction && readlineInteraction) {
      return {
        async ask(askArgs) {
          // Fire both, resolve on whichever the user responds to first
          return Promise.race([
            alertInteraction.ask(askArgs),
            readlineInteraction.ask(askArgs),
          ]);
        },
      };
    }
    return alertInteraction ?? readlineInteraction;
  }

  // Auto-detect: prefer readline (TTY), otherwise undefined.
  // Alert mode requires explicit opt-in via interactionMode param
  // to avoid surprise modal dialogs in CI/test/headless contexts.
  return createStdinInteraction();
}

function renderMarkdown(artifact: HumanAckArtifact): string {
  return `# Human Acknowledgement

## Status
${artifact.acknowledged ? "Acknowledged." : "Not acknowledged."}

## Title
${artifact.title}

## Message
${artifact.message}

## Prompt
${artifact.prompt}

## Context archaeology
This file is a durable record that a Flow reached a human acknowledgement checkpoint. Downstream Nodes can depend on the accepted acknowledgement artifact instead of hidden terminal or conversation memory.

## Details
- Node type: \`${artifact.nodeType}\`
- Node id: \`${artifact.nodeId}\`
- Acknowledged: ${artifact.acknowledged ? "yes" : "no"}
${artifact.acknowledgedAt ? `- Acknowledged at: ${artifact.acknowledgedAt}\n` : ""}${artifact.reason ? `- Reason: ${artifact.reason}\n` : ""}${artifact.answerText ? `- Answer: ${artifact.answerText}\n` : ""}${typeof artifact.answerLength === "number" ? `- Answer length: ${artifact.answerLength}\n` : ""}`;
}

async function writeHumanAckArtifacts(args: {
  runDir: string | undefined;
  artifactBaseName: string;
  artifact: HumanAckArtifact;
}): Promise<EmittedNodeArtifactRecord[]> {
  if (!args.runDir) return [];
  await mkdir(args.runDir, { recursive: true });
  const jsonRelativePath = `${args.artifactBaseName}.json`;
  const markdownRelativePath = `${args.artifactBaseName}.md`;
  const jsonPath = path.join(args.runDir, jsonRelativePath);
  const markdownPath = path.join(args.runDir, markdownRelativePath);
  await writeFile(jsonPath, `${JSON.stringify(args.artifact, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, renderMarkdown(args.artifact), "utf8");
  return [
    { key: jsonRelativePath, label: "Human Acknowledgement JSON", path: jsonPath, relativePath: jsonRelativePath, required: true },
    { key: markdownRelativePath, label: "Human Acknowledgement", path: markdownPath, relativePath: markdownRelativePath, required: true },
  ];
}

export async function runHumanAckNode(args: {
  nodeId: string;
  params: HumanAckNodeParams;
  input: unknown;
}): Promise<NodeResult<HumanAckNodePayload>> {
  const interaction = resolveInteraction(args.input);
  const runDir = resolveWorkbenchRunDir(args.input);

  // Use injected interaction, or fall back to a built-in interaction
  // based on the configured interactionMode and platform capabilities.
  const effectiveInteraction = interaction ?? resolveBuiltInInteraction(args.params);

  if (!effectiveInteraction) {
    const acknowledgement: HumanAckArtifact = {
      schemaVersion: 1,
      nodeType: "core.human-ack",
      nodeId: args.nodeId,
      title: args.params.title,
      message: args.params.message,
      prompt: args.params.prompt,
      acknowledged: false,
      reason: "interaction_unavailable",
    };
    const artifactFiles = await writeHumanAckArtifacts({ runDir, artifactBaseName: args.params.artifactBaseName, artifact: acknowledgement });
    return {
      status: "failed",
      note: `Human acknowledgement unavailable: ${args.params.title}`,
      payload: {
        finalVerdict: "human_ack_interaction_unavailable",
        acceptEligible: false,
        acknowledgement,
        artifactFiles,
      },
    };
  }

  // Fire macOS notification to alert the user that we're waiting
  const shouldNotify = args.params.notifyOnWait !== false;
  if (shouldNotify) {
    await notify({
      title: `🔔 ${args.params.title}`,
      message: args.params.message,
      sound: args.params.notifySound ?? "Glass",
    });
  }

  const answer = await effectiveInteraction.ask({
    prompt: renderAskPrompt(args.params),
    contextNote: "Press Enter to record a durable acknowledgement artifact for downstream Nodes. This gate never auto-acknowledges.",
    allowEmpty: true,
  });
  const acknowledgement: HumanAckArtifact = {
    schemaVersion: 1,
    nodeType: "core.human-ack",
    nodeId: args.nodeId,
    title: args.params.title,
    message: args.params.message,
    prompt: args.params.prompt,
    acknowledged: true,
    acknowledgedAt: new Date().toISOString(),
    answerText: answer.answer,
    answerLength: answer.answer.length,
  };
  const artifactFiles = await writeHumanAckArtifacts({ runDir, artifactBaseName: args.params.artifactBaseName, artifact: acknowledgement });
  return {
    status: "completed",
    note: `Human acknowledged: ${args.params.title}`,
    payload: {
      finalVerdict: "human_acknowledged",
      acceptEligible: true,
      acknowledgement,
      artifactFiles,
    },
  };
}

export const coreHumanAckNodeTypeEntry: NodeTypeEntry<HumanAckNodeParams, unknown, HumanAckNodePayload> = {
  nodeType: "core.human-ack",
  label: "Core Human Acknowledgement",
  validateParams: (value: unknown) => HumanAckNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runHumanAckNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = HumanAckNodeParamsSchema.parse(params);
    return {
      outputs: [
        { key: `${parsed.artifactBaseName}.json`, label: "Human Acknowledgement JSON", relativePath: `${parsed.artifactBaseName}.json`, kind: "handoff" },
        { key: `${parsed.artifactBaseName}.md`, label: "Human Acknowledgement", relativePath: `${parsed.artifactBaseName}.md`, kind: "handoff" },
      ],
    };
  },
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
