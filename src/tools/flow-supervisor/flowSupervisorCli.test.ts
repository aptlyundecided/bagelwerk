import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

async function createCliFlowWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "flow-supervisor-cli-"));
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "flowModule.mjs"), "export default { flow: {}, configuredNodes: [], nodeRegistry: { get() {}, list() { return []; } } };\n", "utf8");
  await writeFile(path.join(root, "flow.config.json"), `${JSON.stringify({
    schemaVersion: 1,
    flows: [{
      id: "cli-smoke",
      module: "./flowModule.mjs",
      label: "CLI Smoke",
      aliases: ["cli-smoke-alias"],
      prompts: [{ key: "answer", kind: "text", label: "Answer", default: "yes" }],
    }],
  }, null, 2)}\n`, "utf8");
  return root;
}

test("flowSupervisorCli list --json includes cwd catalog metadata", async () => {
  const cwd = await createCliFlowWorkspace();
  const result = spawnSync(process.execPath, ["./node_modules/tsx/dist/cli.mjs", "src/tools/flow-supervisor/flowSupervisorCli.ts", "list", "--json", "--cwd", cwd], {
    cwd: path.resolve(__dirname, "..", "..", ".."),
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { flows: Array<{ id: string; aliases: string[]; prompts?: Array<{ key: string }> }> };
  const flow = parsed.flows.find((entry) => entry.id.endsWith(":cli-smoke"));
  assert.ok(flow);
  assert.ok(flow.aliases.includes("cli-smoke-alias"));
  assert.equal(flow.prompts?.[0]?.key, "answer");
});

test("flowSupervisorCli run --yes is non-interactive (does not hang on prompts)", async () => {
  const cwd = await createCliFlowWorkspace();
  // With --yes and no stdin, the declared "answer" prompt must be skipped (default used) rather
  // than blocking on inquirer. The stub flow run then fails, but the process must terminate.
  const result = spawnSync(
    process.execPath,
    ["./node_modules/tsx/dist/cli.mjs", "src/tools/flow-supervisor/flowSupervisorCli.ts", "run", "cli-smoke-alias", "--cwd", cwd, "--mode", "local", "--allow-dirty-worktree", "--yes"],
    { cwd: path.resolve(__dirname, "..", "..", ".."), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
  );

  // Did not time out (signal would be SIGTERM on timeout) — i.e. it never blocked on a prompt.
  assert.notEqual(result.signal, "SIGTERM", "run --yes appears to have hung waiting for interactive input");
  // The interactive prompt label must not have been emitted.
  assert.ok(!`${result.stdout}${result.stderr}`.includes("? Answer"), "an interactive prompt was shown despite --yes");
});
