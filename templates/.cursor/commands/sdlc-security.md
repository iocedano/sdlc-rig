# SDLC: security review

1. Run: `npx sdlc security --engine cursor` — add `--base main` for the whole branch, and `--compliance <frameworks>` if I mentioned any (e.g. HIPAA, PCI-DSS, SOC 2).
2. Open `.sdlc/reports/security.md`.
3. Present findings by severity. Never print secret values.
4. Propose remediations as edits for my approval; for leaked secrets, remind me to rotate them, not just delete them.
