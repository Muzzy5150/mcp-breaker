# Stage 3 — Security Dashboard and Evidence Explorer

## Scope

Stage 3 adds a local, judge-friendly security dashboard for the deterministic Stage 2 engine. It presents real assessment, tool, trace, replay, and scoring data. It does not run an AI model, generate attacks, apply policy, contact an external MCP server, or represent fixture results as autonomous discovery.

Every successful dashboard view visibly carries the label `DETERMINISTIC LOCAL DEMO`.

## Dashboard architecture

`apps/dashboard` is a Next.js App Router application. Its root route is a server-rendered page so assessment files stay on the server side and no internal filesystem path or raw report-loading mechanism is exposed to browser code.

```text
artifacts/demo-assessment.json
            ↓ read-only load
DeterministicAssessmentReportSchema
            ↓ validated result
ready / missing / invalid
            ↓
React dashboard views
```

The loader searches for the generated report from either the repository root or dashboard workspace working directory. It parses JSON as `unknown` and validates it with `DeterministicAssessmentReportSchema` from `packages/shared`. Missing, unreadable, malformed, and schema-invalid reports receive explicit states instead of fabricated fallback data.

The tool inventory and baseline hardening preview import `DEMO_TOOL_METADATA` from `apps/demo-target`. Risk classification and approval recommendations are not duplicated in frontend constants.

## Primary views

- Assessment overview with target, completion state, report-derived score, risk level, scenario count, pass count, and severity counts.
- Assessment timeline built from report counts and available boundary timestamps.
- Tool inventory with Stage 1 risk classes, approval posture, and verified-finding involvement.
- Risk matrix that marks `FAIL` only for an exact tool/category match in a verified finding.
- Expandable findings explorer with original intent, untrusted content, captured arguments/results, before/after state, expected/actual behavior, and replay evidence.
- Replay panel showing distinct initial and replay trace IDs plus the replayed prohibited call.
- Four safe-control cards showing expected and observed safe behavior and actual tool sequences.
- Baseline Policy Recommendations derived from metadata only; no policy is applied.
- Concise architecture explainer and an explicit pending TrueForge note.

The findings explorer uses native `details` and `summary` controls. It is keyboard accessible without a custom JavaScript state layer.

## Local demo workflow

Run the complete local flow:

```bash
npm run demo
```

This builds the workspace, generates a current Stage 2 assessment, then starts the dashboard at `http://127.0.0.1:3000`.

The two steps can also run separately:

```bash
npm run demo:assessment
npm run dashboard:dev
```

The generated `artifacts/demo-assessment.json` remains ignored by Git. The dashboard never contains a checked-in copy of the report.

## Empty and error states

The UI supports:

- assessment not yet run;
- missing report;
- invalid JSON or invalid schema;
- valid assessment with no findings;
- valid assessment with replay-verified findings;
- route loading and unexpected runtime errors.

## Truthfulness boundary

The dashboard renders actual deterministic Stage 2 execution evidence. A `RUNTIME` finding means the local demo tool call and state mutation occurred and a fresh replay reproduced it. It does not mean an AI agent autonomously found the issue.

Static product explanations are intentionally separated from report-derived security claims. Finding titles, counts, severities, tools, arguments, results, states, trace IDs, and scores are rendered from validated data.

## Known limitations

- Execution remains authored deterministic test behavior, not model decision-making.
- The dashboard reads one local assessment report and does not provide persistence or history.
- Risk-band thresholds are currently local presentation logic; a later stage should centralize them if product policy introduces additional bands.
- Hardening is a metadata-based preview and cannot apply or verify policy.
- TrueForge, model providers, Daytona, external targets, production data, and authentication are not connected.

TrueForge remains intentionally deferred until hackathon model credentials are available. A future runtime should produce the same shared report contract so the UI can remain evidence-source agnostic.
