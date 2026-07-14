import { realpath } from "node:fs/promises";
import path from "node:path";

import type { FlowSupervisorWorkspaceIssue, FlowSupervisorWorkspacePolicy, FlowSupervisorWorkspaceReport } from "../types";
import { DEFAULT_FLOW_SUPERVISOR_POLICY } from "../policy/supervisorPolicy";
import { probeGitWorkspace, type GitCommandRunner, type GitWorkspaceProbeResult } from "./gitWorkspaceProbe";

export type ValidateTargetWorkspaceParams = {
  targetWorkspace: string;
  cwd?: string;
  controllerWorkspace?: string;
  policy?: Partial<FlowSupervisorWorkspacePolicy>;
  runGitCommand?: GitCommandRunner;
};

export async function validateTargetWorkspace(params: ValidateTargetWorkspaceParams): Promise<FlowSupervisorWorkspaceReport> {
  const policy: FlowSupervisorWorkspacePolicy = {
    ...DEFAULT_FLOW_SUPERVISOR_POLICY.workspace,
    ...params.policy,
  };
  const targetWorkspace = path.resolve(params.targetWorkspace);
  const targetProbe = await probeGitWorkspace(targetWorkspace, params.runGitCommand);
  const controllerProbe = params.controllerWorkspace
    ? await probeGitWorkspace(path.resolve(params.controllerWorkspace), params.runGitCommand)
    : await probeGitWorkspace(process.cwd(), params.runGitCommand);
  const issues: FlowSupervisorWorkspaceIssue[] = [];

  if (!targetProbe.isGitWorktree) {
    issues.push(error("not_git_worktree", `Target workspace is not inside a git worktree: ${targetWorkspace}`));
  }

  const isIsolatedWorktree = await computeIsIsolatedWorktree(targetProbe, controllerProbe);
  if (policy.requireIsolatedWorktree && !isIsolatedWorktree) {
    issues.push(error("not_isolated_worktree", "Target workspace resolves to the controller checkout; supervised runs require an isolated worktree by default."));
  }

  if (targetProbe.branch && policy.forbiddenBranches.includes(targetProbe.branch) && !policy.allowMainWorktreeOverride) {
    issues.push(error("protected_branch", `Target workspace is on protected branch '${targetProbe.branch}'.`));
  }

  if (targetProbe.isDirty === true && !policy.allowDirtyWorktree) {
    issues.push(error("dirty_worktree", "Target workspace has uncommitted changes and dirty worktrees are not allowed by policy."));
  }

  const cwd = params.cwd ? path.resolve(params.cwd) : undefined;
  if (cwd && targetProbe.worktreeRoot) {
    const canonicalCwd = await canonicalPath(cwd);
    const canonicalWorktreeRoot = await canonicalPath(targetProbe.worktreeRoot);
    if (!isPathInside(canonicalCwd, canonicalWorktreeRoot)) {
      if (!policy.allowCwdOutsideWorktree) {
        issues.push(error("cwd_outside_target_workspace", `Flow cwd '${cwd}' is outside target worktree '${targetProbe.worktreeRoot}'.`));
      } else if (targetProbe.gitCommonDir) {
        // The flag permits a cwd outside the target worktree (e.g. a generic Flow loading its
        // config from a neutral location), but it must NOT resolve into the target's OWN
        // repository — a sibling worktree/main checkout of the target repo — or a Node running
        // git against cwd could read/commit into a protected checkout of the target repo.
        const cwdProbe = await probeGitWorkspace(cwd, params.runGitCommand);
        if (
          cwdProbe.gitCommonDir &&
          (await canonicalPath(cwdProbe.gitCommonDir)) === (await canonicalPath(targetProbe.gitCommonDir))
        ) {
          issues.push(error(
            "cwd_in_target_repository",
            `Flow cwd '${cwd}' is a different worktree of the target repository; it must be fully outside the target repo.`,
          ));
        }
      }
    }
  }

  for (const probeError of targetProbe.errors) {
    issues.push(warning("git_probe_warning", probeError));
  }

  return {
    targetWorkspace,
    ok: issues.every((issue) => issue.severity !== "error"),
    isGitWorktree: targetProbe.isGitWorktree,
    isIsolatedWorktree,
    ...(targetProbe.branch ? { branch: targetProbe.branch } : {}),
    ...(targetProbe.isDirty !== undefined ? { isDirty: targetProbe.isDirty } : {}),
    issues,
  };
}

async function computeIsIsolatedWorktree(targetProbe: GitWorkspaceProbeResult, controllerProbe: GitWorkspaceProbeResult): Promise<boolean> {
  if (!targetProbe.worktreeRoot) return false;
  if (!controllerProbe.worktreeRoot) return true;
  return await canonicalPath(targetProbe.worktreeRoot) !== await canonicalPath(controllerProbe.worktreeRoot);
}

async function canonicalPath(filePath: string): Promise<string> {
  try {
    return path.resolve(await realpath(filePath));
  } catch {
    return path.resolve(filePath);
  }
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function error(code: string, message: string): FlowSupervisorWorkspaceIssue {
  return { severity: "error", code, message };
}

function warning(code: string, message: string): FlowSupervisorWorkspaceIssue {
  return { severity: "warning", code, message };
}
