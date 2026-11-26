import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticNodeRegistry } from '../nodes/config';
import { gradeFlowWorkbenchOutput, runFlowWorkbenchFlow } from './index';

for (const hasRubrics of [true, false]) {
  test(hasRubrics ? 'grades one saved artifact against distinct Flow and Node rubrics' : 'Flow and Node without rubrics run normally and skip grading', async t => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'rubric-'));
    t.after(() => rm(workspaceRoot, { recursive: true, force: true }));
    const file = path.join(workspaceRoot, 'produced.txt');
    const dates = { createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    let produced = 0, evaluations = 0;
    const run = await runFlowWorkbenchFlow({ workspaceRoot, sessionId: 'sample', input: {}, log: () => {},
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
    assert.equal(produced, 1);
    assert.equal(evaluations, hasRubrics ? 3 : 0);
  });
}
