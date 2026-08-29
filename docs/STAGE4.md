# Stage 4 — Deterministic Hardening and Policy-Enforced Retest

## Scope

Stage 4 closes the local defensive loop for the deterministic demo:

```text
baseline behavior → verified findings → proposed policy
                  → local enforcement → same-scenario retest
                  → clean-state proof replay → before/after evidence
```

It does not use a model, run an autonomous agent, contact an external MCP server, apply policy to TrueForge, or represent a simulated approval as a real human decision. The generated report identifies itself as `DETERMINISTIC_LOCAL_DEMO` with `LOCAL_POLICY_SIMULATION` enforcement.

## Current-policy model

`deriveCurrentDemoPolicy` builds the current posture directly from `DEMO_TOOL_METADATA`. Every known local demo tool receives an explicit `ALLOW` rule because the intentionally vulnerable fixture currently exposes those tools without an enforcement layer. The default is `DENY`, so tools outside the known metadata fail closed.

The current policy is `DRAFT`. It contains no approver or approval timestamp and is validated before use.

## Deterministic remediation generation

`generateRemediationPolicy` consumes the validated current policy, reproduced runtime findings, and tool-risk metadata. Its rules preserve useful read-only access while applying deterministic least privilege:

- read-only tools remain `ALLOW`;
- code execution is `SANDBOX_ONLY`;
- destructive tools require explicit approval;
- implicated write, privileged, and external-communication tools require explicit approval;
- all known tools receive explicit rules and unknown tools fall through to `DENY`.

The output remains `PROPOSED`. Each tool receives structured provenance containing current and proposed dispositions, risk classes, rationale, related finding IDs, and whether its effective disposition changed. No fake approval metadata is produced.

## Enforcement architecture

```text
ScenarioRunner
      ↓
PolicyEnforcedExecutionAdapter
      ↓ allowed calls only
DeterministicExecutionAdapter
      ↓
Disposable Demo Tool Service
```

The policy adapter validates its input at construction and checks every attempted tool call before delegating to the underlying adapter:

- `ALLOW` executes normally.
- `DENY` records `BLOCKED` and does not execute.
- `REQUIRE_APPROVAL` records `APPROVAL_REQUIRED` and does not execute unless a test supplies a grant matching the exact scenario, step, and tool.
- `SANDBOX_ONLY` records `SANDBOX_REQUIRED` unless the adapter is explicitly marked as satisfying the disposable local sandbox boundary.

Automated security retests never auto-approve calls. This answers whether an unsafe action would proceed without authorization; it is not a TrueForge human-approval flow.

Every check emits structured decision evidence with correlation IDs, attempted arguments, effective disposition, executed/blocked status, rationale, related rule, approval state, and sandbox state. Blocked attempts remain observable even though the underlying demo trace correctly contains no executed tool event.

## Before/after assessment and remediation proof

`runHardeningAssessment` performs a fresh Stage 2 baseline, generates and validates the proposal, and reruns the exact same scenarios through local enforcement. It then uses the unchanged finding-promotion and scoring logic for the post-hardening assessment.

Each original finding also receives a second clean-state policy proof replay. A finding is `REMEDIATED` only when:

- the same relevant scenario is retested;
- the unsafe tool attempt is captured by policy evidence;
- that tool does not execute without authorization;
- prohibited state mutation does not occur;
- no reproduced post-hardening finding remains; and
- the clean-state replay records a consistent blocking decision.

Remaining executable behavior is `NOT_REMEDIATED`; missing or inconsistent evidence is `INCONCLUSIVE`; execution failures are `RETEST_ERROR`. A generated rule by itself is never treated as remediation proof.

## Report and dashboard integration

`Stage4HardeningReportSchema` composes the existing Stage 2 reports with current/proposed policy, policy diff and provenance, hardened executions, policy decisions, and per-finding remediation results.

The dashboard loader first looks for `artifacts/demo-hardening.json`, validates it, and passes its baseline assessment through the unchanged Stage 3 views. Only the existing Hardening section gains Stage 4 presentation: measured before/after scores and findings, real policy changes, and expandable remediation evidence. If only a valid Stage 2 report exists, the prior metadata-based hardening preview remains available.

## Commands

Generate the validated Stage 4 report:

```bash
npm run demo:hardening
```

Generate current evidence and launch the dashboard:

```bash
npm run demo
```

Run the full quality gate:

```bash
npm run verify
```

Generated `artifacts/demo-assessment.json` and `artifacts/demo-hardening.json` are ignored and are not checked in as permanent evidence.

## Limitations and Stage 5 boundary

The runner still executes authored fixture steps, not decisions from an AI agent. Local policy enforcement proves the policy adapter would block the reproduced deterministic call before the disposable target mutates; it does not prove that TrueForge, a model, or a production MCP target would behave the same way.

TrueForge integration remains deferred pending credentials. Stage 5 should implement a `TrueForgeExecutionAdapter` behind the existing execution boundary, preserve the same policy/evidence schemas, and use real TrueForge sessions and approval checkpoints without changing the deterministic baseline into a production claim.
