#!/usr/bin/env node
import path from "node:path";
import { promises as fs } from "node:fs";

type SkillParityIssueKind = "missing" | "outdated";

export type SkillParityFileIssue = {
  targetRoot: string;
  skillName: string;
  relativePath: string;
  sourcePath: string;
  targetPath: string;
  kind: SkillParityIssueKind;
};

export type SkillParityPlan = {
  sourceRoot: string;
  targetRoots: string[];
  skillFilter: string[];
  sourceSkills: string[];
  targetOnlySkillsByRoot: Record<string, string[]>;
  issues: SkillParityFileIssue[];
};

function toDisplayPath(value: string): string {
  return value.split(path.sep).join("/");
}

async function directoryExists(value: string): Promise<boolean> {
  try {
    const stat = await fs.stat(value);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function listSkillDirectories(root: string): Promise<string[]> {
  if (!(await directoryExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

async function listFilesRecursive(root: string): Promise<string[]> {
  const results: string[] = [];

  async function visit(currentPath: string, relativeDir = ""): Promise<void> {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const sortedEntries = entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of sortedEntries) {
      const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const absolutePath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath, relativePath);
        continue;
      }
      if (entry.isFile()) {
        results.push(relativePath);
      }
    }
  }

  if (await directoryExists(root)) {
    await visit(root);
  }

  return results.sort((left, right) => left.localeCompare(right));
}

async function filesMatch(sourcePath: string, targetPath: string): Promise<boolean> {
  try {
    const [sourceContents, targetContents] = await Promise.all([
      fs.readFile(sourcePath),
      fs.readFile(targetPath),
    ]);
    return sourceContents.equals(targetContents);
  } catch {
    return false;
  }
}

export async function planSkillSurfaceParity(params: {
  sourceRoot: string;
  targetRoots: string[];
  skillNames?: string[];
}): Promise<SkillParityPlan> {
  const sourceRoot = path.resolve(params.sourceRoot);
  const targetRoots = Array.from(
    new Set(params.targetRoots.map((targetRoot) => path.resolve(targetRoot))),
  ).sort((left, right) => left.localeCompare(right));
  const requestedSkillNames = Array.from(new Set(params.skillNames ?? [])).sort((left, right) => left.localeCompare(right));
  const allSourceSkills = await listSkillDirectories(sourceRoot);
  const sourceSkills = requestedSkillNames.length > 0
    ? requestedSkillNames.filter((skillName) => allSourceSkills.includes(skillName))
    : allSourceSkills;
  const targetOnlySkillsByRoot: Record<string, string[]> = {};
  const issues: SkillParityFileIssue[] = [];

  for (const targetRoot of targetRoots) {
    const targetSkills = await listSkillDirectories(targetRoot);
    targetOnlySkillsByRoot[targetRoot] = targetSkills.filter((skillName) => !allSourceSkills.includes(skillName));

    for (const skillName of sourceSkills) {
      const sourceSkillRoot = path.join(sourceRoot, skillName);
      const targetSkillRoot = path.join(targetRoot, skillName);
      const sourceFiles = await listFilesRecursive(sourceSkillRoot);

      for (const relativePath of sourceFiles) {
        const sourcePath = path.join(sourceSkillRoot, relativePath);
        const targetPath = path.join(targetSkillRoot, relativePath);
        let kind: SkillParityIssueKind | undefined;

        try {
          await fs.access(targetPath);
        } catch {
          kind = "missing";
        }

        if (!kind && !(await filesMatch(sourcePath, targetPath))) {
          kind = "outdated";
        }

        if (kind) {
          issues.push({
            targetRoot,
            skillName,
            relativePath: toDisplayPath(relativePath),
            sourcePath,
            targetPath,
            kind,
          });
        }
      }
    }
  }

  issues.sort((left, right) => {
    return (
      left.targetRoot.localeCompare(right.targetRoot) ||
      left.skillName.localeCompare(right.skillName) ||
      left.relativePath.localeCompare(right.relativePath)
    );
  });

  return {
    sourceRoot,
    targetRoots,
    skillFilter: requestedSkillNames,
    sourceSkills,
    targetOnlySkillsByRoot,
    issues,
  };
}

export async function applySkillSurfaceParityPlan(plan: SkillParityPlan): Promise<void> {
  for (const issue of plan.issues) {
    await fs.mkdir(path.dirname(issue.targetPath), { recursive: true });
    await fs.copyFile(issue.sourcePath, issue.targetPath);
  }
}

function countIssuesByKind(plan: SkillParityPlan, kind: SkillParityIssueKind): number {
  return plan.issues.filter((issue) => issue.kind === kind).length;
}

export function formatSkillSurfaceParityReport(
  plan: SkillParityPlan,
  options: { reportOnly: boolean },
): string {
  const lines: string[] = [];
  const modeLabel = options.reportOnly ? "report-only" : "write";
  const missingCount = countIssuesByKind(plan, "missing");
  const outdatedCount = countIssuesByKind(plan, "outdated");

  lines.push(`Skill surface parity (${modeLabel})`);
  lines.push(`Source: ${toDisplayPath(plan.sourceRoot)}`);
  lines.push(`Targets: ${plan.targetRoots.map((targetRoot) => toDisplayPath(targetRoot)).join(", ")}`);
  lines.push(`Source skills in scope: ${plan.sourceSkills.length}`);
  if (plan.skillFilter.length > 0) {
    lines.push(`Requested skill filter: ${plan.skillFilter.join(", ")}`);
  }
  lines.push(`Files needing sync: ${plan.issues.length} (${missingCount} missing, ${outdatedCount} outdated)`);

  for (const targetRoot of plan.targetRoots) {
    const targetOnlySkills = plan.targetOnlySkillsByRoot[targetRoot] ?? [];
    if (targetOnlySkills.length > 0) {
      lines.push(`Target-only skills preserved for ${toDisplayPath(targetRoot)}: ${targetOnlySkills.join(", ")}`);
    }
  }

  if (plan.issues.length === 0) {
    lines.push("No sync needed.");
    return lines.join("\n");
  }

  let currentTargetRoot: string | undefined;
  let currentSkillName: string | undefined;
  for (const issue of plan.issues) {
    if (issue.targetRoot !== currentTargetRoot) {
      currentTargetRoot = issue.targetRoot;
      currentSkillName = undefined;
      lines.push("");
      lines.push(`## ${toDisplayPath(issue.targetRoot)}`);
    }
    if (issue.skillName !== currentSkillName) {
      currentSkillName = issue.skillName;
      lines.push(`- ${issue.skillName}`);
    }
    lines.push(`  - [${issue.kind}] ${issue.relativePath}`);
  }

  return lines.join("\n");
}

function parseArgs(argv: readonly string[]): {
  reportOnly: boolean;
  sourceRoot: string;
  targetRoots: string[];
  skillNames: string[];
  help: boolean;
} {
  let reportOnly = false;
  let help = false;
  let sourceRoot = path.join(process.cwd(), ".pi", "skills");
  const targetRoots: string[] = [];
  const skillNames: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--report-only") {
      reportOnly = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--source-root") {
      sourceRoot = argv[index + 1] ?? sourceRoot;
      index += 1;
      continue;
    }
    if (arg === "--target-root") {
      const targetRoot = argv[index + 1];
      if (!targetRoot) {
        throw new Error("Missing value for --target-root");
      }
      targetRoots.push(targetRoot);
      index += 1;
      continue;
    }
    if (arg === "--skill") {
      const skillName = argv[index + 1];
      if (!skillName) {
        throw new Error("Missing value for --skill");
      }
      skillNames.push(skillName);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    reportOnly,
    sourceRoot,
    targetRoots:
      targetRoots.length > 0
        ? targetRoots
        : [
            path.join(process.cwd(), ".codex", "skills"),
            path.join(process.cwd(), ".claude", "skills"),
            path.join(process.cwd(), ".cursor", "skills"),
            path.join(process.cwd(), ".antigravitycli", "skills"),
          ],
    skillNames,
    help,
  };
}

function usage(): string {
  return [
    "Usage: tsx src/tools/skill-surface-parity/skillSurfaceParityCli.ts [options]",
    "",
    "Options:",
    "  --report-only         Print missing/outdated parity work without writing files.",
    "  --source-root <path>  Override the source skill root (default: .pi/skills).",
    "  --target-root <path>  Add a target skill root (default targets: .codex/skills, .claude/skills, .cursor/skills, .antigravitycli/skills).",
    "  --skill <name>        Limit sync to one skill name; repeatable.",
    "  -h, --help            Show this help.",
  ].join("\n");
}

export async function runSkillSurfaceParityCli(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }

  const plan = await planSkillSurfaceParity({
    sourceRoot: args.sourceRoot,
    targetRoots: args.targetRoots,
    skillNames: args.skillNames,
  });

  console.log(formatSkillSurfaceParityReport(plan, { reportOnly: args.reportOnly }));

  if (!args.reportOnly && plan.issues.length > 0) {
    await applySkillSurfaceParityPlan(plan);
    console.log("");
    console.log(`Applied ${plan.issues.length} file sync operation(s).`);
  }

  return 0;
}

if (require.main === module) {
  runSkillSurfaceParityCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exit(1);
  });
}
