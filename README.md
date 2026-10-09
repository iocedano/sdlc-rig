# sdlc-rig

An AI SDLC assistant built on [githubnext/rig](https://github.com/githubnext/rig) — typed, schema-validated agents for every stage from idea to release, usable from the terminal, **inside Cursor**, and in **GitHub Actions**.

```
idea ──► stories ──► plan ──► (code) ──► review ─┐
                                         test   ├─► pr (CI gate + PR comment) ──► release
                                         security┘
```

> New here? Start with the step-by-step [beginner guide](docs/GUIDE.md).

| Command | What it does | Report |
|---|---|---|
| `sdlc stories "<idea>"` | Epic + INVEST user stories, Given/When/Then criteria, MoSCoW, estimates, open questions | `stories.md/json` |
| `sdlc plan "<feature>"` | Design grounded in the repo tree + key files; tasks with dependencies, risks, rollout, test strategy (reuses `stories.json`) | `plan.md/json` |
| `sdlc review [--base main]` | Code review of the diff with severity, file:line and suggestions | `review.md/json` |
| `sdlc test [--cmd "npm test"]` | Runs tests, explains failures, sketches missing tests | `tests.md/json` |
| `sdlc security [--compliance HIPAA,PCI]` | Secret scan, dependency audit, optional semgrep/gitleaks, OWASP/CWE review, compliance notes | `security.md/json` |
| `sdlc release [--from v1.2.0]` | SemVer bump + user-facing release notes since the last tag | `release.md/json` |
| `sdlc pr --base main` | review + test + security in parallel, one combined report | `pr.md/json` |
| `sdlc init` | Adds Cursor commands/rules and the GitHub Actions workflow to the current repo | — |

Reports go to `.sdlc/reports/` (change with `--out`). `--json` prints JSON; `--fail-on critical|high|medium` exits 1 for CI gating.

## Install

Requires Node 20+.

```bash
git clone <your-repo-url> sdlc-rig && cd sdlc-rig && npm install
npm link                      # makes `sdlc` available everywhere
# or, inside a project:  npm i -D github:<you>/sdlc-rig   → then use `npx sdlc`
```

Try it with no LLM at all: `sdlc review --engine mock`.

## Engines

Pick with `--engine` or `SDLC_ENGINE`; model with `--model` or `SDLC_MODEL`.

| Engine | Auth | Notes |
|---|---|---|
| `cursor` | `agent login` or `CURSOR_API_KEY` | Custom adapter (`src/engines/cursor.ts`) over the Cursor CLI in headless JSON mode. Read-only (no `--force`). Extra flags via `CURSOR_AGENT_ARGS`, binary via `CURSOR_AGENT_BIN` (`cursor-agent` on older installs). |
| `anthropic` | `ANTHROPIC_API_KEY` | Default model `claude-sonnet-4-5`. |
| `codex` | `OPENAI_API_KEY` / Codex login | Uses `@openai/codex-sdk`. |
| `gemini` | Gemini CLI login | Requires the `gemini` CLI. |
| `copilot` | Copilot SDK server | Rig's native engine. |
| `auto` | — | Rig's own env-based selection. |
| `mock` | — | Schema-valid placeholders, for wiring and tests. |

All context (diffs, test output, file tree, scanner output) is gathered deterministically in Node and passed as typed input, so every engine sees the same data — including plain API engines without shell access. Secrets found in the diff are redacted before anything is sent to a model.

## Using it in Cursor

```bash
cd your-project && sdlc init
```

This adds:

- **Slash commands** in `.cursor/commands/`: `/sdlc-stories`, `/sdlc-plan`, `/sdlc-review`, `/sdlc-test`, `/sdlc-security`, `/sdlc-release`, `/sdlc-pr`. Each one has Cursor's agent run the CLI with `--engine cursor`, open the report, and then propose fixes as edits you approve — so Rig produces the structured analysis and Cursor applies the changes.
- **A project rule** `.cursor/rules/sdlc.mdc` describing the workflow.

You need the Cursor CLI installed and logged in (`curl https://cursor.com/install -fsS | bash`, then `agent login`). If headless runs prompt for workspace trust, set `CURSOR_AGENT_ARGS="--trust"`.

## Using it in CI

`sdlc init` also adds `.github/workflows/sdlc.yml`, which on every PR runs `sdlc pr`, posts/updates one PR comment with the report, uploads the reports as an artifact, and fails the check on critical findings or failing tests.

Configure in the repo settings:

- Variable `SDLC_ENGINE` = `anthropic` (default) or `cursor`, optional `SDLC_MODEL`, `SDLC_COMPLIANCE` (e.g. `HIPAA,SOC 2`).
- Secret `ANTHROPIC_API_KEY` or `CURSOR_API_KEY` to match.

The workflow assumes `sdlc-rig` is a devDependency of the project (`npm i -D github:<you>/sdlc-rig`).

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `SDLC_ENGINE`, `SDLC_MODEL` | `auto`, per engine | Engine and model |
| `SDLC_TEST_CMD` | auto-detected (npm / go / pytest) | Test command |
| `SDLC_COMPLIANCE` | empty | Compliance focus for `security` |
| `SDLC_MAX_DIFF_CHARS` | `120000` | Diff truncation limit |
| `SDLC_TIMEOUT_MS` | `300000` | Per-agent timeout |
| `RIG_DEBUG` | — | Rig's JSONL debug logs, e.g. `RIG_DEBUG=agent` |

## Project layout

```
src/
  agents.ts        the six Rig agents (s.* input/output schemas, repair + steering + timeout addons)
  context.ts       git diff/log, file tree, test runner, secret scan, npm audit, semgrep/gitleaks
  render.ts        JSON -> Markdown reports
  engine.ts        engine selection
  engines/cursor.ts  Rig AgentFactory for the Cursor CLI
  engines/mock.ts    offline engine
  cli.ts           commands, report writing, CI gating
templates/         files copied by `sdlc init` (.cursor/, .github/)
test/              node:test suite (runs offline with the mock engine)
```

## Extending

Add a stage by defining another agent in `src/agents.ts`:

```ts
const adr = agent({
  ...common,
  name: "adr",
  instructions: "Write an Architecture Decision Record for the proposed change.",
  input: s.object({ plan: s.string }),
  output: s.object({ title: s.string, context: s.string, decision: s.string, consequences: s.array(s.string) }),
});
```

then a renderer in `render.ts` and a `case` in `cli.ts`.

## Notes

- Rig is pre-1.0 (pinned to `v0.0.8`); its API may change between versions.
- Rig ships TypeScript sources, so the CLI loads through `tsx` (`bin/sdlc.mjs`).
- Findings are model output: verify them before acting, and keep humans on the merge button.

## Development

```bash
npm test          # offline, uses the mock engine and a fake Cursor CLI
npm run typecheck
```
