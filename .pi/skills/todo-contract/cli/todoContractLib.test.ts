import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalTodoSidecar,
  parseTodoSidecarJson,
  serializeTodoSidecarCanonical,
  validateTodoInternalConsistency,
  type TodoSidecar,
} from "./todoContractLib";

function fixture(tasks: TodoSidecar["tasks"]): TodoSidecar {
  return canonicalTodoSidecar({
    openItem: "OI-9999",
    status: "active",
    generated: "2026-05-29",
    tasks,
    notes: [],
    meta: {},
  });
}

test("todo sidecars preserve optional sparse task order", () => {
  const doc = fixture([
    { id: "T-002", date: "2026-05-29", status: "pending", task: "Later", notes: "" },
    { id: "T-001", date: "2026-05-29", order: 10000, status: "pending", task: "First", notes: "" },
  ]);

  assert.deepEqual(doc.tasks.map((task) => task.id), ["T-001", "T-002"]);
  assert.equal(doc.tasks[0]?.order, 10000);
  assert.equal(doc.tasks[1]?.order, undefined);

  const serialized = serializeTodoSidecarCanonical(doc);
  assert.match(serialized, /"order": 10000/);
  const parsed = parseTodoSidecarJson(serialized);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.equal(parsed.doc.tasks[0]?.order, 10000);
});

test("todo validation rejects duplicate task order values", () => {
  const doc = fixture([
    { id: "T-001", date: "2026-05-29", order: 10000, status: "pending", task: "A", notes: "" },
    { id: "T-002", date: "2026-05-29", order: 10000, status: "pending", task: "B", notes: "" },
  ]);

  assert.deepEqual(validateTodoInternalConsistency(doc), [
    { level: "error", path: "OI-9999", message: "Duplicate task order values" },
  ]);
});

test("todo parser rejects non-positive task order", () => {
  const parsed = parseTodoSidecarJson(JSON.stringify({
    openItem: "OI-9999",
    status: "active",
    generated: "2026-05-29",
    tasks: [
      { id: "T-001", date: "2026-05-29", order: 0, status: "pending", task: "Bad", notes: "" },
    ],
    notes: [],
    meta: {},
  }));

  assert.equal(parsed.ok, false);
});
