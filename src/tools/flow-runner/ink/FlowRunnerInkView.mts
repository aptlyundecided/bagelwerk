import path from "node:path";
import React, { useEffect, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";

export function renderFlowRunnerInkView(props) {
  return render(React.createElement(FlowRunnerInkView, props), {
    stdout: process.stderr,
    stderr: process.stderr,
    stdin: process.stdin,
    interactive: true,
  });
}

export function rerenderFlowRunnerInkView(app, props) {
  app.rerender(React.createElement(FlowRunnerInkView, props));
}

function FlowRunnerInkView(props) {
  const { exit } = useApp();
  const [nodeOffset, setNodeOffset] = useState(0);
  const [follow, setFollow] = useState(true);
  const snapshot = props.store.getSnapshot();
  const state = snapshot.state;
  const title = state.title ?? state.flowName ?? state.flowId ?? "Flow Runner";
  const statusColor = statusToColor(state.status);
  const nodes = state.nodeOrder.map((nodePath) => state.nodes[nodePath]).filter(Boolean);
  const terminalRows = process.stderr.rows ?? process.stdout.rows ?? 36;
  const terminalColumns = process.stderr.columns ?? process.stdout.columns ?? 122;
  const rootHeight = clamp(terminalRows - 1, 24, 46);
  const rootWidth = clamp(terminalColumns - 2, 82, 132);
  const laneRows = state.laneOrder.length ? Math.min(4, state.laneOrder.length) : 0;
  const failureRows = state.failures.length ? 3 : 0;
  const artifactRows = state.artifacts.length ? 3 : 0;
  const recentRows = 5;
  const nodeRows = clamp(rootHeight - 15 - laneRows - failureRows - artifactRows - recentRows, 6, 18);
  const nodeDisplayRows = buildNodeDisplayRows(nodes, state);
  const activeNodeIndex = activeIndex(nodes);
  const activeNodePath = nodes[activeNodeIndex]?.qualifiedNodePath;
  const activeRowIndex = Math.max(0, nodeDisplayRows.findIndex((row) => row.kind === "node" && row.node.qualifiedNodePath === activeNodePath));
  const maxNodeOffset = Math.max(0, nodeDisplayRows.length - nodeRows);
  const effectiveNodeOffset = follow
    ? clamp(activeRowIndex - Math.floor(nodeRows / 2), 0, maxNodeOffset)
    : clamp(nodeOffset, 0, maxNodeOffset);
  const visibleNodeRows = nodeDisplayRows.slice(effectiveNodeOffset, effectiveNodeOffset + nodeRows);
  const artifactRoot = state.artifactRoot ?? state.runDir ? path.normalize(state.artifactRoot ?? state.runDir ?? "") : undefined;

  useEffect(() => {
    if (!props.autoExit) return undefined;
    const status = snapshot.state.status;
    if (snapshot.state.closed && status !== "running" && status !== "pending") {
      const timeout = setTimeout(() => exit(), 1200);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [exit, props.autoExit, snapshot.state.closed, snapshot.state.status]);

  useInput((value, key) => {
    if (value === "q") exit();
    if (key.return && snapshot.state.closed) exit();
    if (value === "f" || key.end) {
      setFollow(true);
      setNodeOffset(maxNodeOffset);
      return;
    }
    if (key.upArrow) {
      setFollow(false);
      setNodeOffset((current) => clamp(current - 1, 0, maxNodeOffset));
      return;
    }
    if (key.downArrow) {
      setFollow(false);
      setNodeOffset((current) => clamp(current + 1, 0, maxNodeOffset));
      return;
    }
    if (key.pageUp) {
      setFollow(false);
      setNodeOffset((current) => clamp(current - nodeRows, 0, maxNodeOffset));
      return;
    }
    if (key.pageDown) {
      setFollow(false);
      setNodeOffset((current) => clamp(current + nodeRows, 0, maxNodeOffset));
      return;
    }
    if (key.home) {
      setFollow(false);
      setNodeOffset(0);
    }
  }, { isActive: true });

  return React.createElement(Box, { flexDirection: "column", borderStyle: "round", borderColor: statusColor, paddingX: 1, paddingY: 0, width: rootWidth, height: rootHeight },
    React.createElement(Box, { justifyContent: "space-between" },
      React.createElement(Text, { bold: true, color: "cyan" }, truncate(title, rootWidth - 24)),
      React.createElement(Text, { color: statusColor }, state.status),
    ),
    state.flowId ? React.createElement(Text, null, `Flow: ${truncate(state.flowId, rootWidth - 10)}`) : null,
    state.sessionId ? React.createElement(Text, { color: "gray" }, `Session: ${truncate(state.sessionId, rootWidth - 13)}`) : null,
    artifactRoot ? React.createElement(Text, { color: "gray" }, `Artifacts: ${truncate(artifactRoot, rootWidth - 15)}`) : null,
    React.createElement(PlanPanel, { state, width: rootWidth }),
    state.laneOrder.length ? React.createElement(LanePanel, { state, rows: laneRows, width: rootWidth }) : null,
    React.createElement(NodeViewportPanel, {
      displayRows: visibleNodeRows,
      total: nodeDisplayRows.length,
      offset: effectiveNodeOffset,
      rows: nodeRows,
      follow,
      activeNodePath,
      width: rootWidth,
    }),
    state.failures.length ? React.createElement(FailurePanel, { state, rows: failureRows, width: rootWidth }) : null,
    state.artifacts.length ? React.createElement(ArtifactPanel, { state, rows: artifactRows, width: rootWidth }) : null,
    React.createElement(RecentPanel, { state, rows: recentRows, width: rootWidth }),
    React.createElement(Text, { color: "gray" }, state.closed ? "Closed. Enter exits. ↑/↓ scroll nodes, f/End follow." : "↑/↓ PgUp/PgDn scroll nodes, f/End follow, q quit."),
  );
}

function PlanPanel(props) {
  const plan = props.state.executionPlan;
  let line = `Mode: ${props.state.mode ?? "pending"}`;
  if (plan?.kind === "prefix") line = `Plan: prefix until ${plan.stopAfter}`;
  else if (plan?.kind === "lanes") {
    const prefix = plan.prefix ? ` prefix=${plan.prefix.run === false ? "skip" : "run"}:${plan.prefix.stopAfter}` : "";
    const join = plan.join ? ` join=${plan.join}` : "";
    line = `Plan: lanes (${plan.lanes.length})${prefix}${join}`;
  } else if (plan) line = "Plan: whole flow";
  return React.createElement(Text, { color: "gray" }, truncate(line, props.width - 6));
}

function LanePanel(props) {
  const lanes = props.state.laneOrder.map((laneId) => props.state.lanes[laneId]).filter(Boolean).slice(0, props.rows);
  const hidden = Math.max(0, props.state.laneOrder.length - lanes.length);
  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1, height: props.rows + 2 },
    React.createElement(Text, { bold: true, color: "cyan" }, `Lanes${hidden ? ` (+${hidden})` : ""}`),
    ...lanes.map((lane) => React.createElement(Text, { key: lane.laneId, color: statusToColor(lane.status) }, truncate(`${statusIcon(lane.status)} ${lane.laneId} — ${lane.flowPath}`, props.width - 8))),
  );
}

function NodeViewportPanel(props) {
  const end = Math.min(props.total, props.offset + props.rows);
  const range = props.total ? `${props.offset + 1}-${end}/${props.total}` : "0/0";
  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1, height: props.rows + 2 },
    React.createElement(Text, { bold: true, color: "cyan" }, `Node graph ${range} ${props.follow ? "follow" : "manual"}`),
    ...(props.displayRows.length
      ? props.displayRows.map((row) => renderNodeDisplayRow(row, props))
      : [React.createElement(Text, { key: "empty", color: "gray" }, "No Nodes observed yet.")]),
    ...Array.from({ length: Math.max(0, props.rows - props.displayRows.length) }, (_, index) => React.createElement(Text, { key: `pad-${index}` }, "")),
  );
}

function FailurePanel(props) {
  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "red", paddingX: 1, height: props.rows + 2 },
    React.createElement(Text, { bold: true, color: "red" }, "Failures / recovery"),
    ...props.state.failures.slice(-props.rows).map((failure, index) => React.createElement(Text, { key: `${failure.qualifiedNodePath}-${index}`, color: failure.disposition === "recovered" ? "green" : "red" }, truncate(`${failure.qualifiedNodePath} status=${failure.status}${failure.disposition ? ` disposition=${failure.disposition}` : ""}${failure.note ? ` note=${failure.note}` : ""}`, props.width - 8))),
  );
}

function ArtifactPanel(props) {
  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1, height: props.rows + 2 },
    React.createElement(Text, { bold: true, color: "cyan" }, "Artifacts"),
    ...props.state.artifacts.slice(-props.rows).map((artifact, index) => React.createElement(Text, { key: `${artifact.canonicalPath}-${index}`, color: artifact.exists ? "green" : "yellow" }, truncate(`${artifact.exists ? "✓" : "?"} ${artifact.qualifiedNodePath}/${artifact.relativePath}`, props.width - 8))),
  );
}

function RecentPanel(props) {
  const recent = props.state.recent.slice(0, props.rows);
  return React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "gray", paddingX: 1, height: props.rows + 2 },
    React.createElement(Text, { bold: true, color: "cyan" }, "Recent"),
    ...(recent.length
      ? recent.map((event, index) => React.createElement(Text, { key: `${event.at}-${index}`, color: severityToColor(event.severity) }, truncate(event.label, props.width - 8)))
      : [React.createElement(Text, { key: "empty", color: "gray" }, "Waiting for events…")]),
    ...Array.from({ length: Math.max(0, props.rows - recent.length) }, (_, index) => React.createElement(Text, { key: `pad-${index}` }, "")),
  );
}

function renderNodeDisplayRow(row, props) {
  if (row.kind === "section") {
    return React.createElement(Text, { key: row.key, color: "cyan", bold: true }, truncate(`▸ ${row.label}`, props.width - 8));
  }
  const node = row.node;
  const isActive = node.qualifiedNodePath === props.activeNodePath;
  const indent = node.group ? "  " : "";
  return React.createElement(Text, { key: node.qualifiedNodePath, color: isActive ? "yellow" : statusToColor(node.status) }, truncate(`${indent}${statusIcon(node.status)} ${node.qualifiedNodePath}${formatNodeProgress(node)}`, props.width - 8));
}

function buildNodeDisplayRows(nodes, state) {
  const rows = [];
  let currentSection;
  for (const node of nodes) {
    const section = sectionForNode(node, state);
    if (section.key !== currentSection) {
      rows.push({ kind: "section", key: `section:${section.key}`, label: section.label });
      currentSection = section.key;
    }
    rows.push({ kind: "node", node });
  }
  return rows;
}

function sectionForNode(node, state) {
  if (node.group === "prefix") return { key: "prefix", label: "Setup / prefix" };
  if (node.group === "join") return { key: "join", label: "Join / finalization" };
  if (node.group === "lane") {
    const lane = node.laneId ? state.lanes[node.laneId] : undefined;
    const label = lane ? `Lane: ${node.laneId} — ${lane.flowPath}` : `Lane: ${node.laneId ?? node.flowPath ?? "unknown"}`;
    return { key: `lane:${node.laneId ?? node.flowPath ?? "unknown"}`, label };
  }
  return { key: `flow:${node.flowPath ?? "root"}`, label: node.flowPath ? `Flow: ${node.flowPath}` : "Flow nodes" };
}

function activeIndex(nodes) {
  const running = nodes.findIndex((node) => node.status === "running");
  if (running >= 0) return running;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (nodes[index]?.status !== "pending") return index;
  }
  return 0;
}

function statusIcon(status) {
  if (status === "completed") return "✓";
  if (status === "running") return "…";
  if (status === "failed" || status === "timed_out" || status === "unknown") return "✕";
  if (status === "skipped") return "◌";
  return "○";
}

function statusToColor(status) {
  if (status === "completed") return "green";
  if (status === "failed" || status === "timed_out" || status === "unknown") return "red";
  if (status === "running") return "yellow";
  return "gray";
}

function severityToColor(severity) {
  if (severity === "success") return "green";
  if (severity === "warning") return "yellow";
  if (severity === "error") return "red";
  return "gray";
}

function formatNodeProgress(node) {
  const progress = node.progress;
  if (!progress) return "";
  if (progress.kind === "message") return progress.message ? ` — ${progress.message}` : "";
  const total = progress.total ?? 0;
  const completed = progress.completed ?? 0;
  const failed = progress.failed ?? 0;
  const running = progress.running ?? 0;
  const failedSuffix = failed > 0 ? ` failed ${failed}` : "";
  const runningSuffix = running > 0 ? ` running ${running}` : "";
  return ` — ${completed}/${total}${failedSuffix}${runningSuffix}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return "…";
  return `${value.slice(0, maxLength - 1)}…`;
}
