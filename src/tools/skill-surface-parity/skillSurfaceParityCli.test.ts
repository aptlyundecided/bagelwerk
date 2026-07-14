import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applySkillSurfaceParityPlan,
  formatSkillSurfaceParityReport,
  planSkillSurfaceParity,
} from "./skillSurfaceParityCli";

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const absolutePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, content, "utf8");
}

async function readFile(root: string, relativePath: string): Promise<string> {
  return fs.readFile(path.join(root, relativePath), "utf8");
}

test("plan reports multi-target missing and outdated pi-backed skill files while preserving target-only skills", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "skill-surface-parity-"));
  const sourceRoot = path.join(tempRoot, ".pi", "skills");
  const codexRoot = path.join(tempRoot, ".codex", "skills");
  const claudeRoot = path.join(tempRoot, ".claude", "skills");
  const cursorRoot = path.join(tempRoot, ".cursor", "skills");

  await writeFile(sourceRoot, "change-companion/SKILL.md", "pi change companion\n");
  await writeFile(sourceRoot, "change-companion/references/lens-arch.md", "arch lens\n");
  await writeFile(sourceRoot, "todo-monitor/SKILL.md", "pi todo monitor\n");

  await writeFile(codexRoot, "change-companion/SKILL.md", "old codex content\n");
  await writeFile(codexRoot, "open-items/SKILL.md", "codex-only skill\n");
  await writeFile(claudeRoot, "todo-monitor/SKILL.md", "pi todo monitor\n");
  await writeFile(cursorRoot, "change-companion/SKILL.md", "pi change companion\n");
  await writeFile(cursorRoot, "todo-monitor/SKILL.md", "old cursor todo\n");

  const plan = await planSkillSurfaceParity({
    sourceRoot,
    targetRoots: [codexRoot, claudeRoot, cursorRoot],
  });

  assert.deepEqual(plan.sourceSkills, ["change-companion", "todo-monitor"]);
  assert.deepEqual(plan.targetOnlySkillsByRoot[codexRoot], ["open-items"]);
  assert.deepEqual(plan.targetOnlySkillsByRoot[claudeRoot], []);
  assert.deepEqual(
    plan.issues.map((issue) => ({
      target: path.basename(path.dirname(issue.targetRoot)),
      skill: issue.skillName,
      file: issue.relativePath,
      kind: issue.kind,
    })),
    [
      { target: ".claude", skill: "change-companion", file: "references/lens-arch.md", kind: "missing" },
      { target: ".claude", skill: "change-companion", file: "SKILL.md", kind: "missing" },
      { target: ".codex", skill: "change-companion", file: "references/lens-arch.md", kind: "missing" },
      { target: ".codex", skill: "change-companion", file: "SKILL.md", kind: "outdated" },
      { target: ".codex", skill: "todo-monitor", file: "SKILL.md", kind: "missing" },
      { target: ".cursor", skill: "change-companion", file: "references/lens-arch.md", kind: "missing" },
      { target: ".cursor", skill: "todo-monitor", file: "SKILL.md", kind: "outdated" },
    ],
  );

  const report = formatSkillSurfaceParityReport(plan, { reportOnly: true });
  assert.match(report, /Skill surface parity \(report-only\)/);
  assert.match(report, /Source skills in scope: 2/);
  assert.match(report, /Target-only skills preserved for .*\.codex\/skills: open-items/);
  assert.match(report, /## .*\.claude\/skills/);
  assert.match(report, /\[outdated\] SKILL\.md/);
});

test("apply copies missing and outdated files into every requested target root", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "skill-surface-parity-"));
  const sourceRoot = path.join(tempRoot, ".pi", "skills");
  const codexRoot = path.join(tempRoot, ".codex", "skills");
  const claudeRoot = path.join(tempRoot, ".claude", "skills");

  await writeFile(sourceRoot, "grill-with-docs/SKILL.md", "fresh skill\n");
  await writeFile(sourceRoot, "grill-with-docs/CONTEXT-FORMAT.md", "context format\n");
  await writeFile(codexRoot, "grill-with-docs/SKILL.md", "stale skill\n");
  await writeFile(codexRoot, "open-items/SKILL.md", "keep me\n");

  const plan = await planSkillSurfaceParity({
    sourceRoot,
    targetRoots: [codexRoot, claudeRoot],
  });
  assert.equal(plan.issues.length, 4);

  await applySkillSurfaceParityPlan(plan);

  assert.equal(await readFile(codexRoot, "grill-with-docs/SKILL.md"), "fresh skill\n");
  assert.equal(await readFile(codexRoot, "grill-with-docs/CONTEXT-FORMAT.md"), "context format\n");
  assert.equal(await readFile(claudeRoot, "grill-with-docs/SKILL.md"), "fresh skill\n");
  assert.equal(await readFile(claudeRoot, "grill-with-docs/CONTEXT-FORMAT.md"), "context format\n");
  assert.equal(await readFile(codexRoot, "open-items/SKILL.md"), "keep me\n");

  const afterPlan = await planSkillSurfaceParity({
    sourceRoot,
    targetRoots: [codexRoot, claudeRoot],
  });
  assert.equal(afterPlan.issues.length, 0);
});

test("skill filter limits planning to the requested pi skill names", async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "skill-surface-parity-"));
  const sourceRoot = path.join(tempRoot, ".pi", "skills");
  const codexRoot = path.join(tempRoot, ".codex", "skills");

  await writeFile(sourceRoot, "change-companion/SKILL.md", "pi change companion\n");
  await writeFile(sourceRoot, "todo-monitor/SKILL.md", "pi todo monitor\n");

  const plan = await planSkillSurfaceParity({
    sourceRoot,
    targetRoots: [codexRoot],
    skillNames: ["todo-monitor"],
  });

  assert.deepEqual(plan.sourceSkills, ["todo-monitor"]);
  assert.deepEqual(plan.skillFilter, ["todo-monitor"]);
  assert.deepEqual(
    plan.issues.map((issue) => issue.skillName),
    ["todo-monitor"],
  );
});
