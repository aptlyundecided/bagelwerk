import http from "node:http";

import type { ReadOnlyQueryOptions, ReadOnlyQueryResult, SqlExecutor, SqlRow, SqlStatement } from "./types";

/**
 * Client for the local records server (`records serve`). The server owns the PGlite data directory;
 * any number of processes write through it. Requests are JSON over loopback HTTP with a bearer token.
 */
/** The server could not be reached or answered as a server that no longer owns the store; re-resolve and retry. */
export class RecordsTransportError extends Error {
  readonly transport = true;
}

export function isRecordsTransportError(error: unknown): boolean {
  return Boolean((error as { transport?: unknown } | null)?.transport);
}

export function createHttpExecutor(options: { url: string; token: string; timeoutMs?: number }): SqlExecutor {
  const base = new URL(options.url);

  function call<T>(route: string, body: unknown): Promise<T> {
    const payload = Buffer.from(JSON.stringify(body), "utf8");
    return new Promise<T>((resolve, reject) => {
      const request = http.request(
        {
          hostname: base.hostname,
          port: base.port,
          path: `/v1/${route}`,
          method: "POST",
          agent: false,
          headers: {
            "content-type": "application/json",
            "content-length": payload.length,
            authorization: `Bearer ${options.token}`,
          },
          timeout: options.timeoutMs ?? 60_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => {
            let parsed: { ok?: boolean; result?: T; error?: string } = {};
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            } catch {
              reject(new RecordsTransportError(`records server returned invalid JSON (HTTP ${response.statusCode})`));
              return;
            }
            if (response.statusCode === 200 && parsed.ok) resolve(parsed.result as T);
            // 401: a restarted server with a new token. 5xx: not a SQL problem. Both mean "find the store again".
            else if (response.statusCode === 401 || (response.statusCode ?? 500) >= 500) reject(new RecordsTransportError(parsed.error ?? `records server HTTP ${response.statusCode}`));
            else reject(new Error(parsed.error ?? `records server HTTP ${response.statusCode}`));
          });
        },
      );
      request.on("timeout", () => request.destroy(new RecordsTransportError("records server request timed out")));
      request.on("error", (error) => reject(isRecordsTransportError(error) ? error : new RecordsTransportError(error.message)));
      request.end(payload);
    });
  }

  return {
    kind: "http",
    query<T = SqlRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      return call<T[]>("query", { sql, params });
    },
    async exec(sql: string): Promise<void> {
      await call("exec", { sql });
    },
    transaction(statements: SqlStatement[]): Promise<SqlRow[][]> {
      return call<SqlRow[][]>("transaction", { statements });
    },
    readOnlyQuery<T = SqlRow>(sql: string, params: unknown[] = [], options: ReadOnlyQueryOptions = {}): Promise<ReadOnlyQueryResult<T>> {
      return call<ReadOnlyQueryResult<T>>("read-only", { sql, params, options });
    },
    async close(): Promise<void> {
      // Stateless client.
    },
  };
}
