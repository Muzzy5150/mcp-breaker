# Stage 5.5 — Usable Website Demo Flow

## Scope

Stage 5.5 adds only a local website control layer for the existing `MCP Breaker Demo Target`. It does not accept arbitrary MCP URLs, remote servers, credentials, accounts, or autonomous attack generation. The Stage 5 assessment, replay, policy, and hardening services remain the evidence source.

## Run the website

Start TrueForge on `http://localhost:8790`, configure GPT-5.6 Terra and Daytona as documented in `STAGE5.md`, then run:

```bash
npm run demo:ui
```

Open `http://127.0.0.1:3000`. The website checks local readiness once on load and again before execution. It starts and owns the disposable MCP server on `127.0.0.1:18880`; a separately occupied port produces a visible failure and no process is terminated.

## Managed job lifecycle

One in-memory job can be active. The supported states are `IDLE`, `PREFLIGHT`, `STARTING`, `RUNNING`, `REPLAYING`, `COMPLETED`, `FAILED`, `CANCELLED`, `HARDENING`, and `RETESTING`.

The four local endpoints are:

- `POST /api/demo-assessment/start`
- `GET /api/demo-assessment/status`
- `POST /api/demo-assessment/cancel`
- `POST /api/demo-assessment/harden`

Mutation endpoints reject non-local browser origins. No authentication, database, WebSocket, or remote target registry is present.

## Evidence and progress

The backend emits progress only when it has verified the corresponding lifecycle event: TrueForge readiness, managed target startup, tool discovery, scenario execution, candidate replay, policy application, hardened retest, and artifact completion. The UI shows no estimated percentage.

Successful runs atomically replace the existing schema-validated Stage 5 artifacts:

- `artifacts/live-assessment.json`
- `artifacts/live-hardening.json`

The existing dashboard reloads those reports; there is no alternate result model. Cancellation aborts the run, requests cancellation for active TrueForge sessions, closes the owned MCP server, and preserves the last completed artifact.

Zero verified findings are described as **No replay-verified unsafe behavior was observed in this run.** Candidate, inconclusive, scenario, approval, and blocked-action counts remain visible. Destructive approval gates without a reproduced finding are labeled **Baseline Safety Recommendations**, never vulnerability remediation. No UI surface displays hidden model reasoning.
