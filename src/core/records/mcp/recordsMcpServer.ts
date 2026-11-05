import readline from "node:readline";

import type { Embedder } from "../embeddings/embedder";
import { redactText } from "../store/text";
import { SEARCH_SOURCE_KINDS, type SearchSourceKind } from "../store/searchDocs";
import type { RecordStore } from "../store/recordStore";
import type { RecordSearchMode } from "../store/search";

/**
 * Minimal MCP (JSON-RPC 2.0 over stdio, newline-delimited) server so agents can search run records.
 * Read-only by construction: every tool goes through RecordStore reads or a READ ONLY transaction.
 */
type Json = Record<string, unknown>;

const TOOLS = [
  {
    name: "records_search",
    description:
      "Search bagelwerk run records: agent prompts, agent events (commands, messages, tool calls, errors), agent output files, node results, node artifacts, flow events and supervisor reports. " +
      "mode: text (stemmed full-text; supports \"quoted phrases\", -exclude, or), fuzzy (substring: error strings, paths, ids), semantic (vector similarity), hybrid (default when embeddings exist).",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        mode: { type: "string", enum: ["text", "fuzzy", "semantic", "hybrid"] },
        kinds: { type: "array", items: { type: "string", enum: SEARCH_SOURCE_KINDS } },
        sessionId: { type: "string" },
        nodePath: { type: "string", description: "Node path prefix, e.g. flowA.lane2" },
        harness: { type: "string", description: "codex, claude-code, ..." },
        observationDir: { type: "string" },
        runDir: { type: "string" },
        since: { type: "string", description: "ISO timestamp" },
        until: { type: "string", description: "ISO timestamp" },
        limit: { type: "integer", minimum: 1, maximum: 200 },
      },
      required: ["query"],
    },
  },
  {
    name: "records_list_runs",
    description: "List recent runs. kind: agent (default), node or flow. Filter by status, sessionId (node/flow), harness (agent), since.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["agent", "node", "flow"] },
        status: { type: "string" },
        sessionId: { type: "string" },
        harness: { type: "string" },
        since: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
    },
  },
  {
    name: "records_get_agent_run",
    description: "One agent run by observationDir (from search hits): prompt, input, summary, usage, file list and its event timeline (paged by afterSeq).",
    inputSchema: {
      type: "object",
      properties: { observationDir: { type: "string" }, afterSeq: { type: "integer" }, limit: { type: "integer", minimum: 1, maximum: 2000 } },
      required: ["observationDir"],
    },
  },
  {
    name: "records_get_node_run",
    description: "One Flow/Workbench node run by runDir: launch snapshot, result, artifacts (with previews), linked agent runs and flow events.",
    inputSchema: { type: "object", properties: { runDir: { type: "string" } }, required: ["runDir"] },
  },
  {
    name: "records_get_file",
    description: "Full text of one stored agent file (e.g. result.md, stderr.txt, failure.json) or node artifact. Give observationDir+relativePath, or runDir+relativePath.",
    inputSchema: {
      type: "object",
      properties: { observationDir: { type: "string" }, runDir: { type: "string" }, relativePath: { type: "string" }, maxChars: { type: "integer" } },
      required: ["relativePath"],
    },
  },
  {
    name: "records_query",
    description:
      "Run one read-only SELECT/WITH statement against the records database (Postgres dialect; rows capped; node_artifacts.content_text is not readable here, use records_get_file). Tables: flow_runs, node_runs, node_artifacts, acceptances, flow_events, agent_runs, agent_run_events, agent_files, supervisor_reports, supervisor_ledger, search_docs. Call records_schema first.",
    inputSchema: { type: "object", properties: { sql: { type: "string" }, maxRows: { type: "integer", minimum: 1, maximum: 2000 } }, required: ["sql"] },
  },
  { name: "records_schema", description: "Columns of every records table.", inputSchema: { type: "object", properties: {} } },
  { name: "records_stats", description: "Row counts, database size and whether semantic search is available.", inputSchema: { type: "object", properties: {} } },
];

export async function handleRecordsTool(store: RecordStore, embedder: Embedder | undefined, name: string, args: Json): Promise<unknown> {
  switch (name) {
    case "records_search":
      return store.search(
        {
          query: String(args.query ?? ""),
          ...(args.mode ? { mode: String(args.mode) as RecordSearchMode } : {}),
          ...(Array.isArray(args.kinds) ? { kinds: args.kinds.map(String) as SearchSourceKind[] } : {}),
          ...(args.sessionId ? { sessionId: String(args.sessionId) } : {}),
          ...(args.nodePath ? { nodePath: String(args.nodePath) } : {}),
          ...(args.harness ? { harness: String(args.harness) } : {}),
          ...(args.observationDir ? { observationDir: String(args.observationDir) } : {}),
          ...(args.runDir ? { runDir: String(args.runDir) } : {}),
          ...(args.since ? { since: String(args.since) } : {}),
          ...(args.until ? { until: String(args.until) } : {}),
          ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
        },
        embedder,
      );
    case "records_list_runs":
      return store.listRuns({
        ...(args.kind ? { kind: String(args.kind) as "agent" | "node" | "flow" } : {}),
        ...(args.status ? { status: String(args.status) } : {}),
        ...(args.sessionId ? { sessionId: String(args.sessionId) } : {}),
        ...(args.harness ? { harness: String(args.harness) } : {}),
        ...(args.since ? { since: String(args.since) } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      });
    case "records_get_agent_run":
      return (await store.getAgentRun(String(args.observationDir ?? ""), {
        ...(typeof args.afterSeq === "number" ? { afterSeq: args.afterSeq } : {}),
        ...(typeof args.limit === "number" ? { limit: args.limit } : {}),
      })) ?? { error: "not found" };
    case "records_get_node_run":
      return (await store.getNodeRun(String(args.runDir ?? ""))) ?? { error: "not found" };
    case "records_get_file": {
      const maxChars = Math.min(Math.max(Number(args.maxChars) || 200_000, 1), 1_000_000);
      const relativePath = String(args.relativePath ?? "");
      const rows = args.observationDir
        ? await store.executor.query<{ content: string | null }>("SELECT content FROM agent_files WHERE observation_dir = $1 AND relative_path = $2", [String(args.observationDir), relativePath])
        : await store.executor.query<{ content: string | null }>("SELECT content_text AS content FROM node_artifacts WHERE run_dir = $1 AND relative_path = $2", [String(args.runDir ?? ""), relativePath]);
      const content = rows[0]?.content;
      if (content === undefined) return { error: "not found" };
      if (content === null) return { error: "stored by reference only (binary or larger than 1 MB)" };
      return { content: redactText(content.slice(0, maxChars)), truncated: content.length > maxChars, chars: content.length };
    }
    case "records_query":
      return store.readOnlyQuery(String(args.sql ?? ""), [], { maxRows: typeof args.maxRows === "number" ? args.maxRows : 200, timeoutMs: 10_000 });
    case "records_schema":
      return (await store.readOnlyQuery(
        `SELECT table_name, string_agg(column_name || ' ' || data_type, ', ' ORDER BY ordinal_position) AS columns
         FROM information_schema.columns WHERE table_schema = current_schema() AND table_name NOT LIKE 'records_%'
         GROUP BY table_name ORDER BY table_name`,
        [],
        { maxRows: 100 },
      )).rows;
    case "records_stats":
      return store.stats();
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

export async function serveRecordsMcp(args: { store: RecordStore; embedder?: Embedder; input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream }): Promise<void> {
  const output = args.output ?? process.stdout;
  const write = (message: Json) => output.write(`${JSON.stringify(message)}\n`);
  const lines = readline.createInterface({ input: args.input ?? process.stdin, crlfDelay: Infinity });
  const inflight: Array<Promise<void>> = [];
  for await (const line of lines) {
    if (!line.trim()) continue;
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
      continue;
    }
    const id = message.id as string | number | undefined;
    const method = String(message.method ?? "");
    const params = (message.params ?? {}) as Json;
    if (id === undefined || id === null) continue; // notifications (initialized, cancelled)
    inflight.push((async () => {
      try {
        switch (method) {
          case "initialize":
            write({
              jsonrpc: "2.0",
              id,
              result: {
                protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-06-18",
                capabilities: { tools: {} },
                serverInfo: { name: "bagelwerk-records", version: "1.0.0" },
                instructions: "Search and inspect bagelwerk run records (agent runs, node runs, artifacts, events). Start with records_search; drill in with records_get_agent_run / records_get_node_run.",
              },
            });
            return;
          case "ping":
            write({ jsonrpc: "2.0", id, result: {} });
            return;
          case "tools/list":
            write({ jsonrpc: "2.0", id, result: { tools: TOOLS } });
            return;
          case "tools/call": {
            try {
              const result = await handleRecordsTool(args.store, args.embedder, String(params.name ?? ""), (params.arguments ?? {}) as Json);
              write({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result, null, 1) }] } });
            } catch (error) {
              write({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] } });
            }
            return;
          }
          default:
            write({ jsonrpc: "2.0", id, error: { code: -32601, message: `method not found: ${method}` } });
        }
      } catch (error) {
        write({ jsonrpc: "2.0", id, error: { code: -32603, message: error instanceof Error ? error.message : String(error) } });
      }
    })());
  }
  await Promise.allSettled(inflight);
}
