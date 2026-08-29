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

Stage 1 now implements the deterministic local demo target and framework-neutral core data model. The current repository contains an in-memory MCP target, safe scenario fixtures, evidence recording, verified-finding scoring, and policy data/validation. It contains no autonomous attack agent, model client, TrueForge adapter, external integration, or dashboard finding claim.

TrueForge integration remains intentionally deferred until hackathon model credentials are available. When integration begins, it should be added as an adapter around the existing shared schemas and trace model rather than embedded into the demo target.

## Stage roadmap

### Stage 0 — environment and feasibility audit

Verify the local TrueForge runtime and identify all credential, sandbox, GitHub, and Qodo blockers. This stage does not implement product behavior.

### Stage 1 — deterministic demo target

Implemented locally: deliberately unsafe fixture content, a resettable in-memory MCP target, safe tool annotations, state snapshots, trace recording, and deterministic scenario definitions. No external system is connected.

### Stage 2 — deterministic scenario runner and verifier

Build a non-model runner that executes only the four predefined local scenarios, resets and replays demo state, compares observed traces with expected behavior, and produces candidate outcomes without fabricating findings. Add a machine-readable local assessment report and explicit inconclusive/error states.

### Stage 3 — initial attack execution

Implement the four initial attack classes using TrueForge sessions, subagents where useful, and isolated execution. Keep attack inputs deterministic enough for live demonstration and replay.

### Stage 4 — verification and scoring

Reset target state, replay candidate successes, promote only reproducible outcomes to findings, and calculate severity and aggregate scores from verified evidence.

### Stage 5 — remediation and approval

Generate least-privilege and tool-approval recommendations, present them for human approval, apply only approved demo-policy changes, and rerun verified attacks.

### Stage 6 — dashboard and demo hardening

Present targets, tools, progress, traces, findings, before/after scores, policy approvals, and retest results. Add demo reset/run scripts, failure recovery, documentation, and Qodo-reviewed release readiness.
