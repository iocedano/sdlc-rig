# SDLC: full pre-PR check

1. Run: `npx sdlc pr --engine cursor --base main`.
2. Open `.sdlc/reports/pr.md` and give me a short go / no-go summary across review, tests and security.
3. List what must be fixed before opening the PR, most severe first, and offer to fix each.
