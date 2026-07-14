import React, { useEffect } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

export function renderPlatformTourPresenterView(props) {
  return render(React.createElement(PlatformTourPresenterView, props), {
    stdout: process.stderr,
    stderr: process.stderr,
    stdin: process.stdin,
    interactive: true,
  });
}

export function rerenderPlatformTourPresenterView(app, props) {
  app.rerender(React.createElement(PlatformTourPresenterView, props));
}

function statusIcon(status) {
  if (status === "completed") return "✓";
  if (status === "running") return "…";
  if (status === "failed") return "✕";
  return "○";
}

function statusColor(status) {
  if (status === "completed") return "green";
  if (status === "running") return "yellow";
  if (status === "failed") return "red";
  return "gray";
}

function PlatformTourPresenterView(props) {
  const { exit } = useApp();
  const snapshot = props.store.getSnapshot();
  const step = snapshot.step;
  const meta = snapshot.metadata ?? {};
  const width = clamp((process.stderr.columns ?? 100) - 2, 70, 110);

  useEffect(() => {
    if (snapshot.closed && snapshot.finished === "quit") {
      const timeout = setTimeout(() => exit(), 50);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [exit, snapshot.closed, snapshot.finished]);

  useInput((value, key) => {
    const current = props.store.getSnapshot();
    if (current.closed) {
      if (value === "o" && current.svgPath && props.openFile) props.openFile(current.svgPath);
      else if (value === "q" || key.return) exit();
      return;
    }
    if (!current.awaiting) return;
    if (value === "q") props.store.resolveAction("quit");
    else if (value === "a") props.store.resolveAction("auto");
    else if (key.return || value === " ") props.store.resolveAction("advance");
  }, { isActive: true });

  const beats = step?.beatStatuses ?? [];
  const total = step?.total ?? beats.length;
  const activeIndex = step?.index ?? 0;
  const beat = step?.beat;
  const phase = step?.phase ?? "running";
  const result = step?.lastResult;

  const header = React.createElement(Box, { justifyContent: "space-between" },
    React.createElement(Text, { bold: true, color: "cyan" }, truncate(meta.title ?? "Bagelwerk Platform Tour", width - 16)),
    React.createElement(Text, { color: "gray" }, step ? `step ${Math.min(activeIndex + 1, total)}/${total}` : ""),
  );

  const stepList = React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1 },
    React.createElement(Text, { bold: true, color: "cyan" }, "Steps"),
    ...beats.map((entry, index) => React.createElement(Text, {
      key: entry.id,
      color: index === activeIndex && !snapshot.closed ? "yellow" : statusColor(entry.status),
    }, truncate(`${statusIcon(entry.status)} ${index + 1}. ${entry.title}`, width - 6))),
  );

  const narration = beat ? React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: snapshot.closed ? "green" : "cyan", paddingX: 1 },
    React.createElement(Text, { bold: true }, truncate(beat.title, width - 6)),
    ...bulletBlock("What this does", beat.whatHappens, width),
    ...bulletBlock("Why it matters", beat.whyItMatters, width),
    ...(phase === "running" ? [runningLine(snapshot, step)] : []),
    ...(phase === "after" && result ? resultBlock(result, beat, width) : []),
  ) : null;

  const done = snapshot.closed && snapshot.finished === "completed" ? React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: "green", paddingX: 1 },
    React.createElement(Text, { bold: true, color: "green" }, "Tour complete — small jobs, clear handoffs, durable files."),
    ...(step?.finalTargets ?? []).map((target, index) => React.createElement(Text, { key: index, color: "gray" }, truncate(`• ${target.label}: ${target.path}`, width - 4))),
  ) : null;

  return React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: snapshot.closed ? "green" : "cyan", paddingX: 1, width },
    header,
    meta.sessionId ? React.createElement(Text, { color: "gray" }, truncate(`session ${meta.sessionId}`, width - 4)) : null,
    stepList,
    narration,
    done,
    React.createElement(Text, { color: "gray" }, footer(snapshot, phase)),
  );
}

function resultBlock(result, beat, width) {
  const lines = [
    React.createElement(Text, { key: "status", color: result.status === "completed" ? "green" : "red" },
      result.status === "completed" ? "✓ step finished" : `✕ step ${result.status}${result.note ? `: ${result.note}` : ""}`),
  ];
  if (result.artifacts.length === 0) {
    lines.push(React.createElement(Text, { key: "noart", color: "gray" }, "  (no files for this step)"));
  } else {
    for (const artifact of result.artifacts) {
      lines.push(React.createElement(Text, { key: `a-${artifact.relativePath}`, color: artifact.exists ? "green" : "yellow" },
        truncate(`  ${artifact.exists ? "✓" : "!"} ${artifact.label} — ${artifact.relativePath}`, width - 6)));
    }
  }
  for (const [index, takeaway] of (beat.postRunTakeaways ?? []).entries()) {
    lines.push(React.createElement(Text, { key: `t-${index}`, color: "white" }, truncate(`  → ${takeaway}`, width - 6)));
  }
  return lines;
}

function runningLine(snapshot, step) {
  if (step && step.runningMs && snapshot.runStartedAt) {
    const remaining = Math.max(0, step.runningMs - (Date.now() - snapshot.runStartedAt));
    return React.createElement(Text, { key: "running", color: "yellow" }, `⏳ running… ${(remaining / 1000).toFixed(1)}s`);
  }
  return React.createElement(Text, { key: "running", color: "yellow" }, "⏳ working…");
}

function bulletBlock(title, bullets, width) {
  if (!bullets || bullets.length === 0) return [];
  return [
    React.createElement(Text, { key: `${title}-h`, color: "cyan" }, `${title}:`),
    ...bullets.map((bullet, index) => React.createElement(Text, { key: `${title}-${index}` }, truncate(`  • ${bullet}`, width - 6))),
  ];
}

function footer(snapshot, phase) {
  if (snapshot.closed && snapshot.finished === "completed") return "o = open SVG   ·   Enter/q = exit";
  if (snapshot.closed) return "exiting…";
  if (!snapshot.awaiting) return "running this step…";
  return "Enter = next step   ·   a = auto-run the rest   ·   q = quit";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}
