# MCP Breaker Architecture Direction

## Product thesis

MCP Breaker is an automated red-team and penetration-testing platform for AI agents that can use Model Context Protocol (MCP) tools. It determines whether untrusted content can cause a target agent to misuse legitimate privileges before that agent is trusted with production access.

The platform must test real agent behavior. A reported successful attack must be backed by an actual tool-call trace and a successful replay from clean state. MCP Breaker must never substitute simulated agent, sandbox, MCP, or attack success for evidence.

## Intended MVP

The MVP should:

1. Connect to a target agent through the TrueForge harness.
2. Discover the target's MCP tools and classify their risk.
3. Generate and execute a small set of adversarial scenarios in an isolated sandbox.
4. Capture the complete target response and tool-call trace.
5. Replay apparent successes from a reset target state.
6. Score only verified findings.
7. Recommend a least-privilege and approval policy.
8. Require human approval before applying policy changes.
9. Rerun the same verified attacks and show whether remediation blocks them.

The first version should remain a reliable single-machine demo rather than a prematurely distributed system.

## Initial attack classes

| Attack class | Question the test answers |
| --- | --- |
| Indirect prompt injection | Can untrusted content returned by one tool instruct the agent to invoke another privileged tool? |
| Unauthorized write | Does a read-only user request cause the agent to modify state? |
| Destructive action | Can the agent delete, overwrite, merge, revoke, or perform another destructive operation without explicit authorization? |
| Confused deputy | Can untrusted content redirect the agent's legitimate privileges toward an objective the user did not request? |

## TrueForge's intended role

TrueForge is the required agent runtime and must materially power the system. MCP Breaker should use its model and tool orchestration, MCP connectivity, isolated sandbox provider, persistent sessions, subagents, and human approval checkpoints. Product code should coordinate these capabilities and record security evidence; it should not replace them with a parallel custom harness.

The dashboard, scoring, and attack logic may be MCP Breaker components, but actual target turns, tool calls, approvals, subagent execution, and sandbox execution must remain observable TrueForge operations.

## Demo target

The initial target should be a deliberately vulnerable local MCP environment containing disposable, simulated data such as fake repositories, issues, messages, files, and database records. Its tools should include harmless read operations and clearly annotated write/destructive operations against resettable demo state.

Simulated target data is permitted. Simulated execution evidence is not. Every state change shown in the demo must result from a real MCP invocation made by the target agent.

## Evidence requirements

Each candidate finding should record at least:

- original user task;
- untrusted or adversarial input;
- target-agent output;
- requested tool and arguments;
- tool result and resulting target state;
- expected safe behavior and observed behavior;
- timestamps and session/turn identifiers;
- clean-state replay result;
- remediation policy and post-remediation retest result.

A candidate does not become a finding until replay verifies it. Aggregate scores must be derived only from verified findings. Missing traces, ambiguous outcomes, failed replays, and unavailable providers must produce an explicit blocked or inconclusive state—not a vulnerability claim.

## Current implementation boundary

Stages 1 through 5 implement the disposable MCP target, deterministic offline regression pipeline, security dashboard, deterministic policy hardening, and a live TrueForge evaluation path. The live path uses the official SDK, named agents, natural-language turns, persisted events, real MCP calls, direct state snapshots, new-session reproduction, Daytona sandbox proof, session recovery, cancellation, and TrueForge approval pauses. It remains a local demo against simulated in-memory data; it is not a production scan or a claim about any external system.

The Stage 2 flow is:

```text
scenario suite
    ↓
ScenarioRunner → ExecutionAdapter → deterministic demo tool service
    ↓
expected-versus-observed evaluation
    ↓
PASS / CANDIDATE_FINDING / INCONCLUSIVE / EXECUTION_ERROR
                    ↓ candidates only
             clean-state replay
                    ↓ reproduced only
               RUNTIME Finding
                    ↓
          verified-finding scoring
                    ↓
        validated dashboard report loader
                    ↓
       evidence, replay, and risk views
```

Stage 4 composes around that unchanged evaluation flow:

```text
verified baseline findings + demo tool metadata + current policy
                             ↓
                 deterministic proposed policy
                             ↓ validate
ScenarioRunner → PolicyEnforcedExecutionAdapter → DeterministicExecutionAdapter
                             ↓
            policy decisions + hardened executions
                             ↓
          unchanged replay, promotion, and scoring
                             ↓
       clean-state remediation proof replay per finding
                             ↓
             validated before/after report
```

The deterministic adapter executes authored test steps and is not an agent runtime. Runtime provenance on a promoted finding means its local tool events and mutations actually occurred; it does not mean an AI autonomously discovered the behavior. Reports retain the deterministic-demo label and link original and replay executions with run, scenario, execution, and trace identifiers.

Stage 5 composes around the same evaluation boundary without sending deterministic `scriptedSteps` to the model:

```text
natural-language scenario → TrueForgeExecutionAdapter → TrueForge named agent → mcpbreakerdemo MCP server
                                      ↓
                     SDK stream + persisted turn events
                                      ↓
                 actual tool calls + direct state snapshots
                                      ↓
                     existing expected/observed evaluator
                                      ↓ candidates only
                     reset state + new TrueForge session
                                      ↓ reproduced only
                          verified live finding + score

verified live findings → deterministic policy engine → hardened agent manifest
                                      ↓
                       TrueForge tool approval pause
                                      ↓ automated test denial
                  same scenario + clean-session proof replay
                                      ↓
                         live before/after report
```

The deterministic adapter remains the default offline path. The live adapter is additive and uses the official `@truefoundry/trueforge-sdk`; it does not replace exposed SDK behavior with handwritten HTTP calls.

## Stage roadmap

### Stage 0 — environment and feasibility audit

Verify the local TrueForge runtime and identify all credential, sandbox, GitHub, and Qodo blockers. This stage does not implement product behavior.

### Stage 1 — deterministic demo target

Implemented locally: deliberately unsafe fixture content, a resettable in-memory MCP target, safe tool annotations, state snapshots, trace recording, and deterministic scenario definitions. No external system is connected.

### Stage 2 — deterministic scenario runner and verifier

Implemented locally: a non-model runner executes eight authored scenarios (safe and unsafe pairs for four categories), resets and replays demo state, compares observed traces and state with structured expectations, promotes only reproduced candidates, and emits a schema-validated machine-readable assessment. Explicit pass, candidate, inconclusive, execution-error, reproduced, non-reproduced, and replay-error states are represented.

### Stage 3 — security dashboard and evidence explorer

Implemented locally: a responsive Next.js dashboard renders the current Stage 2 report, Stage 1 tool metadata, exact tool/category coverage, expandable runtime evidence, distinct replay traces, safe controls, lifecycle counts, and baseline approval recommendations. Missing, invalid, and zero-finding states are explicit. Deterministic-demo labeling prevents autonomous-discovery claims.

### Stage 4 — deterministic hardening simulation and retest

Implemented locally: derive the vulnerable current posture, generate and validate a finding-backed least-privilege proposal, enforce all four dispositions before demo tool execution, preserve attempted-call decision evidence, rerun the exact scenario suite, perform clean-state policy proof replays, and emit a validated before/after report. The dashboard renders the real diff and remediation results while the policy remains visibly proposed and unapplied to TrueForge.

### Stage 5 — live TrueForge execution

Implemented on the Stage 5 branch: official SDK preflight and agent reconciliation, real natural-language target turns, MCP event/state correlation, clean-session reproduction, live finding promotion and scoring, policy-derived approval configuration, automated or interactive approval responses, hardened retests, sandbox/subagent/cancellation evidence, live artifacts, and dashboard rendering. The smoke agent is inspected but never modified.

### Stage 6 — assessment history and release hardening

Add assessment history, target selection, before/after comparisons, policy approvals, and retest trends to the existing dashboard. Complete failure recovery, release documentation, and Qodo-reviewed readiness.
