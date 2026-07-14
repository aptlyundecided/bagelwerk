import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import type { EmittedNodeArtifactRecord, NodeTypeEntry } from "../../config";
import type { NodeResult } from "../../graph";

export type WebSearchCitation = {
  url: string;
  title?: string;
  snippet?: string;
  source?: string;
};

export type WebSearchArtifact = {
  schemaVersion: 1;
  nodeType: "core.web-search";
  nodeId: string;
  provider: "openrouter";
  model: string;
  query: string;
  focus?: string;
  searchDomainFilter?: string[];
  answer: string;
  citations: WebSearchCitation[];
  usage?: unknown;
  searchedAt: string;
};

export type WebSearchNodePayload = {
  finalVerdict: "web_search_completed";
  search: WebSearchArtifact;
  artifactFiles: EmittedNodeArtifactRecord[];
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export const WebSearchNodeParamsSchema = z.object({
  query: z.string().trim().min(1),
  focus: z.string().trim().min(1).optional(),
  // Provider-side domain whitelist (Perplexity `search_domain_filter`, forwarded verbatim by
  // OpenRouter). Constrains retrieval to these hosts BEFORE the model answers — far stronger than
  // naming sites in the prompt. Entries are bare hosts (e.g. "budgetbytes.com"). Empty/absent = no filter.
  searchDomainFilter: z.array(z.string().trim().min(1)).max(20).optional(),
  model: z.string().trim().min(1).default("perplexity/sonar-pro"),
  maxTokens: z.number().int().positive().max(8000).default(1500),
  artifactBaseName: z.string().trim().min(1).regex(/^[a-zA-Z0-9._-]+$/, "artifactBaseName must be a safe file base name").default("web-search"),
  baseUrl: z.string().trim().url().default("https://openrouter.ai/api/v1"),
}).strict();

export type WebSearchNodeParams = z.infer<typeof WebSearchNodeParamsSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveRunDir(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  const runtime = input.runtime;
  if (isRecord(runtime) && isRecord(runtime.record) && typeof runtime.record.runDir === "string") {
    return runtime.record.runDir;
  }
  const workbench = input.workbench;
  if (isRecord(workbench) && isRecord(workbench.record) && typeof workbench.record.runDir === "string") {
    return workbench.record.runDir;
  }
  return undefined;
}

function resolveEnv(input: unknown): NodeJS.ProcessEnv {
  if (!isRecord(input)) return process.env;
  const userInput = input.userInput;
  if (isRecord(userInput) && isRecord(userInput.env)) {
    return { ...process.env, ...userInput.env as NodeJS.ProcessEnv };
  }
  return process.env;
}

function openRouterEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
}

function renderPrompt(params: WebSearchNodeParams): string {
  return [
    "Use web search to answer the request with current, verifiable information.",
    "Prefer authoritative primary sources and include citation markers in the answer when available.",
    "Return a concise answer; do not fabricate sources.",
    `Query: ${params.query}`,
    params.focus ? `Focus: ${params.focus}` : undefined,
  ].filter(Boolean).join("\n\n");
}

function extractAnswer(response: unknown): string {
  if (!isRecord(response)) return "";
  const choices = response.choices;
  if (!Array.isArray(choices)) return "";
  const first = choices.find(isRecord);
  const message = first && isRecord(first.message) ? first.message : undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
  }
  return "";
}

function pushCitation(out: WebSearchCitation[], value: unknown, source: string): void {
  if (typeof value === "string" && value.trim()) {
    out.push({ url: value.trim(), source });
    return;
  }
  if (!isRecord(value)) return;
  const url = typeof value.url === "string" ? value.url.trim() : "";
  if (!url) return;
  const citation: WebSearchCitation = { url, source };
  if (typeof value.title === "string" && value.title.trim()) citation.title = value.title.trim();
  if (typeof value.snippet === "string" && value.snippet.trim()) citation.snippet = value.snippet.trim();
  out.push(citation);
}

function extractCitations(response: unknown): WebSearchCitation[] {
  if (!isRecord(response)) return [];
  const citations: WebSearchCitation[] = [];
  if (Array.isArray(response.citations)) {
    for (const item of response.citations) pushCitation(citations, item, "citations");
  }
  if (isRecord(response.web_search) && Array.isArray(response.web_search.results)) {
    for (const item of response.web_search.results) pushCitation(citations, item, "web_search.results");
  }
  if (Array.isArray(response.choices)) {
    for (const choice of response.choices) {
      if (!isRecord(choice) || !isRecord(choice.message)) continue;
      const annotations = choice.message.annotations;
      if (Array.isArray(annotations)) {
        for (const annotation of annotations) {
          if (isRecord(annotation) && isRecord(annotation.url_citation)) pushCitation(citations, annotation.url_citation, "message.annotations");
          else pushCitation(citations, annotation, "message.annotations");
        }
      }
    }
  }

  const seen = new Set<string>();
  return citations.filter((citation) => {
    const key = citation.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderMarkdown(artifact: WebSearchArtifact): string {
  const citations = artifact.citations.length > 0
    ? artifact.citations.map((citation, index) => `${index + 1}. ${citation.title ? `${citation.title} — ` : ""}${citation.url}${citation.snippet ? `\n   - ${citation.snippet}` : ""}`).join("\n")
    : "No structured citations returned.";
  return `# Web Search\n\n## Query\n${artifact.query}\n\n${artifact.focus ? `## Focus\n${artifact.focus}\n\n` : ""}## Answer\n${artifact.answer}\n\n## Citations\n${citations}\n\n## Metadata\n- Provider: ${artifact.provider}\n- Model: ${artifact.model}\n- Searched at: ${artifact.searchedAt}\n`;
}

async function writeWebSearchArtifacts(args: {
  runDir: string | undefined;
  artifactBaseName: string;
  artifact: WebSearchArtifact;
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
    { key: jsonRelativePath, label: "Web Search JSON", path: jsonPath, relativePath: jsonRelativePath, required: true },
    { key: markdownRelativePath, label: "Web Search Report", path: markdownPath, relativePath: markdownRelativePath, required: true },
  ];
}

export async function runWebSearchNode(args: {
  nodeId: string;
  params: WebSearchNodeParams;
  input: unknown;
  fetchImpl?: FetchLike;
  now?: () => Date;
}): Promise<NodeResult<WebSearchNodePayload>> {
  const env = resolveEnv(args.input);
  const apiKey = env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is required for core.web-search.");

  const fetchImpl = args.fetchImpl ?? globalThis.fetch as FetchLike | undefined;
  if (!fetchImpl) throw new Error("global fetch is unavailable; core.web-search requires a fetch implementation.");

  const response = await fetchImpl(openRouterEndpoint(args.params.baseUrl), {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://github.com/aptlyundecided/bagelwerk",
      "X-Title": "Bagelwerk core.web-search",
    },
    body: JSON.stringify({
      model: args.params.model,
      messages: [{ role: "user", content: renderPrompt(args.params) }],
      max_tokens: args.params.maxTokens,
      ...(args.params.searchDomainFilter?.length ? { search_domain_filter: args.params.searchDomainFilter } : {}),
    }),
  });

  const rawText = await response.text();
  let body: unknown;
  try {
    body = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new Error(`OpenRouter returned non-JSON response (${response.status} ${response.statusText}): ${rawText.slice(0, 500)}`);
  }
  if (!response.ok) {
    const message = isRecord(body) && isRecord(body.error) && typeof body.error.message === "string" ? body.error.message : rawText.slice(0, 500);
    throw new Error(`OpenRouter web search failed (${response.status} ${response.statusText}): ${message}`);
  }

  const answer = extractAnswer(body);
  if (!answer) throw new Error("OpenRouter web search returned no assistant content.");

  const search: WebSearchArtifact = {
    schemaVersion: 1,
    nodeType: "core.web-search",
    nodeId: args.nodeId,
    provider: "openrouter",
    model: args.params.model,
    query: args.params.query,
    ...(args.params.focus ? { focus: args.params.focus } : {}),
    ...(args.params.searchDomainFilter?.length ? { searchDomainFilter: args.params.searchDomainFilter } : {}),
    answer,
    citations: extractCitations(body),
    ...(isRecord(body) && body.usage ? { usage: body.usage } : {}),
    searchedAt: (args.now ?? (() => new Date()))().toISOString(),
  };

  const artifactFiles = await writeWebSearchArtifacts({
    runDir: resolveRunDir(args.input),
    artifactBaseName: args.params.artifactBaseName,
    artifact: search,
  });

  return {
    status: "completed",
    note: `Web search completed with ${search.citations.length} structured citation${search.citations.length === 1 ? "" : "s"}.`,
    payload: { finalVerdict: "web_search_completed", search, artifactFiles },
  };
}

export const coreWebSearchNodeTypeEntry: NodeTypeEntry<WebSearchNodeParams, unknown, WebSearchNodePayload> = {
  nodeType: "core.web-search",
  label: "Core Web Search",
  validateParams: (value: unknown) => WebSearchNodeParamsSchema.parse(value),
  execute: async ({ nodeId, params, working }) => runWebSearchNode({ nodeId, params, input: working.input }),
  describeArtifacts: ({ params }) => {
    const parsed = WebSearchNodeParamsSchema.parse(params);
    return {
      outputs: [
        { key: `${parsed.artifactBaseName}.json`, label: "Web Search JSON", relativePath: `${parsed.artifactBaseName}.json`, kind: "contract" },
        { key: `${parsed.artifactBaseName}.md`, label: "Web Search Report", relativePath: `${parsed.artifactBaseName}.md`, kind: "report" },
      ],
    };
  },
  contractVisibility: "declared",
  collectArtifacts: ({ payload }) => payload?.artifactFiles ?? [],
};
