import assert from "node:assert/strict";
import test from "node:test";

import {
  compileFlowRunnerExecutionPlanRecipe,
  describeFlowRunnerRunProfilePlan,
  resolveFlowRunnerRunProfile,
  type FlowRunnerRunProfile,
} from "./runProfiles";

const profiles: FlowRunnerRunProfile[] = [
  {
    id: "setup",
    label: "Setup",
    plan: { kind: "prefix", stopAfter: "demo.collect" },
  },
  {
    id: "review",
    label: "Review lanes",
    plan: {
      kind: "lanes",
      prefix: { stopAfter: "demo.collect" },
      lanes: [{ flowPath: "demo.left" }, { id: "right-explicit", flowPath: "demo.right" }],
      join: "demo.render",
    },
    outputs: [{ key: "report", from: "demo.render", relativePath: "report.md", kind: "report" }],
  },
];

test("resolveFlowRunnerRunProfile uses explicit id or default id", () => {
  assert.equal(resolveFlowRunnerRunProfile({ profiles, profileId: "setup" }).id, "setup");
  assert.equal(resolveFlowRunnerRunProfile({ profiles, defaultProfileId: "review" }).id, "review");
  assert.throws(
    () => resolveFlowRunnerRunProfile({ profiles, profileId: "missing" }),
    /Unknown Flow Runner profile 'missing'/,
  );
});

test("compileFlowRunnerExecutionPlanRecipe compiles prefix and lane recipes", () => {
  assert.deepEqual(compileFlowRunnerExecutionPlanRecipe({ recipe: profiles[0]!.plan }), { kind: "prefix", stopAfter: "demo.collect" });

  assert.deepEqual(compileFlowRunnerExecutionPlanRecipe({ recipe: profiles[1]!.plan, runPrefix: false }), {
    kind: "lanes",
    prefix: { stopAfter: "demo.collect", run: false },
    lanes: [{ id: "left", flowPath: "demo.left" }, { id: "right-explicit", flowPath: "demo.right" }],
    join: "demo.render",
  });
});

test("describeFlowRunnerRunProfilePlan projects generic plan-only details", () => {
  const profile = profiles[1]!;
  const executionPlan = compileFlowRunnerExecutionPlanRecipe({ recipe: profile.plan });

  assert.deepEqual(describeFlowRunnerRunProfilePlan({ profile, executionPlan }), {
    profileId: "review",
    label: "Review lanes",
    executionPlan,
    lanes: ["demo.left", "demo.right"],
    prefix: { stopAfter: "demo.collect", run: true },
    join: "demo.render",
    outputs: [{ key: "report", from: "demo.render", relativePath: "report.md", kind: "report" }],
  });
});
