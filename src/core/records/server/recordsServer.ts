import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";

import type { SqlExecutor, SqlStatement } from "../sql/types";

const MAX_BODY_BYTES = 64 * 1024 * 1024;

export type RecordsServerAdvert = { url: string; token: string; pid: number; dataDir: string; startedAt: string };

export function serverAdvertPath(recordsDir: string): string {
  return path.join(recordsDir, "server.json");
}

export function readServerAdvert(recordsDir: string): RecordsServerAdvert | undefined {
  try {
    const advert = JSON.parse(readFileSync(serverAdvertPath(recordsDir), "utf8")) as RecordsServerAdvert;
    process.kill(advert.pid, 0);
    return advert;
  } catch {
    return undefined;
  }
}

export type RecordsServer = { url: string; token: string; close(): Promise<void> };

/**
 * Owns one executor (normally the in-process PGlite) and lets other processes use it. Binds loopback
 * only and requires a bearer token that is written, mode 0600, to `<recordsDir>/server.json`.
 */
export async function startRecordsServer(args: {
  executor: SqlExecutor;
  recordsDir: string;
  dataDir: string;
  host?: string;
  port?: number;
  token?: string;
  /** Do not keep the process alive just for the server (in-process owners in auto mode). */
  unref?: boolean;
  log?: (line: string) => void;
}): Promise<RecordsServer> {
  const token = args.token ?? randomBytes(24).toString("hex");
  const expected = Buffer.from(`Bearer ${token}`);

  const server = http.createServer((request, response) => {
    const send = (status: number, body: unknown) => {
      const payload = JSON.stringify(body);
      response.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
      response.end(payload);
    };
    const presented = Buffer.from(String(request.headers.authorization ?? ""));
    if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
      send(401, { ok: false, error: "unauthorized" });
      return;
    }
    if (request.method !== "POST") {
      send(request.url === "/v1/health" ? 200 : 405, request.url === "/v1/health" ? { ok: true, result: { pid: process.pid } } : { ok: false, error: "POST only" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        send(413, { ok: false, error: "request too large" });
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as Record<string, unknown>;
          const sql = String(body.sql ?? "");
          const params = Array.isArray(body.params) ? body.params : [];
          let result: unknown;
          switch (request.url) {
            case "/v1/query":
              result = await args.executor.query(sql, params);
              break;
            case "/v1/exec":
              await args.executor.exec(sql);
              result = null;
              break;
            case "/v1/transaction":
              result = await args.executor.transaction((Array.isArray(body.statements) ? body.statements : []) as SqlStatement[]);
              break;
            case "/v1/read-only":
              result = await args.executor.readOnlyQuery(sql, params, (body.options ?? {}) as Record<string, number>);
              break;
            default:
              send(404, { ok: false, error: `unknown route ${request.url}` });
              return;
          }
          send(200, { ok: true, result });
        } catch (error) {
          send(400, { ok: false, error: error instanceof Error ? error.message : String(error) });
        }
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(args.port ?? 0, args.host ?? "127.0.0.1", () => resolve());
  });
  if (args.unref) server.unref();
  const address = server.address() as AddressInfo;
  const url = `http://${address.address}:${address.port}`;
  mkdirSync(args.recordsDir, { recursive: true });
  const advertPath = serverAdvertPath(args.recordsDir);
  const advert: RecordsServerAdvert = { url, token, pid: process.pid, dataDir: args.dataDir, startedAt: new Date().toISOString() };
  writeFileSync(advertPath, `${JSON.stringify(advert, null, 2)}\n`, { mode: 0o600 });
  chmodSync(advertPath, 0o600);
  args.log?.(`records server listening on ${url} (advert ${advertPath})`);

  const removeAdvert = () => {
    try {
      const current = JSON.parse(readFileSync(advertPath, "utf8")) as RecordsServerAdvert;
      if (current.pid === process.pid && current.url === url) unlinkSync(advertPath);
    } catch {
      // gone
    }
  };
  process.once("exit", removeAdvert);

  return {
    url,
    token,
    async close() {
      removeAdvert();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
