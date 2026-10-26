# SDLC: project inception

Onboard me to a repository. Path to analyze (default: this repo), and notes from me, if any: $ARGUMENTS

1. Run: `npx sdlc inception <path>` (omit the path to analyze this repo).
2. Open `.sdlc/reports/inception.md`. Give me the Executive Summary and the security table.
3. List CRITICAL and HIGH findings first. Never print secret values; the report already withholds them.
4. Ask whether I want a deeper pass. If yes, delegate to the `inception` subagent. It explores beyond the baseline and does not edit anything.
