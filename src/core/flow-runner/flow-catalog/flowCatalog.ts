import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import type { ExternalFlowCatalogEntry } from "../types";
import { externalFlowCatalogEntryFromResolved, FLOW_CONFIG_FILENAME, resolveExternalFlowConfig } from "../flowConfig";

export type ExternalFlowCatalogDiagnostic = {
  severity: "warning" | "error";
  sourceRoot: string;
  message: string;
};

export type ExternalFlowCatalog = {
  flows: ExternalFlowCatalogEntry[];
  diagnostics: ExternalFlowCatalogDiagnostic[];
};

export type DiscoverExternalFlowCatalogParams = {
  repoRoot?: string;
  cwd?: string;
  includeCwd?: boolean;
  includeFlowLibrary?: boolean;
};

export async function discoverExternalFlowCatalog(params: DiscoverExternalFlowCatalogParams = {}): Promise<ExternalFlowCatalog> {
  const repoRoot = path.resolve(params.repoRoot ?? process.cwd());
  const includeCwd = params.includeCwd ?? Boolean(params.cwd);
  const includeFlowLibrary = params.includeFlowLibrary ?? true;
  const sourceRoots: Array<{ root: string; kind: ExternalFlowCatalogEntry["source"]["kind"] }> = [];

  if (includeCwd && params.cwd) {
    sourceRoots.push({ root: path.resolve(params.cwd), kind: "cwd" });
  }

  if (includeFlowLibrary) {
    for (const root of await discoverFlowLibraryRoots(repoRoot)) {
      sourceRoots.push({ root, kind: "flow-library" });
    }
  }

  const seenSourceRoots = new Set<string>();
  const flows: ExternalFlowCatalogEntry[] = [];
  const diagnostics: ExternalFlowCatalogDiagnostic[] = [];

  for (const source of sourceRoots) {
    const normalizedRoot = path.resolve(source.root);
    if (seenSourceRoots.has(normalizedRoot)) continue;
    seenSourceRoots.add(normalizedRoot);
    try {
      const entries = await resolveExternalFlowConfig(normalizedRoot);
      flows.push(...entries.map((entry) => externalFlowCatalogEntryFromResolved(entry, source.kind)));
    } catch (error) {
      diagnostics.push({
        severity: "error",
        sourceRoot: normalizedRoot,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  flows.sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  return { flows, diagnostics };
}

export type ResolveExternalFlowCatalogEntryResult =
  | { ok: true; entry: ExternalFlowCatalogEntry; matchedBy: "id" | "localId" | "alias" }
  | { ok: false; reason: "empty-catalog" | "not-found" | "ambiguous"; message: string; matches?: ExternalFlowCatalogEntry[] };

export function resolveExternalFlowCatalogEntry(catalog: ExternalFlowCatalog, selector: string): ResolveExternalFlowCatalogEntryResult {
  const needle = selector.trim();
  if (catalog.flows.length === 0) {
    return { ok: false, reason: "empty-catalog", message: "No external Flows were discovered." };
  }

  const exactId = catalog.flows.filter((entry) => entry.id === needle);
  if (exactId.length === 1) return { ok: true, entry: exactId[0]!, matchedBy: "id" };
  if (exactId.length > 1) return ambiguous(needle, exactId);

  const localId = catalog.flows.filter((entry) => entry.localId === needle);
  if (localId.length === 1) return { ok: true, entry: localId[0]!, matchedBy: "localId" };
  if (localId.length > 1) return ambiguous(needle, localId);

  const alias = catalog.flows.filter((entry) => entry.aliases.includes(needle));
  if (alias.length === 1) return { ok: true, entry: alias[0]!, matchedBy: "alias" };
  if (alias.length > 1) return ambiguous(needle, alias);

  return {
    ok: false,
    reason: "not-found",
    message: `Unknown external Flow '${needle}'. Known selectors: ${knownSelectors(catalog.flows).join(", ") || "<none>"}`,
  };
}

async function discoverFlowLibraryRoots(repoRoot: string): Promise<string[]> {
  const flowLibraryRoot = path.join(repoRoot, "flow-library");
  let entries;
  try {
    entries = await readdir(flowLibraryRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const roots: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const childRoot = path.join(flowLibraryRoot, entry.name);
    try {
      const configStat = await stat(path.join(childRoot, FLOW_CONFIG_FILENAME));
      if (configStat.isFile()) roots.push(childRoot);
    } catch {
      // Ignore directories that are not Flow workspaces.
    }
  }
  return roots;
}

function ambiguous(selector: string, matches: ExternalFlowCatalogEntry[]): ResolveExternalFlowCatalogEntryResult {
  return {
    ok: false,
    reason: "ambiguous",
    message: `External Flow selector '${selector}' is ambiguous: ${matches.map((entry) => entry.id).join(", ")}`,
    matches,
  };
}

function knownSelectors(entries: ExternalFlowCatalogEntry[]): string[] {
  const selectors = new Set<string>();
  for (const entry of entries) {
    selectors.add(entry.id);
    selectors.add(entry.localId);
    for (const alias of entry.aliases) selectors.add(alias);
  }
  return Array.from(selectors).sort();
}
