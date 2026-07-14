import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { GitCommandRunner } from "./gitWorkspaceProbe";
import { validateTargetWorkspace } from "./targetWorkspaceGuard";

test("validateTargetWorkspace accepts an isolated clean non-protected worktree", async () => {
  const targetRoot = path.resolve("/repo/worktrees/feature-a");
  const controllerRoot = path.resolve("/repo/main");
  const runGitCommand = fakeGitRunner({ targetRoot, controllerRoot, targetBranch: "feature/flow-supervisor" });

  const report = await validateTargetWorkspace({
    targetWorkspace: targetRoot,
    cwd: targetRoot,
    controllerWorkspace: controllerRoot,
    runGitCommand,
  });

  assert.equal(report.ok, true);
  assert.equal(report.isGitWorktree, true);
  assert.equal(report.isIsolatedWorktree, true);
  assert.equal(report.branch, "feature/flow-supervisor");
  assert.deepEqual(report.issues, []);
});

test("validateTargetWorkspace rejects the controller checkout when isolation is required", async () => {
  const controllerRoot = path.resolve("/repo/main");
  const runGitCommand = fakeGitRunner({ targetRoot: controllerRoot, controllerRoot, targetBranch: "feature/flow-supervisor" });

  const report = await validateTargetWorkspace({
    targetWorkspace: controllerRoot,
    controllerWorkspace: controllerRoot,
    runGitCommand,
  });

  assert.equal(report.ok, false);
  assert.equal(report.isIsolatedWorktree, false);
  assert.ok(report.issues.some((issue) => issue.code === "not_isolated_worktree"));
});

test("validateTargetWorkspace reports protected branch, dirty worktree, and cwd outside target", async () => {
  const targetRoot = path.resolve("/repo/worktrees/mainish");
  const controllerRoot = path.resolve("/repo/main");
  const outsideCwd = path.resolve("/repo/other-flow-workspace");
  const runGitCommand = fakeGitRunner({ targetRoot, controllerRoot, targetBranch: "main", dirty: true });

  const report = await validateTargetWorkspace({
    targetWorkspace: targetRoot,
    cwd: outsideCwd,
    controllerWorkspace: controllerRoot,
    runGitCommand,
  });

  assert.equal(report.ok, false);
  assert.deepEqual(report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code), [
    "protected_branch",
    "dirty_worktree",
    "cwd_outside_target_workspace",
  ]);
});

test("allowCwdOutsideWorktree lets a Flow load from a cwd fully outside the target repo", async () => {
  const targetRoot = path.resolve("/repo/worktrees/night-shift-run");
  const controllerRoot = path.resolve("/repo/main");
  const outsideCwd = path.resolve("/elsewhere/flow-workspace"); // not a git worktree of the target
  const runGitCommand = fakeGitRunner({ targetRoot, controllerRoot, targetBranch: "night-shift/run-1" });

  const allowed = await validateTargetWorkspace({
    targetWorkspace: targetRoot,
    cwd: outsideCwd,
    controllerWorkspace: controllerRoot,
    runGitCommand,
    policy: { allowCwdOutsideWorktree: true },
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.issues, []);
});

test("allowCwdOutsideWorktree still rejects a cwd that belongs to the target's own repository", async () => {
  const targetRoot = path.resolve("/repo/worktrees/night-shift-run");
  const controllerRoot = path.resolve("/repo/main"); // shares the target repo's git-common-dir
  const runGitCommand = fakeGitRunner({ targetRoot, controllerRoot, targetBranch: "night-shift/run-1" });

  // cwd points at the target repo's main checkout — the footgun the flag must NOT open.
  const report = await validateTargetWorkspace({
    targetWorkspace: targetRoot,
    cwd: controllerRoot,
    controllerWorkspace: controllerRoot,
    runGitCommand,
    policy: { allowCwdOutsideWorktree: true },
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "cwd_in_target_repository"));
});

test("allowCwdOutsideWorktree does not relax the isolated-worktree requirement", async () => {
  const controllerRoot = path.resolve("/repo/main");
  const runGitCommand = fakeGitRunner({ targetRoot: controllerRoot, controllerRoot, targetBranch: "feature/x" });

  // Target IS the controller checkout (not isolated) — must still be rejected with the flag on.
  const report = await validateTargetWorkspace({
    targetWorkspace: controllerRoot,
    controllerWorkspace: controllerRoot,
    runGitCommand,
    policy: { allowCwdOutsideWorktree: true },
  });
  assert.equal(report.ok, false);
  assert.ok(report.issues.some((issue) => issue.code === "not_isolated_worktree"));
});

type FakeGitRunnerOptions = {
  targetRoot: string;
  controllerRoot: string;
  targetBranch: string;
  dirty?: boolean;
};

function fakeGitRunner(options: FakeGitRunnerOptions): GitCommandRunner {
  return async (args, commandOptions) => {
    const command = args.join(" ");
    const worktreeRoot = rootForCwd(commandOptions.cwd, options);
    if (!worktreeRoot) throw new Error(`not a git worktree: ${commandOptions.cwd}`);

    if (command === "rev-parse --is-inside-work-tree") return { stdout: "true\n", stderr: "" };
    if (command === "rev-parse --show-toplevel") return { stdout: `${worktreeRoot}\n`, stderr: "" };
    if (command === "rev-parse --git-common-dir") return { stdout: path.join(options.controllerRoot, ".git"), stderr: "" };
    if (command === "branch --show-current") return { stdout: `${worktreeRoot === options.targetRoot ? options.targetBranch : "main"}\n`, stderr: "" };
    if (command === "status --porcelain") return { stdout: worktreeRoot === options.targetRoot && options.dirty ? " M file.ts\n" : "", stderr: "" };
    throw new Error(`unexpected git command: ${command}`);
  };
}

function rootForCwd(cwd: string, options: FakeGitRunnerOptions): string | undefined {
  const resolved = path.resolve(cwd);
  if (isPathInside(resolved, options.targetRoot)) return options.targetRoot;
  if (isPathInside(resolved, options.controllerRoot)) return options.controllerRoot;
  return undefined;
}

function isPathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
