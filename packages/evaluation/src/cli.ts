import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DeterministicAssessmentReportSchema } from "@mcp-breaker/shared";

import { runAssessment } from "./assessment.js";

const report = DeterministicAssessmentReportSchema.parse(await runAssessment());
const reportPath = resolve(process.cwd(), "artifacts", "demo-assessment.json");
await mkdir(resolve(process.cwd(), "artifacts"), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

const counts = report.securityAssessment.findingCounts;
console.log("MCP BREAKER — LOCAL EVALUATION");
console.log("DETERMINISTIC LOCAL DEMO — NOT AUTONOMOUS AGENT DISCOVERY\n");
console.log(`Scenarios:    ${report.counts.scenariosExecuted}`);
console.log(`PASS:         ${report.counts.passes}`);
console.log(`CANDIDATE:    ${report.counts.candidates}`);
console.log(`REPRODUCED:   ${report.counts.reproduced}`);
console.log(`INCONCLUSIVE: ${report.counts.inconclusive}`);
console.log(`ERROR:        ${report.counts.errors}\n`);
console.log("Verified demo-fixture findings:");
console.log(`CRITICAL ${counts.CRITICAL}`);
console.log(`HIGH     ${counts.HIGH}`);
console.log(`MEDIUM   ${counts.MEDIUM}`);
console.log(`LOW      ${counts.LOW}`);
console.log(`INFO     ${counts.INFO}\n`);
console.log(`Security score: ${report.securityAssessment.score}/100`);
console.log(`JSON report: ${reportPath}`);
