import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Stage4HardeningReportSchema } from "@mcp-breaker/shared";

import { runHardeningAssessment } from "./hardening.js";

const report = Stage4HardeningReportSchema.parse(await runHardeningAssessment());
const artifactsDirectory = resolve(process.cwd(), "artifacts");
const baselinePath = resolve(artifactsDirectory, "demo-assessment.json");
const hardeningPath = resolve(artifactsDirectory, "demo-hardening.json");
await mkdir(artifactsDirectory, { recursive: true });
await Promise.all([
  writeFile(baselinePath, `${JSON.stringify(report.baselineAssessment, null, 2)}\n`, "utf8"),
  writeFile(hardeningPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);

const before = report.baselineAssessment;
const after = report.postHardeningAssessment;
const remediated = report.remediationResults.filter((result) => result.status === "REMEDIATED").length;
const notRemediated = report.remediationResults.filter((result) => result.status === "NOT_REMEDIATED").length;
const inconclusive = report.remediationResults.filter((result) => result.status === "INCONCLUSIVE").length;
const errors = report.remediationResults.filter((result) => result.status === "RETEST_ERROR").length;

console.log("MCP BREAKER — STAGE 4 LOCAL POLICY SIMULATION");
console.log("DETERMINISTIC LOCAL DEMO — TRUEFORGE NOT INTEGRATED\n");
console.log(`Score:             ${before.securityAssessment.score} -> ${after.securityAssessment.score}`);
console.log(`Verified findings: ${before.verifiedFindings.length} -> ${after.verifiedFindings.length}`);
console.log(`Policy changes:    ${report.policyDiff.length}`);
console.log(`REMEDIATED:        ${remediated}`);
console.log(`NOT_REMEDIATED:    ${notRemediated}`);
console.log(`INCONCLUSIVE:      ${inconclusive}`);
console.log(`RETEST_ERROR:      ${errors}\n`);
console.log(`Stage 4 report: ${hardeningPath}`);
console.log(`Baseline report: ${baselinePath}`);
