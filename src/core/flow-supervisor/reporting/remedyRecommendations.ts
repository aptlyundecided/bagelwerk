import type { FlowSupervisorFragilitySignal, FlowSupervisorRemedyRecommendation, FlowSupervisorRunMetrics } from "../types";

export function recommendFlowSupervisorRemedies(args: {
  metrics: FlowSupervisorRunMetrics;
  signals: FlowSupervisorFragilitySignal[];
}): FlowSupervisorRemedyRecommendation[] {
  const recommendations = new Map<string, FlowSupervisorRemedyRecommendation>();

  for (const signal of args.signals) {
    switch (signal.code) {
      case "long_silence":
        add(recommendations, {
          code: recommendationKey("add_node_progress", signal.qualifiedNodePath),
          title: "Add Node progress events",
          detail: "This Node had a long silence window. Emit node-progress events around expensive loops, model calls, or command phases so operators can distinguish slow from stalled.",
          ...(signal.qualifiedNodePath ? { qualifiedNodePath: signal.qualifiedNodePath } : {}),
        });
        break;
      case "slow_node":
        add(recommendations, {
          code: recommendationKey("split_or_parallelize_slow_node", signal.qualifiedNodePath),
          title: "Split or parallelize slow Node work",
          detail: "This Node exceeded expected runtime. Consider smaller batches, a queue processor Flow, bounded lanes, or separating deterministic setup from expensive agent work.",
          ...(signal.qualifiedNodePath ? { qualifiedNodePath: signal.qualifiedNodePath } : {}),
        });
        break;
      case "retry_heavy_node":
        add(recommendations, {
          code: recommendationKey("tighten_node_retry_contract", signal.qualifiedNodePath),
          title: "Tighten retry-prone Node contract",
          detail: "This Node emitted retry signals. Strengthen schema validation, prompt instructions, retry context, or deterministic prechecks instead of relying on repeated reruns.",
          ...(signal.qualifiedNodePath ? { qualifiedNodePath: signal.qualifiedNodePath } : {}),
        });
        break;
      case "retry_heavy_run":
        add(recommendations, {
          code: "audit_run_retry_sources",
          title: "Audit run retry sources",
          detail: "The run emitted retry signals. Inspect per-Node retry counts and reduce the underlying contract/provider fragility before raising retry budgets.",
        });
        break;
      case "missing_artifact_observed":
        add(recommendations, {
          code: "fix_missing_artifact_contracts",
          title: "Fix missing artifact contracts",
          detail: "A required or observed artifact was missing. Add deterministic preflight, make expected artifacts explicit, or introduce a Transition Node for fragile handoffs.",
        });
        break;
      case "failure_fallback_used":
        add(recommendations, {
          code: "fix_failure_fallback_source",
          title: "Fix fallback-triggering failure source",
          detail: "Flow Runner failure fallback was used. Treat this as a Flow/Node reliability issue and repair the producing Node contract rather than normalizing fallback as success.",
        });
        break;
      case "resume_skip_used":
        add(recommendations, {
          code: "review_resume_dependency_surface",
          title: "Review resume dependency surface",
          detail: "The run skipped accepted Nodes. Verify that accepted artifacts are fresh enough and that downstream Nodes do not depend on hidden non-artifact state.",
        });
        break;
      case "failed_nodes":
        add(recommendations, {
          code: "inspect_failed_nodes_first",
          title: "Inspect failed Nodes first",
          detail: "One or more Nodes failed. Start with their latest run directories and compare emitted artifacts with expected artifact declarations.",
        });
        break;
    }
  }

  const longest = args.metrics.longestNode;
  if (longest && longest.durationMs !== undefined && args.metrics.durationMs !== undefined && longest.durationMs / args.metrics.durationMs >= 0.75) {
    add(recommendations, {
      code: recommendationKey("single_node_dominates_runtime", longest.qualifiedNodePath),
      title: "Reduce single-Node runtime dominance",
      detail: "One Node dominates total runtime. Consider extracting smaller Nodes, queue work items, or bounded child Flow lanes so progress and retries are more granular.",
      qualifiedNodePath: longest.qualifiedNodePath,
    });
  }

  return Array.from(recommendations.values());
}

function add(recommendations: Map<string, FlowSupervisorRemedyRecommendation>, recommendation: FlowSupervisorRemedyRecommendation): void {
  recommendations.set(recommendation.code, recommendation);
}

function recommendationKey(code: string, qualifiedNodePath: string | undefined): string {
  return qualifiedNodePath ? `${code}:${qualifiedNodePath}` : code;
}
