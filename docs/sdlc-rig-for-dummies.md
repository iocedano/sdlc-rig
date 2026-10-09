# sdlc-rig for Dummies: Your Friendly Dojo Guide 🥋

Oct 9, 2026

## 1. Welcome to the dojo

Welcome, young grasshopper! By the end of this guide you will install sdlc-rig, run your first AI code review in under 10 minutes, and wire it into Cursor and GitHub. No black belt needed. We go one step at a time, and every step has a way to check you did it right.

**What is sdlc-rig?** A command-line tool that gives you an AI teammate for each stage of the software development life cycle (SDLC): writing user stories, planning the design, reviewing code, checking tests, scanning for security problems, and writing release notes.

**What is Rig?** [Rig](https://github.com/githubnext/rig) is a small TypeScript library from GitHub Next for building AI agents. Each agent has a typed input, a typed output (a JSON schema), and instructions. If the AI answers with broken JSON, Rig asks it to fix the answer. That is why sdlc-rig's reports are always well structured.

**What is an engine?** The AI brain behind the agents. sdlc-rig can use Cursor, Claude (Anthropic), Codex (OpenAI), Gemini, GitHub Copilot, or a pretend brain called `mock` for practice.

**How to read this guide:**

- Sections 2 to 5 are your first training session. Do them in order.
- Section 6 explains every command, with examples.
- Sections 7 and 8 connect the tool to Cursor and GitHub.
- Sections 9 to 12 are reference: cheat sheet, troubleshooting, tips and extending.

> Sensei says: you do not need to understand everything today. Run the commands, look at the reports, and the understanding will follow.

## 2. Belt check: what you need first

You need three tools on your machine and one AI account. Run each check command; if you see a version number, you pass.

| Tool | Why | Check command | Pass looks like |
| --- | --- | --- | --- |
| Node.js 20 or newer (22 LTS recommended) | Runs sdlc-rig | `node --version` | `v22.x.x` |
| npm | Installs packages | `npm --version` | `10.x.x` |
| git | sdlc-rig reads your diffs and history | `git --version` | `git version 2.x` |
| An AI engine account | The brain (section 4) | — | Optional for the practice run |

**Missing Node?** Install it with [nvm](https://github.com/nvm-sh/nvm) (macOS/Linux) or [nvm-windows](https://github.com/coreybutler/nvm-windows), then run `nvm install 22` and `nvm use 22`. nvm lets you switch Node versions per project without admin rights.

**On Windows?** Use WSL (Windows Subsystem for Linux) or Git Bash. The commands in this guide are written for a Bash-style terminal.

**Optional power-ups for the security stage** (sdlc-rig uses them only if they are installed):

- [semgrep](https://semgrep.dev/docs/getting-started/) for static code analysis: `pip install semgrep` or `brew install semgrep`.
- [gitleaks](https://github.com/gitleaks/gitleaks) for secret scanning: `brew install gitleaks`.
- [govulncheck](https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck) for Go projects: `go install golang.org/x/vuln/cmd/govulncheck@latest`.

> Coach tip: skip the power-ups on day one. Come back for them once the basics feel easy.

## 3. Installation, step by step

Four steps and about three minutes. After each one, the check tells you it worked.

1. **Unzip the project** somewhere you keep code, for example `~/code/sdlc-rig`.
   - Check: `ls ~/code/sdlc-rig` shows `bin`, `src`, `templates`, `package.json`.
2. **Install the dependencies.** This downloads Rig from GitHub and the AI SDKs.
   - `cd ~/code/sdlc-rig && npm install`
   - Check: it ends with `found 0 vulnerabilities` and a `node_modules` folder appears.
3. **Make `sdlc` a command you can run anywhere.**
   - `npm link`
   - Check: `sdlc --help` prints the list of commands.
4. **Run the self-test** to prove everything is healthy.
   - `npm test`
   - Check: `# pass 8` and `# fail 0`. These tests use the mock engine, so no API key is needed.

**Two ways to use it in your own projects:**

| Option | Command | Then you run | Best for |
| --- | --- | --- | --- |
| Global (via `npm link`) | `npm link` in the sdlc-rig folder | `sdlc review` | Trying it on many repos |
| Per project (dev dependency) | `npm i -D github:<your-user>/sdlc-rig` | `npx sdlc review` | Teams and CI, everyone gets the same version |

For the per-project option, first push sdlc-rig to your own GitHub repository (`git remote add origin …` then `git push -u origin main`).

> Sensei says: if `sdlc: command not found` appears after `npm link`, your npm global folder is not in your PATH. Run `npm prefix -g` and add its `bin` folder to PATH, or simply use `npx sdlc` from inside the project.

## 4. Choose your engine (the brain)

Start with `mock` to practice for free, then pick one real engine. Cursor users: choose `cursor`. Everyone else: `anthropic` is the simplest to set up.

| Engine | What you need | One-time setup | Default model |
| --- | --- | --- | --- |
| `mock` | Nothing | None | Placeholder answers |
| `cursor` | Cursor account + Cursor CLI | `curl https://cursor.com/install -fsS \| bash` then `agent login` | Your Cursor default |
| `anthropic` | Anthropic API key | `export ANTHROPIC_API_KEY=sk-ant-...` | `claude-sonnet-4-5` |
| `codex` | OpenAI key or Codex login | `export OPENAI_API_KEY=sk-...` | Codex default |
| `gemini` | Gemini CLI installed and logged in | `npm i -g @google/gemini-cli` then `gemini` | `gemini-2.5-pro` |
| `copilot` | GitHub Copilot SDK server | See the Rig README | Copilot default |

**Telling sdlc-rig which engine to use** (the first one found wins):

1. A flag on the command: `sdlc review --engine cursor --model gpt-5`
2. Environment variables: `export SDLC_ENGINE=anthropic` and optionally `export SDLC_MODEL=claude-sonnet-4-5`
3. Nothing set: Rig picks automatically from the API keys it finds.

**Keep your settings in one place.** sdlc-rig reads environment variables, not a `.env` file. Two easy habits:

- Add the `export` lines to your `~/.zshrc` or `~/.bashrc`, then open a new terminal.
- Or use [direnv](https://direnv.net/): put the exports in an `.envrc` file per project and run `direnv allow`.

> Sensei warning: an API key is like the key to your house. Never commit it to git, never paste it into a ticket, and add `.envrc` and `.env` to `.gitignore`. If one leaks, revoke it in the provider's dashboard right away.

## 5. Your first kata: a practice run

A kata is a practice routine. In this one you build a tiny repo, make a change with a planted mistake, and watch sdlc-rig catch it. Copy each block into your terminal.

**Step 1. Create a practice dojo repo**

```bash
mkdir ~/dojo && cd ~/dojo
git init -b main
echo '# Dojo' > README.md
echo 'export const add = (a, b) => a + b;' > math.js
git add . && git commit -m "feat: first move"
```

**Step 2. Make a change on a branch, with a planted bug and a fake secret**

```bash
git checkout -b feature/divide
cat >> math.js <<'EOF'
export const divide = (a, b) => a / b; // no check for b === 0
const apiKey = "AKIAABCDEFGHIJKLMNOP";   // fake AWS key, for practice only
EOF
git commit -am "feat: add divide"
```

**Step 3. Warm up with the mock engine (free, offline)**

```bash
sdlc review --base main --engine mock
```

You will see a report full of `(mock …)` placeholders. That is correct: it proves the plumbing works. The report is also saved in `.sdlc/reports/review.md`.

**Step 4. The real fight: use a real engine**

```bash
sdlc review   --base main --engine anthropic   # or --engine cursor
sdlc security --base main --engine anthropic
```

What a good result looks like:

- The review flags division by zero in `math.js` and suggests a guard.
- The security report flags a hard-coded AWS key, shows it redacted as `AKIA…`, and tells you to rotate it.

**Step 5. Read the reports**

```bash
ls .sdlc/reports/
cat .sdlc/reports/review.md
```

Each command writes two files: a `.md` for humans and a `.json` for scripts.

> Coach says: great work! You just ran an AI code review and a security scan. That is your first belt. Add `.sdlc/` to your project's `.gitignore` so reports are not committed by accident.

## 6. The seven techniques

Each command is one technique. They follow the life of a feature: idea, design, code, check, ship. You can use any one alone.

```mermaid
flowchart LR
    A["sdlc stories<br/>idea → user stories"] --> B["sdlc plan<br/>stories → design + tasks"]
    B --> C["You write the code<br/>with Cursor or your editor"]
    C --> PR
    subgraph PR["sdlc pr: three checks in parallel, the CI gate"]
        R["sdlc review<br/>bugs and fixes"]
        T["sdlc test<br/>failures and gaps"]
        S["sdlc security<br/>secrets, OWASP"]
    end
    PR --> REL["sdlc release<br/>version + release notes"]
```

Planning happens once per feature; the three checks in the box run on every change, together as `sdlc pr`.

### Technique 1: `stories` — turn an idea into user stories

```bash
sdlc stories "Let restaurant owners mark menu items as sold out from their phone"
sdlc stories --file docs/requirements.md      # longer requirements in a file
```

You get an epic, stories in the form "As a … I want … so that …", Given/When/Then acceptance criteria, MoSCoW priority (must, should, could, won't) and T-shirt estimates (XS to XL).

Look for the **Open questions** list. Answer those with your product owner before planning. Unanswered questions become bugs later.

### Technique 2: `plan` — design it before you build it

```bash
sdlc plan "Sold-out toggle for menu items"
```

The plan reads your real file tree plus key files (README, package.json, go.mod, Dockerfile), so it names real paths. If `stories.json` exists from Technique 1, it is used automatically.

Look for tasks small enough for one day each, the **Depends on** column (what to build first) and the **Risks** list.

### Technique 3: `review` — a second pair of eyes

```bash
sdlc review                 # your uncommitted changes vs the last commit
sdlc review --base main     # the whole branch vs main, like a pull request
```

Findings come sorted by severity: blocker, major, minor, nit. Each one names a file and line and suggests a fix. Fix blockers first; treat nits as optional.

### Technique 4: `test` — run the tests and find the gaps

```bash
sdlc test                         # auto-detects npm test, go test or pytest
sdlc test --cmd "npm run test:unit" --base main
```

If tests fail, you get the likely root cause of each failure and a suggested fix. You also get sketches of tests that are missing for the code you changed.

### Technique 5: `security` — guard the castle

```bash
sdlc security --base main
sdlc security --base main --compliance "HIPAA,SOC 2"
```

It combines four signals: a secret scan of added lines, a dependency audit (`npm audit` or `govulncheck`), semgrep and gitleaks if installed, and an AI review against the OWASP Top 10. Findings carry CWE ids (the standard name for a weakness type) so you can look them up. With `--compliance`, you also get notes on the controls your change touches, such as encryption, audit logging and access control.

### Technique 6: `release` — tell the world what changed

```bash
sdlc release                 # since the latest git tag
sdlc release --from v1.2.0   # since a specific tag
```

You get a semantic version bump (major for breaking changes, minor for features, patch for fixes) and release notes written for users, grouped into features, fixes, breaking changes and security.

Tip: this works best with [Conventional Commits](https://www.conventionalcommits.org/) such as `feat: add divide` and `fix: guard divide by zero`.

### Technique 7: `pr` — the full kata before a pull request

```bash
sdlc pr --base main
sdlc pr --base main --fail-on high   # exit code 1 if anything high or worse, or tests fail
```

Runs review, test and security at the same time and writes one combined `pr.md`. This is the command CI uses.

**Useful flags on every command:** `--json` prints JSON instead of Markdown, `--out <dir>` changes where reports go, and `--engine` / `--model` override your defaults.

## 7. Training inside Cursor

In Cursor, sdlc-rig produces the structured report and Cursor's agent helps you apply the fixes, always asking before it edits. Setup takes about five minutes.

1. **Install the Cursor CLI** (separate from the editor):
   - macOS / Linux / WSL: `curl https://cursor.com/install -fsS | bash`
   - Windows PowerShell: `irm 'https://cursor.com/install?win32=true' | iex`
   - Check: `agent --version` prints a version. Older installs call it `cursor-agent`; if so, run `export CURSOR_AGENT_BIN=cursor-agent`.
2. **Log in once:** `agent login` (opens your browser). Check with `agent status`.
3. **Add the Cursor files to your project:** open a terminal in your project folder and run `sdlc init`.
   - Check: you now have `.cursor/commands/` with seven `sdlc-*.md` files, `.cursor/rules/sdlc.mdc`, and `.github/workflows/sdlc.yml`.
   - Existing files are never overwritten. Use `sdlc init --force` only if you want to replace them.
4. **Reload Cursor** so it picks up the new commands.
5. **Try it:** in the Cursor chat, type `/` and choose `sdlc-review`.

**The slash commands:**

| Type in Cursor chat | What happens |
| --- | --- |
| `/sdlc-stories add a loyalty points program` | Stories for that idea, then Cursor asks you the open questions |
| `/sdlc-plan loyalty points` | Technical plan, then offers to start task T-1 |
| `/sdlc-review` | Reviews your changes, walks you through each blocker and proposes edits |
| `/sdlc-test` | Runs tests, fixes the root cause of failures, offers missing tests |
| `/sdlc-security HIPAA` | Security review with HIPAA notes; reminds you to rotate leaked secrets |
| `/sdlc-release` | Release notes; adds them to CHANGELOG.md only if you approve |
| `/sdlc-pr` | Go / no-go summary before you open a pull request |

**If headless runs hang** waiting for a "trust this workspace" prompt, run `export CURSOR_AGENT_ARGS="--trust"` and try again.

> Sensei says: the slash commands are plain Markdown files. Open `.cursor/commands/sdlc-review.md` and change the wording to match how your team works. That is the fastest way to make the tool truly yours.

## 8. Guarding the gate: GitHub Actions

Once set up, every pull request gets an automatic SDLC report as a comment, and merging is blocked when there are critical findings or failing tests.

1. **Add sdlc-rig to the project** so CI can install it: `npm i -D github:<your-user>/sdlc-rig`, then commit `package.json` and `package-lock.json`.
2. **Add the workflow:** `sdlc init` already created `.github/workflows/sdlc.yml`. Commit and push it.
3. **Add your key as a secret:** GitHub repo → Settings → Secrets and variables → Actions → **New repository secret**.
   - Name `ANTHROPIC_API_KEY` (or `CURSOR_API_KEY` if you use Cursor).
4. **Optional variables** on the same page, **Variables** tab:

   | Variable | Example | Effect |
   | --- | --- | --- |
   | `SDLC_ENGINE` | `cursor` | Engine for CI (default `anthropic`) |
   | `SDLC_MODEL` | `claude-sonnet-4-5` | Override the model |
   | `SDLC_COMPLIANCE` | `HIPAA,SOC 2` | Compliance focus for the security stage |

5. **Open a test pull request.** Within a few minutes the bot posts a comment titled "SDLC report". New pushes update the same comment instead of adding new ones.
6. **Make it a required check** (recommended): Settings → Branches → add a branch protection rule for `main` → require the **SDLC review** status check.

**Choosing how strict the gate is.** The workflow runs `sdlc pr --fail-on critical`. Edit that flag in `sdlc.yml`:

| `--fail-on` | Blocks the merge when | Good for |
| --- | --- | --- |
| `none` | Never (report only) | The first week, while the team learns it |
| `critical` | A blocker or critical finding, or failing tests | Most teams (default) |
| `high` | Also major and high findings | Regulated or security-sensitive code |
| `medium` | Also minor and medium findings | Very strict teams; expect more noise |

> Coach tip: start with `none` for a week. Let people see the comments without being blocked, then raise the bar. Trust is built, not forced.

## 9. Cheat sheet

Print this page or pin it next to your monitor.

**Commands**

| Command | Key options | Report file |
| --- | --- | --- |
| `sdlc stories "<idea>"` | `--file <path>` | `stories.md` / `.json` |
| `sdlc plan "<feature>"` | `--file <path>`, `--stories <path>` | `plan.md` / `.json` |
| `sdlc review` | `--base <branch>` | `review.md` / `.json` |
| `sdlc test` | `--base`, `--cmd "<command>"` | `tests.md` / `.json` |
| `sdlc security` | `--base`, `--compliance <list>` | `security.md` / `.json` |
| `sdlc release` | `--from <tag>`, `--version <x.y.z>` | `release.md` / `.json` |
| `sdlc pr` | `--base`, `--cmd`, `--compliance` | `pr.md` / `.json` |
| `sdlc init` | `--force` | Adds `.cursor/` and `.github/` files |

**Options for every command:** `--engine <name>`, `--model <id>`, `--out <dir>` (default `.sdlc/reports`), `--json`, `--fail-on <none|critical|high|medium>`, `-h` / `--help`.

**Environment variables**

| Variable | Default | What it does |
| --- | --- | --- |
| `SDLC_ENGINE` | `auto` | Which engine to use |
| `SDLC_MODEL` | Per engine | Which model to use |
| `SDLC_TEST_CMD` | Auto-detected | Test command for `test` and `pr` |
| `SDLC_COMPLIANCE` | Empty | Compliance focus for `security` |
| `SDLC_MAX_DIFF_CHARS` | `120000` | Cut diffs longer than this |
| `SDLC_TIMEOUT_MS` | `300000` (5 min) | Time limit per agent |
| `CURSOR_AGENT_BIN` | `agent` | Name of the Cursor CLI binary |
| `CURSOR_AGENT_ARGS` | Empty | Extra Cursor CLI flags, e.g. `--trust` |
| `RIG_DEBUG` | Off | Debug logs, e.g. `RIG_DEBUG=agent` |

**Exit codes:** `0` success, `1` the `--fail-on` gate was reached, `2` an error (message printed in the terminal).

## 10. When you fall down: troubleshooting

Every black belt has fallen a thousand times. Find your error message in the left column.

| You see | Why | Fix |
| --- | --- | --- |
| `sdlc: command not found` | npm's global bin folder is not in PATH | Run `npm link` again, add `$(npm prefix -g)/bin` to PATH, or use `npx sdlc` |
| `"review" must run inside a git repository` | You are not in a git project | `cd` into your project, or run `git init` |
| Review says there is nothing to review | No changes found | Make a change, or pass `--base main` to compare the whole branch |
| `Cursor CLI "agent" not found` | Cursor CLI missing or named differently | Install it (section 7) or `export CURSOR_AGENT_BIN=cursor-agent` |
| Cursor run hangs forever | Waiting for a workspace trust prompt | `export CURSOR_AGENT_ARGS="--trust"` |
| `401`, `authentication` or `invalid x-api-key` | Missing or wrong API key | Check `echo $ANTHROPIC_API_KEY` in the same terminal; re-export it |
| `Unknown engine "…"` | Typo in `--engine` or `SDLC_ENGINE` | Use one of: auto, cursor, anthropic, codex, gemini, copilot, mock |
| `Cannot find module '@openai/codex-sdk'` | Optional Codex SDK not installed | `npm i @openai/codex-sdk` in the sdlc-rig folder |
| `Timed out after 300000ms` | Big diff or slow model | `export SDLC_TIMEOUT_MS=600000`, or review a smaller branch |
| Report says `diff truncated` | Diff bigger than the limit | Review in smaller pieces, or raise `SDLC_MAX_DIFF_CHARS` (costs more) |
| Report is all `(mock …)` | You are on the mock engine | Pass `--engine anthropic` or `--engine cursor`, or unset `SDLC_ENGINE` |
| CI comment never appears | Workflow lacks permission or secret | Check the Actions log; confirm the secret name and `pull-requests: write` |
| Lockfile or rig install fails in CI | Rig is fetched from GitHub | Check that Actions can reach github.com, then rerun the job |

**Still stuck? Turn on the lights:**

```bash
RIG_DEBUG=agent sdlc review --base main
```

This prints every prompt and response as JSON lines in the terminal, so you can see exactly what the AI received and returned.

## 11. Sensei wisdom: habits of a black belt

The tool is the sword; your judgment is the hand that holds it. These habits make the difference.

**A daily routine that works**

1. Morning, new feature: `sdlc stories`, answer the open questions, then `sdlc plan`.
2. While coding, before each commit: `sdlc review` on your uncommitted changes. Small diffs give sharper reviews.
3. Before opening a pull request: `sdlc pr --base main`.
4. Release day: `sdlc release`, edit the notes, then tag.

**Judgment**

- Treat every finding as a suggestion from a smart colleague who has not seen the whole codebase. Verify it in the code before changing anything.
- The AI can be confidently wrong. A clean report does not mean the code is correct; it means nothing obvious was found.
- Humans stay on the merge button. The CI gate catches problems; people decide.

**Security**

- sdlc-rig redacts secrets it recognizes before sending diffs to a model, but its patterns cannot catch every secret. Keep secrets in a vault or environment variables, never in code.
- A leaked key must be rotated, not just deleted. It stays in git history.
- For confidential code, check your company's AI policy first, and prefer an engine your company has approved.
- For health or payment data, add `--compliance HIPAA` or `--compliance PCI-DSS`, and still involve your security team. AI notes are not an audit.

**Saving time and money**

- Practice and wire up CI with `--engine mock`; it costs nothing.
- Review small branches. Cost grows with diff size, and huge diffs are cut at 120,000 characters anyway.
- `sdlc pr` runs three agents. On large repos, run only the step you need.
- Use a smaller, cheaper model for everyday reviews and a stronger one for security: `sdlc security --model <bigger-model>`.

**Team adoption**

- Commit the `.cursor/` folder so the whole team shares the same slash commands.
- Start CI with `--fail-on none` for a week, then move to `critical`.
- Collect the false positives people complain about and turn them into rules in the agent instructions (section 12).

## 12. Level up: make it your own

When the basics feel easy, teach the tool your team's style. You will touch three files.

**Where things live**

| File | What it holds | Change it to |
| --- | --- | --- |
| `src/agents.ts` | The six agents: instructions + input/output schemas | Add your team's rules, or a new agent |
| `src/render.ts` | Turns each agent's JSON into Markdown | Change how reports look |
| `src/cli.ts` | Commands, flags, report saving, CI gate | Add a new command |
| `src/context.ts` | Collects diffs, tests, scanner output | Feed the agents more context |
| `templates/` | Files copied by `sdlc init` | Change the Cursor commands or CI workflow |

**Kata: teach the reviewer your rules.** In `src/agents.ts`, find the `review` agent and add lines to its instructions:

```ts
instructions: `You are a meticulous senior reviewer. Review ONLY the provided diff.
- In NestJS code, controllers must not call the database directly; use a service.
- Every new endpoint needs input validation with class-validator DTOs.
...`,
```

**Kata: add a new technique, an ADR writer.** An ADR (Architecture Decision Record) is a short note explaining why a design decision was made.

1. Define the agent in `src/agents.ts`, inside `createAgents`, and add `adr` to the returned object:

   ```ts
   const adr = agent({
     ...common,
     name: "adr",
     instructions: "Write an Architecture Decision Record for the proposed change.",
     input: s.object({ plan: s.string }),
     output: s.object({
       title: s.string,
       context: s.string,
       decision: s.string,
       consequences: s.array(s.string),
     }),
   });
   ```

2. Add a `case "adr":` in the `switch` in `src/cli.ts` that reads `plan.json`, calls `agents.adr({ plan })`, and saves the result with `emit(...)`.
3. Run `npm run typecheck` and `npm test`. If both pass, your new technique is ready.

The `s.*` helpers define the shape of the answer (`s.string`, `s.int`, `s.enum("a", "b")`, `s.array(...)`, `s.object({...})`). Rig shows that shape to the model and rejects answers that do not match.

**Glossary**

| Term | Meaning |
| --- | --- |
| SDLC | Software development life cycle: plan, design, build, test, release |
| Agent | An AI worker with instructions and a fixed input and output shape |
| Engine | The AI provider that powers the agents |
| Schema | The exact shape of data an agent must return |
| Diff | The lines that changed between two versions of code |
| Base branch | What your changes are compared against, usually `main` |
| CWE | Common Weakness Enumeration: standard ids for security weaknesses |
| OWASP Top 10 | The ten most common web application security risks |
| SemVer | Semantic versioning: MAJOR.MINOR.PATCH |
| Headless | Running a tool without its user interface, from scripts |

**Your next belts**

- [ ] Finish the practice kata in section 5 with a real engine
- [ ] Run `sdlc init` in a real project and try `/sdlc-review` in Cursor
- [ ] Turn on the GitHub Actions workflow with `--fail-on none`
- [ ] Add one of your team's rules to the reviewer
- [ ] Build your own technique (the ADR kata)

> Final words from sensei: the goal is not to let the AI write your software. The goal is to never ship the mistakes you could have caught. Practice daily, stay curious, and enjoy the path. Now go train!
