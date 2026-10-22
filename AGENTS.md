<!-- sdlc:start -->
## sdlc-rig

This repository uses `sdlc` (built on githubnext/rig) for SDLC steps. Reports go to `.sdlc/reports/`.

Run these from the repo root when asked:

- Stories: `npx sdlc stories "<idea>"`, then read `.sdlc/reports/stories.md`
- Plan: `npx sdlc plan "<feature>"`, then read `.sdlc/reports/plan.md`
- Review: `npx sdlc review [--base main]`, then read `.sdlc/reports/review.md`
- Tests: `npx sdlc test [--cmd "<command>"]`
- Security: `npx sdlc security [--compliance HIPAA]`
- Release notes: `npx sdlc release [--from <tag>]`
- Before a PR: `npx sdlc pr --base main`

The engine comes from `SDLC_ENGINE` (`anthropic` or `codex`). Codex needs `codex login` or `OPENAI_API_KEY`.

Treat report findings as suggestions: verify them against the code, and ask before applying edits. Never echo secrets from reports or diffs.
<!-- sdlc:end -->
