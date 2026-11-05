import { createHash } from "node:crypto";

/**
 * Turns text into vectors for semantic search. Embeddings are computed asynchronously
 * (`records embed`, or the server's background loop), never on the run's write path.
 */
export interface Embedder {
  /** Stable id stored with every vector; changing it means re-embedding. */
  readonly model: string;
  readonly dims: number;
  embed(texts: string[]): Promise<number[][]>;
}

const TOKEN = /[a-z0-9][a-z0-9_.-]*[a-z0-9]|[a-z0-9]/g;

/**
 * Local, dependency-free, deterministic. Feature-hashes unigrams, bigrams and character trigrams into a
 * fixed space and L2-normalises. It finds near-duplicate and paraphrase-light matches across runs
 * without any model or network, but it is lexical, not truly semantic. Use an HTTP embedder for that.
 */
export class HashingEmbedder implements Embedder {
  readonly model: string;

  constructor(readonly dims = 384) {
    this.model = `bagelwerk-hash-v1-${dims}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vector = new Float64Array(this.dims);
    const tokens = (text.toLowerCase().match(TOKEN) ?? []).slice(0, 4000);
    const add = (feature: string, weight: number) => {
      const digest = createHash("md5").update(feature).digest();
      const index = digest.readUInt32LE(0) % this.dims;
      vector[index] += (digest[4]! & 1 ? 1 : -1) * weight;
    };
    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i]!;
      add(`u:${token}`, 1);
      if (i + 1 < tokens.length) add(`b:${token} ${tokens[i + 1]}`, 0.5);
      if (token.length > 4) for (let j = 0; j + 3 <= token.length; j += 1) add(`c:${token.slice(j, j + 3)}`, 0.2);
    }
    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm) || 1;
    return Array.from(vector, (value) => Number((value / norm).toFixed(6)));
  }
}

/**
 * Any OpenAI-compatible `/embeddings` endpoint: OpenAI, OpenRouter, a local Ollama (`http://localhost:11434/v1`),
 * LM Studio, vLLM. Uses global fetch (Node 18+).
 */
export class OpenAICompatibleEmbedder implements Embedder {
  readonly model: string;

  constructor(private readonly options: { baseUrl: string; model: string; dims: number; apiKey?: string; batchSize?: number }) {
    this.model = `openai-compatible:${options.model}`;
  }

  get dims(): number {
    return this.options.dims;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const out: number[][] = [];
    const batchSize = this.options.batchSize ?? 32;
    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((text) => text.slice(0, 24_000));
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.options.model, input: batch }),
      });
      if (!response.ok) throw new Error(`embedding request failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`);
      const json = (await response.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
      const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (data.length !== batch.length) throw new Error(`embedding endpoint returned ${data.length} vectors for ${batch.length} inputs`);
      for (const item of data) {
        if (item.embedding.length !== this.dims) throw new Error(`embedding has ${item.embedding.length} dims; configured ${this.dims}`);
        out.push(item.embedding);
      }
    }
    return out;
  }
}

/**
 * BAGELWERK_EMBEDDINGS = off | hash (default) | openai-compatible
 * openai-compatible reads BAGELWERK_EMBEDDINGS_URL, _MODEL, _DIMS and optional _API_KEY.
 */
export function resolveEmbedder(env: NodeJS.ProcessEnv = process.env): Embedder | undefined {
  const mode = (env.BAGELWERK_EMBEDDINGS ?? "hash").trim().toLowerCase();
  if (mode === "off" || mode === "none") return undefined;
  if (mode === "hash") return new HashingEmbedder(Number(env.BAGELWERK_EMBEDDINGS_DIMS) || 384);
  if (mode === "openai-compatible" || mode === "openai" || mode === "http") {
    const baseUrl = env.BAGELWERK_EMBEDDINGS_URL?.trim();
    const model = env.BAGELWERK_EMBEDDINGS_MODEL?.trim();
    const dims = Number(env.BAGELWERK_EMBEDDINGS_DIMS);
    if (!baseUrl || !model || !dims) throw new Error("BAGELWERK_EMBEDDINGS=openai-compatible needs BAGELWERK_EMBEDDINGS_URL, BAGELWERK_EMBEDDINGS_MODEL and BAGELWERK_EMBEDDINGS_DIMS.");
    return new OpenAICompatibleEmbedder({ baseUrl, model, dims, apiKey: env.BAGELWERK_EMBEDDINGS_API_KEY?.trim() || undefined });
  }
  throw new Error(`Unknown BAGELWERK_EMBEDDINGS mode '${mode}'. Use off, hash or openai-compatible.`);
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(",")}]`;
}
