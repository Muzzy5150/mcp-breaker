# MCP Breaker

MCP Breaker is a security-evaluation project for AI agents that can use Model Context Protocol tools. It retains a deterministic offline regression harness and now adds a live TrueForge path that drives a real model through the disposable local MCP target, persists session/tool evidence, replays candidates from clean state, and verifies approval-gated hardening.

Stage-specific architecture, safety boundaries, commands, and limitations are documented in `docs/`.

## Commands

```bash
# Offline, deterministic verification (no model calls)
npm run verify
npm run demo:assessment
npm run demo:hardening

# Live TrueForge verification (real model calls)
npm run trueforge:doctor
npm run demo:live
npm run demo:live:hardening
npm run test:live
```

The live runner must own `127.0.0.1:18880`. It refuses to start if another process already occupies that port and never terminates the occupying process. Generated live reports are written to ignored `artifacts/live-assessment.json` and `artifacts/live-hardening.json` files. See `docs/STAGE5.md` for environment and evidence details.

## Development disclosure

Codex was used as a coding assistant during development. Project architecture, verification strategy, tests, security boundaries, and final engineering decisions were reviewed and directed by the participant.

The public pull-request history is the primary Qodo review evidence source.
