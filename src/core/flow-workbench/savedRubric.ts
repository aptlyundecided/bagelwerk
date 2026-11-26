import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RubricSchema } from '../rubric';

export type WorkbenchGradeSelection = { runDir: string; relativePath: string } & (
  { kind: 'node' } | { kind: 'flow'; qualifiedNodePath: string }
);
const judgment = z.object({ verdict: z.enum(['pass', 'partial', 'fail']), reason: z.string().trim().min(1) });
type Judgment = z.infer<typeof judgment>;
const snapshot = z.object({ rubric: RubricSchema.optional() });
const tree = snapshot.extend({ nodes: z.array(z.object({ qualifiedNodePath: z.string(), runDir: z.string() })) });
const emissions = z.array(z.object({ relativePath: z.string(), exists: z.boolean() }));
async function readJson(dir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
}

/** Inspect a trusted local Workbench run, never its live producer or acceptance state. */
export async function gradeFlowWorkbenchOutput(selection: WorkbenchGradeSelection,
  evaluate: (criterion: string, output: string) => Judgment | Promise<Judgment>) {
  let dir = selection.runDir;
  let rubric;
  if (selection.kind === 'flow') {
    const saved = tree.parse(await readJson(dir, 'run-tree.json'));
    rubric = saved.rubric;
    if (!rubric) return { status: 'no-rubric' } as const;
    const nodes = saved.nodes.filter(n => n.qualifiedNodePath === selection.qualifiedNodePath);
    if (nodes.length !== 1) throw Error('Select exactly one producing Node from this Flow run');
    dir = nodes[0]!.runDir;
  } else {
    rubric = snapshot.parse(await readJson(dir, 'launch-snapshot.json')).rubric;
    if (!rubric) return { status: 'no-rubric' } as const;
  }
  const emitted = emissions.parse(await readJson(dir, 'artifact-events.json'));
  if (!emitted.some(event => event.exists && event.relativePath === selection.relativePath)) {
    throw Error('Selected artifact was not emitted by this Node run');
  }
  const root = await realpath(dir);
  const file = await realpath(path.resolve(root, selection.relativePath));
  const relative = path.relative(root, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw Error('Selected artifact must be inside the saved Node run');
  }
  const output = await readFile(file, 'utf8');
  const results = [];
  for (const criterion of rubric.criteria) {
    results.push({ criterion, ...judgment.parse(await evaluate(criterion, output)) });
  }
  return { status: 'graded', results } as const;
}
