import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticNodeRegistry } from '../nodes/config';
import { gradeFlowWorkbenchOutput, runFlowWorkbenchFlow } from './index';

async function produce(workspaceRoot: string, hasRubrics: boolean) {
  const file = path.join(workspaceRoot, 'produced.txt');
  const dates = { createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  let produced = 0;
  const run = await runFlowWorkbenchFlow({
      workspaceRoot, sessionId: 'sample', input: {}, log: () => {},
      flow: { ...dates, flowId: 'demo', name: 'Demo', initial: 'emit', nodes: { emit: { nodeId: 'writer' } },
        ...(hasRubrics && { rubric: { criteria: ['hello', 'world'] } }) },
      configuredNodes: [{ ...dates, nodeId: 'writer', nodeType: 'writer', name: 'Writer', description: 'Writes text', params: {},
        ...(hasRubrics && { rubric: { criteria: ['bye'] } }) }],
      nodeRegistry: createStaticNodeRegistry([{ nodeType: 'writer', validateParams: () => ({}),
        execute: async () => { produced++; await writeFile(file, 'hello world'); return { status: 'completed', payload: {} }; },
        describeArtifacts: () => ({ outputs: [{ key: 'text', label: 'Text', relativePath: 'text.txt' }] }),
        collectArtifacts: () => [{ key: 'text', label: 'Text', relativePath: 'text.txt', path: file }],
      }]),
    });
  return { run, file, producerCalls: () => produced };
}

for (const hasRubrics of [true, false]) {
  test(hasRubrics ? 'grades one saved artifact against distinct Flow and Node rubrics' : 'Flow and Node without rubrics run normally and skip grading', async t => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'rubric-'));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const { run, file, producerCalls } = await produce(workspaceRoot, hasRubrics);
    let evaluations = 0;
    assert.equal(run.runTree.status, 'completed');
    assert.equal(run.nodeRuns[0]!.artifactExistence?.[0]?.exists, true);
    await rm(file); // No live producer output is available to the grader.
    const grade = (criterion: string, output: string) => {
      evaluations++;
      assert.equal(output, 'hello world');
      return output.includes(criterion) ? { verdict: 'pass' as const, reason: `contains ${criterion}` } : { verdict: 'fail' as const, reason: `missing ${criterion}` };
    };
    const flow = await gradeFlowWorkbenchOutput({ kind: 'flow', runDir: run.record.runDir, qualifiedNodePath: 'demo.emit', relativePath: 'text.txt' }, grade);
    const node = await gradeFlowWorkbenchOutput({ kind: 'node', runDir: run.nodeRuns[0]!.record.runDir, relativePath: 'text.txt' }, grade);
    assert.deepEqual(flow, hasRubrics ? { status: 'graded', results: [
      { criterion: 'hello', verdict: 'pass', reason: 'contains hello' }, { criterion: 'world', verdict: 'pass', reason: 'contains world' },
    ] } : { status: 'no-rubric' });
    assert.deepEqual(node, hasRubrics ? { status: 'graded', results: [{ criterion: 'bye', verdict: 'fail', reason: 'missing bye' }] } : { status: 'no-rubric' });
    assert.equal(evaluations, hasRubrics ? 3 : 0);
    const rubric = { criteria: ['world'] };
    const revisedFlow = await gradeFlowWorkbenchOutput({ kind: 'flow', rubric, runDir: run.record.runDir, qualifiedNodePath: 'demo.emit', relativePath: 'text.txt' }, grade);
    const revisedNode = await gradeFlowWorkbenchOutput({ kind: 'node', rubric, runDir: run.nodeRuns[0]!.record.runDir, relativePath: 'text.txt' }, grade);
    assert.deepEqual(revisedFlow, { status: 'graded', results: [{ criterion: 'world', verdict: 'pass', reason: 'contains world' }] });
    assert.deepEqual(revisedNode, revisedFlow);
    assert.equal(producerCalls(), 1);
  });
}

test('regrades one standalone JSON artifact without Workbench sidecars', async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'saved-text-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'answer.json');
  await writeFile(file, '{"answer":"yes"}');
  const selection = { kind: 'text' as const, output: await readFile(file, 'utf8') };
  const evaluate = (criterion: string, output: string) => ({
    verdict: JSON.parse(output).answer === criterion ? 'pass' as const : 'fail' as const, reason: `Answer was ${JSON.parse(output).answer}`,
  });
  for (const [criterion, verdict] of [['yes', 'pass'], ['no', 'fail']] as const) {
    assert.deepEqual(await gradeFlowWorkbenchOutput({ ...selection, rubric: { criteria: [criterion] } }, evaluate),
      { status: 'graded', results: [{ criterion, verdict, reason: 'Answer was yes' }] });
  }
  assert.deepEqual(await gradeFlowWorkbenchOutput(selection, () => assert.fail('no rubric')), { status: 'no-rubric' });
});

test('copied and moved Flow selections follow the recorded Node run within the selected session', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'relocated-session-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { run } = await produce(root, true);
  const original = path.join(root, 'sample');
  const copy = path.join(root, 'renamed-session');
  const inCopy = (dir: string) => path.join(copy, path.relative(original, dir));
  await cp(original, copy, { recursive: true });
  const nodeDir = inCopy(run.nodeRuns[0]!.record.runDir);
  await writeFile(path.join(nodeDir, 'text.txt'), 'only in the copied numbered run');
  const evaluate = (_criterion: string, output: string) => ({ verdict: 'pass' as const, reason: output });
  const rubric = { criteria: ['inspect'] };
  const node = await gradeFlowWorkbenchOutput({ kind: 'node', rubric, runDir: nodeDir, relativePath: 'text.txt' }, evaluate);
  assert.deepEqual(node, { status: 'graded', results: [{ criterion: 'inspect', verdict: 'pass', reason: 'only in the copied numbered run' }] });
  for (const removeOriginal of [false, true]) {
    if (removeOriginal) await rm(original, { recursive: true });
    for (const dir of [run.record.runDir, run.record.latestDir]) {
      assert.deepEqual(await gradeFlowWorkbenchOutput({ kind: 'flow', rubric, runDir: inCopy(dir), qualifiedNodePath: 'demo.emit', relativePath: 'text.txt' }, evaluate), node);
    }
  }
});
