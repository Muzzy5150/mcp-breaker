import type {
  AttackCategory,
  AttackScenario,
  DeterministicAssessmentReport,
  Finding,
  LiveAssessmentReport,
  LiveScenarioExecution,
  ScenarioExecution,
  TargetTool,
} from "@mcp-breaker/shared";

export type DashboardAssessmentReport = DeterministicAssessmentReport | LiveAssessmentReport;
export type DashboardScenarioExecution = ScenarioExecution | LiveScenarioExecution;

export const CATEGORY_LABELS: Readonly<Record<AttackCategory, string>> = {
  INDIRECT_PROMPT_INJECTION: "Indirect Injection",
  UNAUTHORIZED_WRITE: "Unauthorized Write",
  DESTRUCTIVE_ACTION: "Destructive Action",
  CONFUSED_DEPUTY: "Confused Deputy",
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as AttackCategory[];

export type MatrixStatus = "PASS" | "FAIL" | "CANDIDATE" | "INCONCLUSIVE" | "ERROR" | "NOT_TESTED";

export interface MatrixRow {
  tool: TargetTool;
  statuses: Record<AttackCategory, MatrixStatus>;
}

export function originalExecutions(report: DashboardAssessmentReport): DashboardScenarioExecution[] {
  return report.executions.filter((execution) => execution.replayOfExecutionId === undefined);
}

export function scenarioForFinding(
  report: DashboardAssessmentReport,
  finding: Finding,
): AttackScenario | undefined {
  return report.scenarios.find((scenario) => scenario.id === finding.scenarioId);
}

export function executionForTrace(
  report: DashboardAssessmentReport,
  traceId: string,
): DashboardScenarioExecution | undefined {
  return report.executions.find((execution) => execution.traceId === traceId);
}

export function buildRiskMatrix(
  report: DashboardAssessmentReport,
  tools: readonly TargetTool[],
): MatrixRow[] {
  const scenarios = new Map(report.scenarios.map((scenario) => [scenario.id, scenario]));
  const executions = originalExecutions(report);

  return tools.map((tool) => {
    const statuses = Object.fromEntries(
      CATEGORY_ORDER.map((category) => {
        const failed = report.verifiedFindings.some(
          (finding) => finding.targetTool === tool.name && finding.category === category,
        );
        const applicableExecutions = executions.filter((execution) => {
          const scenario = scenarios.get(execution.scenarioId);
          return (
            scenario?.category === category &&
            execution.trace.steps.some((step) => step.toolName === tool.name)
          );
        });
        const status: MatrixStatus = failed
          ? "FAIL"
          : applicableExecutions.some((execution) => execution.evaluation.status === "PASS")
            ? "PASS"
            : applicableExecutions.some((execution) => execution.evaluation.status === "EXECUTION_ERROR")
              ? "ERROR"
              : applicableExecutions.some((execution) => execution.evaluation.status === "INCONCLUSIVE")
                ? "INCONCLUSIVE"
                : applicableExecutions.some((execution) => execution.evaluation.status === "CANDIDATE_FINDING")
                  ? "CANDIDATE"
                  : "NOT_TESTED";
        return [category, status];
      }),
    ) as Record<AttackCategory, MatrixStatus>;
    return { tool, statuses };
  });
}

export function safeScenarioExecutions(report: DashboardAssessmentReport): Array<{
  scenario: AttackScenario;
  execution: DashboardScenarioExecution | undefined;
}> {
  const executions = new Map(originalExecutions(report).map((execution) => [execution.scenarioId, execution]));
  return report.scenarios
    .filter((scenario) => scenario.controlType === "SAFE_CONTROL")
    .map((scenario) => ({ scenario, execution: executions.get(scenario.id) }));
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
