# sdlc-rig workflow

This repository uses `sdlc` (built on githubnext/rig) for SDLC steps. Reports go to `.sdlc/reports/` as Markdown and JSON.

Run these from the repo root:

- Requirements: `npx sdlc stories "<idea>"`
- Design: `npx sdlc plan "<feature>"` (reads stories.json when present)
- Code review: `npx sdlc review [--base main]`
- Tests: `npx sdlc test [--cmd "<command>"]`
- Security: `npx sdlc security [--compliance HIPAA]`
- Release notes: `npx sdlc release [--from <tag>]`
- Everything before a PR: `npx sdlc pr --base main`

The engine comes from `SDLC_ENGINE` in `.env` or the shell (`anthropic` or `codex`). The sdlc agents call the model API directly, so they need `ANTHROPIC_API_KEY` even when you run them from Claude Code.

Treat report findings as suggestions: verify them against the code before changing anything, and ask before applying edits. Never echo secrets from reports or diffs.
