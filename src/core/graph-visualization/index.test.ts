import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderMermaidSvg, type MermaidCommandInvocation } from ".";

async function tempDir(name: string): Promise<string> {
  const dir = path.join(os.tmpdir(), `flowzone-graph-visualization-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

test("renderMermaidSvg writes Mermaid source, invokes mmdc, and returns SVG paths", async () => {
  const outputDirectory = await tempDir("success");
  const invocations: MermaidCommandInvocation[] = [];

  try {
    const result = await renderMermaidSvg(
      {
        mermaidSource: "flowchart TD\n  A --> B\n",
        outputDirectory,
        baseName: "demo-flow",
      },
      {
        cwd: "C:/workspace",
        env: { PATH: "fake" },
        runCommand: async (invocation) => {
          invocations.push(invocation);
          await writeFile(invocation.args[3], "<svg><text>demo</text></svg>", "utf8");
          return { exitCode: 0, signal: null, stdout: "rendered", stderr: "" };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.command, "mmdc");
    assert.deepEqual(result.args, ["-i", result.mermaidPath, "-o", result.svgPath]);
    assert.equal(result.stdout, "rendered");
    assert.equal(result.stderr, "");
    assert.equal(result.errorMessage, undefined);
    assert.equal(await readFile(result.mermaidPath, "utf8"), "flowchart TD\n  A --> B\n");
    assert.equal(await readFile(result.svgPath, "utf8"), "<svg><text>demo</text></svg>");
    assert.equal(invocations.length, 1);
    assert.equal(invocations[0].timeoutMs, 30_000);
    assert.equal(invocations[0].cwd, path.resolve("C:/workspace"));
    assert.equal(invocations[0].env.PATH, "fake");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("renderMermaidSvg creates nested output directories and honors command options", async () => {
  const root = await tempDir("nested");
  const outputDirectory = path.join(root, "nested", "graphs");

  try {
    const result = await renderMermaidSvg(
      {
        mermaidSource: "flowchart LR\n  left --> right\n",
        outputDirectory,
        baseName: "graph.v1",
        mmdcCommand: "custom-mmdc",
        timeoutMs: 12_345,
        additionalArgs: ["--theme", "dark"],
      },
      {
        runCommand: async (invocation) => {
          await writeFile(invocation.args[3], "<svg></svg>", "utf8");
          assert.equal(invocation.command, "custom-mmdc");
          assert.equal(invocation.timeoutMs, 12_345);
          assert.deepEqual(invocation.args.slice(4), ["--theme", "dark"]);
          return { exitCode: 0, signal: null, stdout: "", stderr: "" };
        },
      },
    );

    assert.equal(result.ok, true);
    assert.equal(result.mermaidPath, path.join(outputDirectory, "graph.v1.mmd"));
    assert.equal(result.svgPath, path.join(outputDirectory, "graph.v1.svg"));
    assert.equal(await readFile(result.mermaidPath, "utf8"), "flowchart LR\n  left --> right\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("renderMermaidSvg returns mmdc failure diagnostics", async () => {
  const outputDirectory = await tempDir("failure");

  try {
    const result = await renderMermaidSvg(
      {
        mermaidSource: "not valid mermaid",
        outputDirectory,
        baseName: "bad-graph",
      },
      {
        runCommand: async () => ({ exitCode: 1, signal: null, stdout: "", stderr: "parse error" }),
      },
    );

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.stderr, "parse error");
    assert.equal(result.errorMessage, "mmdc exited with code 1");
    assert.equal(await readFile(result.mermaidPath, "utf8"), "not valid mermaid");
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("renderMermaidSvg reports a successful command that did not create SVG", async () => {
  const outputDirectory = await tempDir("missing-svg");

  try {
    const result = await renderMermaidSvg(
      {
        mermaidSource: "flowchart TD\n  A --> B\n",
        outputDirectory,
        baseName: "missing-svg",
      },
      {
        runCommand: async () => ({ exitCode: 0, signal: null, stdout: "", stderr: "" }),
      },
    );

    assert.equal(result.ok, false);
    assert.match(result.errorMessage ?? "", /did not create SVG output/);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("renderMermaidSvg validates unsafe base names before writing", async () => {
  const outputDirectory = await tempDir("unsafe");

  try {
    await assert.rejects(
      () => renderMermaidSvg({ mermaidSource: "flowchart TD\n  A --> B\n", outputDirectory, baseName: "../escape" }),
      /baseName must contain only/,
    );
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});
