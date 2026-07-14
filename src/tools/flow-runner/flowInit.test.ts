import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runExternalFlow } from "../../core/flow-runner";
import { scaffoldFlow } from "./flowInit";

async function exists(filePath: string): Promise<boolean> {
  try { await stat(filePath); return true; } catch { return false; }
}

test("scaffoldFlow rejects bad names", async () => {
  await assert.rejects(() => scaffoldFlow({ name: "Bad Name" }), /Invalid flow name/);
  await assert.rejects(() => scaffoldFlow({ name: "1leading-digit" }), /Invalid flow name/);
});

// End-to-end: the scaffolded Flow must be a valid, runnable, chained Flow. The generated
// starterFlow.ts imports ../../src/core/..., so it must live under the repo's flow-library/.
test("scaffolded starter flow runs end to end and chains seed -> echo", async () => {
  const name = `initsmoke-${Date.now()}`;
  const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "flow-init-"));
  let targetDir = "";
  try {
    const result = await scaffoldFlow({ name });
    targetDir = result.targetDir;
    assert.deepEqual(result.files.sort(), ["README.md", "flow.config.json", "starterFlow.ts"]);
    assert.ok(await exists(path.join(targetDir, "starterFlow.ts")));

    const run = await runExternalFlow({ cwd: targetDir, flowId: result.flowId, sessionId: "smoke", artifactRoot });

    // Completed proves echo (core.read-json, fromArtifact: seed.json) successfully consumed
    // the upstream accepted artifact — i.e. chaining works through the real runner.
    assert.equal(run.run.runTree.status, "completed");
    assert.equal(run.run.runTree.nodes.length, 2);
    assert.ok(run.run.runTree.nodes.every((node) => node.status === "completed"));
  } finally {
    if (targetDir) await rm(targetDir, { recursive: true, force: true });
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
