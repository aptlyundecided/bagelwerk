import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type GitWorkspaceProbeResult = {
  isGitWorktree: boolean;
  worktreeRoot?: string;
  gitCommonDir?: string;
  branch?: string;
  isDirty?: boolean;
  errors: string[];
};

export type GitCommandRunner = (args: string[], options: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

export async function probeGitWorkspace(cwd: string, runGitCommand: GitCommandRunner = defaultGitCommandRunner): Promise<GitWorkspaceProbeResult> {
  const errors: string[] = [];
  const inside = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"], runGitCommand, errors);
  if (inside?.trim() !== "true") {
    return { isGitWorktree: false, errors };
  }

  const worktreeRoot = (await runGit(cwd, ["rev-parse", "--show-toplevel"], runGitCommand, errors))?.trim();
  const gitCommonDir = (await runGit(cwd, ["rev-parse", "--git-common-dir"], runGitCommand, errors))?.trim();
  const branch = (await runGit(cwd, ["branch", "--show-current"], runGitCommand, errors))?.trim() || undefined;
  const status = await runGit(cwd, ["status", "--porcelain"], runGitCommand, errors);

  return {
    isGitWorktree: true,
    ...(worktreeRoot ? { worktreeRoot } : {}),
    ...(gitCommonDir ? { gitCommonDir } : {}),
    ...(branch ? { branch } : {}),
    ...(status !== undefined ? { isDirty: status.trim().length > 0 } : {}),
    errors,
  };
}

async function runGit(cwd: string, args: string[], runGitCommand: GitCommandRunner, errors: string[]): Promise<string | undefined> {
  try {
    return (await runGitCommand(args, { cwd })).stdout;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

async function defaultGitCommandRunner(args: string[], options: { cwd: string }): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", args, { cwd: options.cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}
