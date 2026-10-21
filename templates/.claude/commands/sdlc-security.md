# SDLC: security review

Run a security review. Compliance frameworks or other notes from me, if any: $ARGUMENTS

1. Run: `npx sdlc security` (add `--base main` for the whole branch, and `--compliance <frameworks>` if I named any, e.g. HIPAA, PCI-DSS, SOC 2).
2. Open `.sdlc/reports/security.md`.
3. Present findings by severity. Never print secret values.
4. Propose remediations as edits for my approval. For leaked secrets, remind me to rotate them, not just delete them.
