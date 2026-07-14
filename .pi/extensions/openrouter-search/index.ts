import { config as loadDotEnv } from "dotenv";
import path from "node:path";

let envLoaded = false;

function ensureEnvLoaded() {
  if (envLoaded) {
    return;
  }

  loadDotEnv({ path: path.resolve(process.cwd(), ".env") });
  envLoaded = true;
}

function getSettings() {
  ensureEnvLoaded();

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is missing. Expected it in the repo-root .env file or process environment.");
  }

  return {
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1",
    model: process.env.OPENROUTER_SEARCH_MODEL?.trim() || "perplexity/sonar-pro",
    referer: process.env.OPENROUTER_SITE_URL?.trim() || "https://pi.local/project",
    title: process.env.OPENROUTER_SITE_NAME?.trim() || "bagelwerk pi web search",
  };
}

function pickSignal(...candidates: unknown[]): AbortSignal | undefined {
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      "aborted" in candidate &&
      typeof (candidate as AbortSignal).aborted === "boolean" &&
      typeof (candidate as AbortSignal).addEventListener === "function"
    ) {
      return candidate as AbortSignal;
    }
  }

  return undefined;
}

function extractTextContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .flatMap((part) => {
        if (typeof part === "string") {
          return [part];
        }

        if (part && typeof part === "object") {
          const text = (part as { text?: unknown }).text;
          if (typeof text === "string") {
            return [text];
          }
        }

        return [];
      })
      .join("\n")
      .trim();
  }

  return "";
}

function extractCitations(payload: any): string[] {
  const citations = new Set<string>();

  const topLevelCitations = Array.isArray(payload?.citations) ? payload.citations : [];
  for (const citation of topLevelCitations) {
    if (typeof citation === "string" && citation.trim()) {
      citations.add(citation.trim());
    }
  }

  const annotations = payload?.choices?.[0]?.message?.annotations;
  if (Array.isArray(annotations)) {
    for (const annotation of annotations) {
      if (!annotation || typeof annotation !== "object") {
        continue;
      }

      const url = (annotation as { url?: unknown }).url;
      if (typeof url === "string" && url.trim()) {
        citations.add(url.trim());
      }
    }
  }

  return [...citations];
}

function buildPrompt(params: { query: string; focus?: string }) {
  const focusLine = params.focus?.trim()
    ? `Focus guidance: ${params.focus.trim()}`
    : "Focus guidance: prioritize the most relevant, current, high-signal sources.";

  return [
    "Answer the query using live web research.",
    focusLine,
    "Prefer current, authoritative sources and include concrete details when available.",
    "If the query is ambiguous, state the most reasonable interpretation you used.",
    `Query: ${params.query.trim()}`,
  ].join("\n");
}

function formatResult(query: string, model: string, answer: string, citations: string[]) {
  const lines = [
    `# OpenRouter web search`,
    "",
    `- query: ${query}`,
    `- model: ${model}`,
    "",
    answer || "No answer text returned.",
  ];

  if (citations.length > 0) {
    lines.push("", "## Sources", "");
    citations.forEach((citation, index) => {
      lines.push(`${index + 1}. ${citation}`);
    });
  }

  return lines.join("\n");
}

export default function (pi: any) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via OpenRouter using Perplexity Sonar Pro. Use for current facts, docs lookup, vendor/product research, internet parlance, and any task that needs live web context.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description: "What to search for on the web.",
        },
        focus: {
          type: "string",
          description: "Optional short guidance for what to prioritize in the search results.",
        },
      },
      required: ["query"],
    },
    async execute(_toolCallId: string, params: { query: string; focus?: string }, arg3: unknown, arg4: unknown, arg5: unknown) {
      const signal = pickSignal(arg3, arg4, arg5);
      const settings = getSettings();

      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: "POST",
        signal,
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": settings.referer,
          "X-Title": settings.title,
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            {
              role: "user",
              content: buildPrompt(params),
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter web search failed: ${response.status} ${response.statusText} — ${errorText}`);
      }

      const payload = await response.json();
      const answer = extractTextContent(payload?.choices?.[0]?.message?.content);
      const citations = extractCitations(payload);

      return {
        content: [
          {
            type: "text",
            text: formatResult(params.query, settings.model, answer, citations),
          },
        ],
        details: {
          query: params.query,
          focus: params.focus ?? null,
          model: settings.model,
          citations,
          usage: payload?.usage ?? null,
        },
      };
    },
  });
}
