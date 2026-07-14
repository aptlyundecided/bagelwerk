import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const DIRECT_EXECUTE_EXEMPTIONS: Record<string, string> = {};

async function listTsFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listTsFiles(fullPath));
    else if (entry.isFile() && fullPath.endsWith(".ts")) files.push(fullPath);
  }
  return files;
}

test("built-in agent Nodes do not bypass validated skill healing without an explicit exemption", async () => {
  const files = await listTsFiles(path.join("src", "core", "built-ins"));
  const offenders: string[] = [];
  for (const file of files.sort()) {
    const normalized = file.split(path.sep).join("/");
    const text = await readFile(file, "utf8");
    if (!/executeSkillBackedNodeSession\s*\(/.test(text)) continue;
    if (DIRECT_EXECUTE_EXEMPTIONS[normalized]) continue;
    offenders.push(normalized);
  }

  assert.deepEqual(offenders, [], `Direct executeSkillBackedNodeSession usage must use executeValidatedSkillBackedNode or be explicitly exempted. Offenders: ${offenders.join(", ")}`);
});
