# Stage 0 — Environment and Feasibility Audit

- Audit date: 2026-08-29
- Workspace: `/Users/muzzy5150/Documents/ChatGPT/MCP Breaker`

## Outcome

Stage 0 is **PARTIALLY VERIFIED**. The official TrueForge package launches and responds locally, and TrueForge performed real MCP tool discovery against a disposable custom server. End-to-end model, isolated sandbox, agent tool invocation, approval, and subagent proofs are blocked by missing provider configuration. GitHub and Qodo workflow verification are blocked by an invalid GitHub CLI login and the absence of a remote repository.

No attack engine, dashboard, vulnerable demo target, score, finding, or Stage 1 product code was created.

## Status summary

| Component | Status | Evidence | Blocker/Next Action |
| --- | --- | --- | --- |
| Git | PASS | Git 2.50.1; repository already initialized; work performed on `codex/stage0-audit`. | None for local work. |
| Node | PASS | Node 24.10.0. npm reports `@truefoundry/trueforge@0.1.4` requires Node `>=22`. | None. |
| npm / npx | PASS | npm 11.19.0 and npx 11.19.0 are available. | None. |
| Python | PASS | Python 3.14.6 is available. | None for Stage 0. |
| Docker | FAIL | `docker` is not installed (`command not found`). | Install Docker only if a later hosted/Compose workflow requires it; standalone TrueForge does not. |
| TrueForge local | PASS | Official package 0.1.4 started in standalone mode at `http://localhost:18791`; `GET /healthz` returned HTTP 200 and `OK!`; shutdown was clean. | Keep standalone mode localhost-only. |
| Model provider | BLOCKED | `GET /api/v1/settings/model-providers` returned an empty provider list. No real model turn was attempted. | Configure one supported provider in Settings → Models without sharing the key in chat. |
| Sandbox | BLOCKED | `GET /api/v1/settings/sandbox-providers` returned HTTP 404: `No sandbox provider configured`. The server announced a macOS local fallback, which is host execution and is not acceptable isolation evidence. | Configure Daytona with the required permissions, then run the unique-string command through a sandbox-enabled TrueForge agent. |
| Custom MCP | BLOCKED | TrueForge registered the disposable server (HTTP 201) and its `tools/list` path discovered `echo_test` (HTTP 200). The required agent→`echo_test` call could not run without a model provider. | After model setup, attach the connector to a test agent and invoke `echo_test` through a real turn. |
| Human approvals | BLOCKED | The published API exposes `require_approval_for_tools`; the default selectors are `@write` and `@destructive`, and literal tool names are supported. No live pause was claimed because no model can request the tool. | Gate `echo_test` explicitly via the agent API, request it in a turn, and verify no tool result appears before Allow/Deny. |
| Subagents | BLOCKED | TrueForge 0.1.4 exposes `config.dynamic_sub_agents.enabled` and defaults it to `true`. No delegation turn was claimed because no model provider is configured. | Run one parent turn that delegates a trivial task and capture the child trace and returned result. |
| GitHub | BLOCKED | GitHub CLI 2.97.0 is installed, but `gh auth status` reports the active token for `Muzzy5150` is invalid. The repository has no remote. | Reauthenticate in the browser, create/select the GitHub repository, and add `origin`. |
| Qodo | BLOCKED | No local Qodo command/configuration or GitHub remote exists, so repository app access and review behavior cannot be evidenced. | Install the Qodo GitHub App for only the new repository, then verify an actual review on a PR. |

Only the statuses `PASS`, `FAIL`, `BLOCKED`, and `NOT TESTED` are used in this audit.

## Environment inventory

| Item | Observed value |
| --- | --- |
| OS | macOS 26.6.2 (Darwin 25.6.0) |
| Architecture | arm64 |
| Git | 2.50.1 (Apple Git-155) |
| Node | 24.10.0 |
| npm / npx | 11.19.0 / 11.19.0 |
| Python | 3.14.6 |
| Docker | Not installed |
| GitHub CLI | 2.97.0; authentication invalid |
| Initial repository state | Initialized repository, no commits, branch `main`, no remote |

No environment variable values were printed. A name-only check found no model-provider, Daytona, Qodo, GitHub-token, or TrueFoundry credential variables in the process environment.

## TrueForge local verification

The current official local mechanism is:

```sh
npx @truefoundry/trueforge@latest
```

For reproducibility, this audit pinned the registry's current stable release:

```sh
npm view @truefoundry/trueforge version engines dist-tags --json
npx --yes @truefoundry/trueforge@0.1.4 --help
npx --yes @truefoundry/trueforge@0.1.4 --port 18791
curl -sS -i --max-time 5 http://localhost:18791/healthz
```

Observed evidence:

- npm `latest`: `0.1.4` (`rc` was `0.2.0-rc.0`, and was not used);
- package engine requirement: Node `>=22`;
- process mode: standalone with SQLite, no Redis;
- endpoint: `http://localhost:18791`;
- health response: HTTP 200, body `OK!`;
- fatal startup errors: none observed;
- the service bound IPv6 localhost on this machine, so `localhost`/`::1` worked while `127.0.0.1` did not.

TrueForge's own warning says standalone mode is for local use and is not production-safe. Authentication was disabled in this local mode. The smoke service was shut down after each check.

Official references:

- [TrueForge repository and local quickstart](https://github.com/truefoundry/trueforge)
- [TrueForge model setup](https://trueforge.dev/models)
- [TrueForge sandbox setup](https://trueforge.dev/sandbox)
- [TrueForge agent configuration, approvals, and subagents](https://trueforge.dev/create-agent/overview)

## Configuration evidence

Safe, read-only API checks were made against a temporary running TrueForge instance:

```sh
curl -sS http://localhost:18794/api/v1/capabilities
curl -sS http://localhost:18794/api/v1/settings/model-providers
curl -sS http://localhost:18794/api/v1/settings/sandbox-providers
curl -sS http://localhost:18794/api/v1/settings/mcp-servers
curl -sS http://localhost:18794/api/v1/agents
```

Sanitized results:

- capabilities advertised sandbox, skills, and settings support;
- configured model providers: 0;
- configured sandbox provider: none (HTTP 404);
- configured MCP servers in the default local database: 0;
- configured agents: 0;
- bundled sandbox catalog: Daytona only.

Advertising a capability is not treated as end-to-end proof. In particular, TrueForge's local sandbox fallback runs on the host, so the audit deliberately did not execute the proposed command through that fallback and did not call it isolated.

## Custom MCP smoke test

A disposable MCP server was created outside the repository under `/private/tmp`. It used the official MCP TypeScript SDK packages and exposed one read-only, idempotent tool:

```text
echo_test(message) -> message
```

Installed only in the temporary directory:

```sh
npm install --prefix /private/tmp/mcp-breaker-mcp-smoke --no-audit --no-fund \
  @modelcontextprotocol/server@2.0.0 \
  @modelcontextprotocol/node@2.0.0 \
  zod@4.5.2
```

The MCP server and TrueForge were launched in the same test shell. TrueForge used an isolated temporary SQLite file via its documented `SQLITE_PATH` environment override, so the test did not add a connector to the user's default TrueForge database.

Observed TrueForge API results:

| Operation | Result |
| --- | --- |
| Register `stage0-echo` at `http://localhost:18880/mcp` | HTTP 201 |
| `GET /api/v1/mcp-servers/stage0-echo/tools` | HTTP 200 |
| Discovered tool | `echo_test` |
| Discovered annotation | `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` |

This is real TrueForge→MCP `tools/list` evidence. It is not evidence of a model-directed tool call. The required `TRUEFORGE AGENT → echo_test → result` proof remains blocked until a real model provider is configured.

## Approval and subagent feasibility

The downloaded TrueForge 0.1.4 OpenAPI document and official documentation confirm:

- an MCP attachment accepts `require_approval_for_tools` with `@all`, `@write`, `@destructive`, or literal tool names;
- the default is `["@write", "@destructive"]`;
- approval resumes use `user.tool_approval` turn input;
- dynamic subagents are configured with `config.dynamic_sub_agents.enabled` and default to enabled.

These facts establish supported configuration paths, not runtime success. Both checks remain `BLOCKED` until a real model can request the harmless tool and delegate the trivial task.

## GitHub and Qodo readiness

Commands used:

```sh
gh --version
gh auth status
git remote -v
command -v qodo
command -v qodo-merge
command -v pr-agent
gh extension list
```

Observed state:

- GitHub CLI is installed;
- its active GitHub token is invalid;
- the repository has no remote;
- no local Qodo/PR-Agent command, extension, repository configuration, PR, or review evidence exists.

Qodo's current quickstart requires a linked Git account and the Qodo GitHub App installed for the repository. A real PR review is the required evidence; installation alone will not be recorded as a successful review.

Official reference: [Qodo quickstart](https://docs.qodo.ai/get-started).

## Required human actions

Do not paste any key or token into chat.

1. **Configure a model provider.** Start TrueForge with `npx --yes @truefoundry/trueforge@0.1.4`, open `http://localhost:8790`, go to **Settings → Models**, choose a supported provider, paste a test/project-scoped API key obtained from that provider's own console, and save it.
2. **Configure isolated sandboxing.** In Daytona, create an API key with **Sandboxes access** and **Snapshots write/create permission**. In TrueForge, open **Settings → Sandbox providers**, select Daytona, paste the key, and wait until the provider reports ready. TrueForge's official setup notes that sandbox-only permission is insufficient because the initial release snapshot must be created.
3. **Repair GitHub access.** Run `gh auth login -h github.com` and complete browser authorization. Create or select the intended empty GitHub repository, then add it as `origin`; do not push or open a PR until requested.
4. **Install Qodo for the repository.** Sign in to Qodo, link the GitHub account, and install the Qodo GitHub App with access limited to the MCP Breaker repository. No Qodo readiness claim should be made until an actual PR receives review output.
5. Return and say the setup is complete. Rerun only the blocked Stage 0 checks before beginning Stage 1.

## Rerun acceptance checks

After the human actions, Stage 0 becomes fully verified only when evidence shows:

1. a minimal real model response through TrueForge;
2. `MCP_BREAKER_SANDBOX_OK` returned from Daytona-isolated execution, not the host fallback;
3. a TrueForge agent actually invokes `echo_test` and receives the supplied unique message;
4. a literal approval rule pauses `echo_test`, with no invocation before approval;
5. a parent agent delegates a trivial task and receives a child result;
6. GitHub remote/authentication are valid; and
7. Qodo produces identifiable review evidence on a real PR.
