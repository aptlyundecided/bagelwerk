import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runWebSearchNode, WebSearchNodeParamsSchema } from "./index";

test("core.web-search calls OpenRouter Sonar Pro and writes cited artifacts", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "bagelwerk-web-search-"));
  try {
    const runDir = path.join(tempRoot, "run");
    let requestedUrl = "";
    let requestInit: RequestInit | undefined;

    const result = await runWebSearchNode({
      nodeId: "node.web-search",
      params: WebSearchNodeParamsSchema.parse({
        query: "best mushroom-free weeknight pasta",
        focus: "avoid cilantro",
        artifactBaseName: "recipe-research",
      }),
      input: {
        userInput: { env: { OPENROUTER_API_KEY: "test-key" } },
        runtime: { record: { runDir } },
      },
      now: () => new Date("2026-06-01T00:00:00.000Z"),
      fetchImpl: async (url, init) => {
        requestedUrl = String(url);
        requestInit = init;
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return JSON.stringify({
              choices: [{ message: { content: "Use lemon ricotta pasta and cite sources.[1]" } }],
              citations: ["https://example.com/lemon-ricotta-pasta"],
              usage: { prompt_tokens: 10, completion_tokens: 7 },
            });
          },
        };
      },
    });

    assert.equal(result.status, "completed");
    assert.equal(requestedUrl, "https://openrouter.ai/api/v1/chat/completions");
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer test-key");
    const body = JSON.parse(String(requestInit?.body));
    assert.equal(body.model, "perplexity/sonar-pro");
    assert.match(body.messages[0].content, /best mushroom-free weeknight pasta/);
    assert.match(body.messages[0].content, /avoid cilantro/);

    assert.equal(result.payload.search.answer, "Use lemon ricotta pasta and cite sources.[1]");
    assert.deepEqual(result.payload.search.citations, [{ url: "https://example.com/lemon-ricotta-pasta", source: "citations" }]);
    assert.equal(result.payload.artifactFiles.length, 2);

    const jsonArtifact = JSON.parse(await readFile(path.join(runDir, "recipe-research.json"), "utf8"));
    assert.equal(jsonArtifact.nodeType, "core.web-search");
    assert.equal(jsonArtifact.searchedAt, "2026-06-01T00:00:00.000Z");
    const markdownArtifact = await readFile(path.join(runDir, "recipe-research.md"), "utf8");
    assert.match(markdownArtifact, /# Web Search/);
    assert.match(markdownArtifact, /https:\/\/example.com\/lemon-ricotta-pasta/);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("core.web-search forwards searchDomainFilter as search_domain_filter (and omits it when absent)", async () => {
  const capture = async (params: Parameters<typeof WebSearchNodeParamsSchema.parse>[0]) => {
    let sentBody: Record<string, unknown> = {};
    await runWebSearchNode({
      nodeId: "node.web-search",
      params: WebSearchNodeParamsSchema.parse(params),
      input: { userInput: { env: { OPENROUTER_API_KEY: "test-key" } } },
      fetchImpl: async (_url, init) => {
        sentBody = JSON.parse(String(init?.body));
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          async text() {
            return JSON.stringify({ choices: [{ message: { content: "ok" } }], citations: [] });
          },
        };
      },
    });
    return sentBody;
  };

  const withFilter = await capture({ query: "high-protein lunches", searchDomainFilter: ["budgetbytes.com", "seriouseats.com"] });
  assert.deepEqual(withFilter.search_domain_filter, ["budgetbytes.com", "seriouseats.com"]);

  const withoutFilter = await capture({ query: "high-protein lunches" });
  assert.equal("search_domain_filter" in withoutFilter, false);

  const emptyFilter = await capture({ query: "high-protein lunches", searchDomainFilter: [] });
  assert.equal("search_domain_filter" in emptyFilter, false);
});

test("core.web-search fails before network when OPENROUTER_API_KEY is missing", async () => {
  await assert.rejects(
    runWebSearchNode({
      nodeId: "node.web-search",
      params: WebSearchNodeParamsSchema.parse({ query: "current recipe trends" }),
      input: { userInput: { env: { OPENROUTER_API_KEY: "" } } },
      fetchImpl: async () => {
        throw new Error("should not be called");
      },
    }),
    /OPENROUTER_API_KEY is required/,
  );
});
