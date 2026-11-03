import type { DeclaredRequiredInput } from "./nodeRegistry";

/**
 * Minimal interaction surface for prompting. Structurally compatible with the
 * human-ack interaction and the flow-runner's readline provider.
 */
export type InputInteraction = {
  ask(args: { prompt: string; contextNote?: string; allowEmpty?: boolean }): Promise<{ answer: string }>;
};

export type ResolveDeclaredInputsArgs = {
  declared: DeclaredRequiredInput[];
  /** Values already supplied (CLI flags, params, prior input). Keyed by input key. */
  provided?: Record<string, unknown>;
  /** Interaction surface for prompting when a value is absent. */
  interaction?: InputInteraction;
  /** Max prompt attempts per input before giving up. Defaults to 3. */
  maxAttempts?: number;
};

export type ResolveDeclaredInputsResult = {
  /** Resolved values, keyed by input key. Only includes inputs that resolved. */
  values: Record<string, string>;
  /** Required inputs that could not be resolved (absent, or invalid with no way to re-prompt). */
  missing: DeclaredRequiredInput[];
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Built-in validation by kind. Returns an error string when invalid, else undefined. */
export function validateDeclaredInput(input: DeclaredRequiredInput, raw: string): string | undefined {
  const value = raw.trim();
  if (value.length === 0) return "value is empty";
  switch (input.kind) {
    case "uuid":
    case "zededa-device-id":
      if (!UUID_RE.test(value)) return "must be a UUID (e.g. 4493b536-3c1d-4082-8b88-35ec11203cec)";
      break;
    case "number":
      if (!Number.isFinite(Number(value))) return "must be a number";
      break;
    case "boolean":
      if (!/^(true|false|yes|no|y|n|1|0)$/i.test(value)) return "must be a boolean (true/false)";
      break;
    default:
      break;
  }
  return input.validate?.(value);
}

function readProvided(provided: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!provided) return undefined;
  const v = provided[key];
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : String(v);
  return s.trim().length > 0 ? s.trim() : undefined;
}

/**
 * Resolve a Node's declared inputs.
 *
 * For each declared input, in order:
 *  1. If a value was provided (flag/param/input) and it validates → use it, no prompt.
 *  2. Else if an interaction surface exists → prompt (re-prompting on invalid, up to maxAttempts).
 *  3. Else (or on exhausted attempts) → if required, record as missing (caller fails closed).
 *
 * A provided-but-invalid value is re-prompted when an interaction exists, otherwise
 * treated as unresolved so a bad flag can never silently proceed.
 */
export async function resolveDeclaredInputs(args: ResolveDeclaredInputsArgs): Promise<ResolveDeclaredInputsResult> {
  const maxAttempts = Math.max(1, args.maxAttempts ?? 3);
  const values: Record<string, string> = {};
  const missing: DeclaredRequiredInput[] = [];

  for (const input of args.declared) {
    const required = input.required !== false;

    // 1. Provided value
    const supplied = readProvided(args.provided, input.key);
    if (supplied !== undefined) {
      const error = validateDeclaredInput(input, supplied);
      if (!error) {
        values[input.key] = supplied;
        continue;
      }
      // fall through to prompting when invalid; if no interaction we treat as unresolved
    }

    // 2. Prompt
    if (args.interaction) {
      let resolved: string | undefined;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const promptText = input.description ? `${input.prompt}\n(${input.description})` : input.prompt;
        const { answer } = await args.interaction.ask({
          prompt: promptText,
          contextNote: input.example ? `example: ${input.example}` : undefined,
          allowEmpty: !required,
        });
        const trimmed = (answer ?? "").trim();
        if (trimmed.length === 0 && !required) break; // optional, left blank
        const error = validateDeclaredInput(input, trimmed);
        if (!error) {
          resolved = trimmed;
          break;
        }
      }
      if (resolved !== undefined) {
        values[input.key] = resolved;
        continue;
      }
    }

    // 3. Unresolved
    if (required) missing.push(input);
  }

  return { values, missing };
}
