import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_MAX_CONCURRENT_AGENT_JOBS, createAgentConcurrencyGate, skillBackedAgentGate } from "./agentConcurrencyGate";

function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test("default skill-backed agent gate caps concurrency at 2", () => {
  assert.equal(DEFAULT_MAX_CONCURRENT_AGENT_JOBS, 2);
  assert.equal(skillBackedAgentGate.snapshot().maxConcurrent, 2);
});

test("agent concurrency gate caps active tasks", async () => {
  let active = 0;
  let maxActive = 0;
  const release: Array<() => void> = [];
  const gate = createAgentConcurrencyGate({ maxConcurrent: 2, minStartSpacingMs: 0 });

  const tasks = Array.from({ length: 4 }, (_, index) => gate.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>((resolve) => { release[index] = resolve; });
    active -= 1;
    return index;
  }));

  await tick();
  assert.equal(maxActive, 2);
  assert.equal(release.filter(Boolean).length, 2);
  release[0]?.();
  release[1]?.();
  await tick();
  assert.equal(release.filter(Boolean).length, 4);
  release[2]?.();
  release[3]?.();

  assert.deepEqual(await Promise.all(tasks), [0, 1, 2, 3]);
  assert.equal(maxActive, 2);
});

test("agent concurrency gate spaces task starts", async () => {
  let clock = 0;
  const starts: number[] = [];
  const gate = createAgentConcurrencyGate({
    maxConcurrent: 4,
    minStartSpacingMs: 5,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
  });

  await Promise.all(Array.from({ length: 4 }, (_, index) => gate.run(async () => {
    starts.push(clock);
    return index;
  })));

  assert.deepEqual(starts, [0, 5, 10, 15]);
});
