# GitHub and Qodo Review Workflow

## Public repository

MCP Breaker is published at <https://github.com/Muzzy5150/mcp-breaker>.

## Branch strategy

The implemented stages form a linear stack:

```text
main / Stage 0 audit
  → codex/stage1-demo-target
  → codex/stage2-deterministic-runner
  → codex/stage3-security-dashboard
  → codex/stage4-hardening
```

`main` was established at the Stage 0 root commit. The original feature branches were published without squashing, rebasing, or rewriting their existing commits.

## PR strategy

Each substantive stage enters `main` through its own Qodo-reviewed pull request, in ancestry order. The representative first review is [PR #1 — deterministic MCP security test target](https://github.com/Muzzy5150/mcp-breaker/pull/1).

Later PRs must be opened only after the preceding stage is merged. If an earlier review adds fixes that are absent from a later stacked branch, the updated `main` branch will be merged into that next branch with a normal merge commit. This preserves both the original staged history and the reviewed fixes.

## Qodo workflow

1. Open the stage PR with scope, verification, safety boundaries, and hackathon context.
2. Confirm that the public PR receives an actual Qodo review; a summary alone is not review evidence.
3. Trigger `/agentic_review` once if the formal review does not start automatically.
4. Classify every finding and inspect it against the code.
5. Fix every valid High-severity finding. Fix valid Medium/Low findings when they improve correctness or safety without broadening scope.
6. Respond with a concise technical reason for any incorrect, intentional, or deferred finding; never silently ignore it.
7. Run the complete relevant verification suite, commit the smallest correct fix, and push it to the PR branch.
8. Require a follow-up Qodo review of the final commit.
9. Record the public PR as the primary evidence source.

## Severity handling

- **High:** fix, or explicitly dismiss only with concrete evidence that the finding is incorrect or intentionally accepted.
- **Medium:** investigate and fix when valid; otherwise document the technical reason for dismissal or deferral.
- **Low:** apply engineering judgment, without suppressing a valid problem merely to make the review appear clean.

Tests must not be weakened and product behavior must not be changed beyond the reviewed fix.

## Representative evidence

PR #1 received a Qodo deep review covering the loopback MCP server, trace redaction, deterministic scorer, and prototype-safe virtual state. The PR history records the initial findings, remediation commits, verification, and required follow-up review.

The README evidence section must be updated only after the representative PR is merged. Until then, the open PR remains the authoritative review record.

## Merge policy

Only the participant performs or explicitly authorizes merges. The automation agent must stop after review completion and must not merge.

Because the stage branches are stacked, use GitHub's normal **Create a merge commit** option. Do not squash or rebase-merge these stage PRs: doing so would break ancestry and make later PR diffs repeat already reviewed work.
