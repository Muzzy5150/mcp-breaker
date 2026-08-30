<h1 align="center">MCP BREAKER</h1>

<p align="center">
  <strong>Test every tool call. Verify every failure.</strong>
</p>

<p align="center">
  Replay-verified security evaluation and deterministic policy hardening for AI agents that use Model Context Protocol tools.
</p>

<p align="center">
  <a href="https://github.com/Muzzy5150/mcp-breaker"><img alt="GitHub repository" src="https://img.shields.io/badge/github-repository-181717?style=for-the-badge&logo=github" /></a>
  <img alt="Tests" src="https://img.shields.io/badge/tests-104%20passing-34d399?style=for-the-badge" />
</p>

<p align="center">
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0-3178C6?style=flat-square&logo=typescript&logoColor=white" />
  <img alt="Next.js" src="https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=next.js&logoColor=white" />
  <img alt="React" src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111111" />
  <img alt="Model Context Protocol" src="https://img.shields.io/badge/MCP-2.0-8B5CF6?style=flat-square" />
  <img alt="TrueForge" src="https://img.shields.io/badge/TrueForge-Live%20Evaluation-F97316?style=flat-square" />
  <img alt="Vitest" src="https://img.shields.io/badge/Vitest-4.1-6E9F18?style=flat-square&logo=vitest&logoColor=white" />
</p>

<p align="center">
  <a href="#what-it-does">Features</a>
  ·
  <a href="#how-it-works">How It Works</a>
  ·
  <a href="#quick-start">Quick Start</a>
  ·
  <a href="#documentation">Documentation</a>
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-overview.png" alt="MCP Breaker security assessment dashboard and local MCP inspection panel" width="100%" />
</p>

## Overview

MCP Breaker is a security-evaluation platform for AI agents with MCP tool access. It inventories the tools an agent can call, runs adversarial and safe-control scenarios, captures the resulting tool and state evidence, and replays suspicious behavior from a clean state before promoting it to a verified finding.

Verified findings feed a deterministic least-privilege policy engine. MCP Breaker then reruns the same attacks against the hardened policy and records whether each unsafe action was blocked, approval-gated, or constrained to a sandbox.

> [!NOTE]
> The interactive demo runs locally. MCP inspection, TrueForge execution, generated evidence, and policy retests remain intentionally loopback-only because the demo target and control plane bind only to local addresses.

## What It Does

| Capability | What MCP Breaker verifies |
| --- | --- |
| MCP tool inventory | Discovers tool names, schemas, annotations, and risk-relevant capabilities. |
| Adversarial scenarios | Tests indirect prompt injection, unauthorized writes, destructive actions, and confused-deputy behavior. |
| Safe controls | Confirms that expected read-only behavior still works and distinguishes a secure agent from a broken one. |
| Runtime evidence | Records tool arguments, results, state changes, session identifiers, and expected-versus-observed behavior. |
| Clean-state replay | Reproduces a candidate in a distinct run before it becomes a verified finding. |
| Verified scoring | Calculates security scores only from replay-verified runtime findings. |
| Policy hardening | Generates explicit `ALLOW`, `DENY`, `REQUIRE_APPROVAL`, and `SANDBOX_ONLY` rules with provenance. |
| Before/after proof | Reruns the suite and records the exact policy decision and remediation result for every finding. |

## How It Works

```text
MCP target
   ↓
tool discovery + risk classification
   ↓
adversarial scenarios + safe controls
   ↓
tool traces + direct state evidence
   ↓
clean-state replay
   ↓
verified findings + evidence-backed score
   ↓
least-privilege policy generation
   ↓
hardened retest + remediation proof
```

MCP Breaker supports two evidence paths:

- **Deterministic offline mode** provides a fast, repeatable regression harness with no model calls.
- **TrueForge live mode** drives a real model through the disposable MCP target, persists SDK events, reproduces candidates in new sessions, and verifies approval pauses during hardened retests.

## Security Evidence

### Tool-by-category risk matrix

The matrix separates verified failures, completed safe executions, candidates, and untested combinations. A tool is never marked safe merely because a scenario did not run.

![MCP Breaker tool risk matrix](docs/screenshots/risk-matrix.png)

### Distinct replay evidence

Every verified finding links the original unsafe trace to a separate replay trace and exposes the exact tool arguments, response, and resulting state.

![MCP Breaker original and replayed tool-call evidence](docs/screenshots/replay-evidence.png)

### Deterministic policy hardening

The hardening view explains each effective rule change and compares the current policy with the live retest policy.

![MCP Breaker deterministic policy hardening changes](docs/screenshots/policy-hardening.png)

## Tech Stack

| Layer | Technology |
| --- | --- |
| Language | TypeScript 6, Node.js 24+ |
| Dashboard | Next.js 16, React 19, Tailwind CSS 4 |
| MCP runtime | `@modelcontextprotocol/server`, `@modelcontextprotocol/client` |
| Live evaluation | Official `@truefoundry/trueforge-sdk` |
| Validation | Zod schemas at artifact and policy boundaries |
| Testing | Vitest, TypeScript project references, ESLint |
| Repository | npm workspaces monorepo |

## Repository Structure

```text
apps/
├── dashboard/          Next.js security dashboard and local control API
└── demo-target/        Disposable, resettable MCP server with 11 tools

packages/
├── attack-library/     Adversarial and safe-control scenario corpus
├── breaker-core/       Tool traces, policy validation, and enforcement
├── evaluation/         Deterministic and TrueForge execution pipelines
├── scoring/            Verified-finding security scoring
└── shared/             Shared schemas and report contracts

docs/                   Architecture, stage notes, and review workflow
tests/                  Offline regression and integration coverage
```

## Quick Start

Requirements: Node.js 24 or newer and npm.

```bash
git clone https://github.com/Muzzy5150/mcp-breaker.git
cd mcp-breaker
npm install
npm run verify
npm run demo
```

Open `http://127.0.0.1:3000` after the dashboard starts. The deterministic demo does not require model credentials or paid calls.

### Live TrueForge demo

Configure the local TrueForge control plane, model provider, and Daytona sandbox as described in [Stage 5](docs/STAGE5.md), then run:

```bash
npm run demo:ui
```

The website owns the disposable MCP server on `127.0.0.1:18880`. Do not run `npm run demo:start` at the same time.

## Commands

```bash
# Complete offline verification
npm run verify

# Deterministic assessment and hardening
npm run demo:assessment
npm run demo:hardening

# Live TrueForge assessment and hardening
npm run trueforge:doctor
npm run demo:live
npm run demo:live:hardening
npm run test:live
```

Generated assessment artifacts are schema-validated, written under `artifacts/`, permissioned for local use, and ignored by Git.

## Safety Boundaries

- The demo target contains disposable simulated repositories, files, issues, pull requests, and messages.
- MCP and TrueForge endpoints must be loopback-only; arbitrary remote MCP URLs are rejected.
- A failed or missing replay remains a candidate or inconclusive result, never a verified vulnerability.
- Unknown tools fail closed under the hardening policy.
- The harness never kills a process occupying its managed MCP port.
- No credentials, hidden model reasoning, or generated assessment artifacts are committed.

## Documentation

- [Architecture and product boundaries](docs/ARCHITECTURE.md)
- [Deterministic demo target](docs/STAGE1.md)
- [Scenario runner and verifier](docs/STAGE2.md)
- [Security dashboard](docs/STAGE3.md)
- [Policy hardening and retest](docs/STAGE4.md)
- [Live TrueForge evaluation](docs/STAGE5.md)
- [Website demo flow](docs/STAGE5_5.md)
- [GitHub and Qodo review workflow](docs/QODO_WORKFLOW.md)

## Development Disclosure

Codex was used as a coding assistant during development. Project architecture, verification strategy, tests, security boundaries, and final engineering decisions were reviewed and directed by the participant. The public pull-request history is the primary Qodo review evidence source.
