import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { RubricSchema, type Rubric } from '../rubric';
import { workbenchNodeRoot } from './runRecords';

export type WorkbenchGradeSelection = { rubric?: Rubric } & (
  | { kind: 'text'; output: string }
  | { kind: 'node'; runDir: string; relativePath: string }
  | { kind: 'flow'; runDir: string; relativePath: string; qualifiedNodePath: string }
);
const judgment = z.object({ verdict: z.enum(['pass', 'partial', 'fail']), reason: z.string().trim().min(1) });
type Evaluator = (criterion: string, output: string) => z.infer<typeof judgment> | Promise<z.infer<typeof judgment>>;
const snapshot = z.object({ rubric: RubricSchema.optional() });
const tree = snapshot.extend({ nodes: z.array(z.object({ qualifiedNodePath: z.string(), runDir: z.string() })) });
const emissions = z.array(z.object({ relativePath: z.string(), exists: z.boolean() }));
const noRubric = { status: 'no-rubric' } as const;
async function readJson(dir: string, name: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
}

// Run trees written before relocation support also record a numbered Node runDir.
// Keep only its run number; never follow the path back to the original workspace.
function nodeRunInSelectedSession(flowDir: string, node: { qualifiedNodePath: string; runDir: string }) {
  const dir = path.resolve(flowDir);
  const latest = path.basename(dir) === 'latest';
  if (!latest && !(/^run-\d+$/.test(path.basename(dir)) && path.basename(path.dirname(dir)) === 'runs')) {
    throw Error('Select a numbered or latest Flow run directory');
  }
  const session = path.resolve(dir, latest ? '../..' : '../../..');
  const number = path.win32.basename(node.runDir); // Also reads run paths recorded on another OS.
  if (!/^run-\d+$/.test(number)) throw Error('Expected a numbered producing Node run');
  return path.join(workbenchNodeRoot(path.dirname(session), path.basename(session), node.qualifiedNodePath), 'runs', number);
}

async function gradeText(output: string, rubric: Rubric, evaluate: Evaluator) {
  const results = [];
  for (const criterion of rubric.criteria) {
    results.push({ criterion, ...judgment.parse(await evaluate(criterion, output)) });
  }
  return { status: 'graded', results } as const;
}

/** Grade saved text or a trusted local Workbench run, without executing the producer. */
export async function gradeFlowWorkbenchOutput(selection: WorkbenchGradeSelection, evaluate: Evaluator) {
  const override = RubricSchema.optional().parse(selection.rubric);
  if (selection.kind === 'text') return override ? gradeText(selection.output, override, evaluate) : noRubric;

  let dir = selection.runDir;
  let rubric;
  if (selection.kind === 'flow') {
    const saved = tree.parse(await readJson(dir, 'run-tree.json'));
    rubric = override ?? saved.rubric;
    if (!rubric) return noRubric;
    const nodes = saved.nodes.filter(n => n.qualifiedNodePath === selection.qualifiedNodePath);
    if (nodes.length !== 1) throw Error('Select exactly one producing Node from this Flow run');
    dir = nodeRunInSelectedSession(dir, nodes[0]!);
  } else {
    const saved = snapshot.parse(await readJson(dir, 'launch-snapshot.json'));
    rubric = override ?? saved.rubric;
    if (!rubric) return noRubric;
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
  return gradeText(await readFile(file, 'utf8'), rubric, evaluate);
}
