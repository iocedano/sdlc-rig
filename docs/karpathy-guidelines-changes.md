# Karpathy coding guidelines: changes summary

Branch: `feat-karpaty-guidelines` (commits `bf4f686`, `7e1b274`)
Source of guidelines: [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT)

## Why

The four Karpathy principles target common LLM coding mistakes: hidden assumptions, over-building, drive-by edits, and unverified work. The sdlc agents plan, review and test code, so they were the places to apply them. The Claude Code and Cursor sessions in this repo write code, so they get the same guidance as rules.

## The four principles

1. **Think before coding.** Don't assume, don't hide confusion, surface tradeoffs.
2. **Simplicity first.** Minimum code that solves the problem.
3. **Surgical changes.** Touch only what the request requires. Clean up only your own mess.
4. **Goal-driven execution.** Turn each task into a verifiable goal.

## Changes

### Agent prompts (`src/agents/`)

| Agent | Change | Principle |
|---|---|---|
| `stories.ts` | With several readings of an idea, pick the narrowest one that delivers value, record the others as assumptions, and raise decisions in open questions. Each acceptance criterion must be checkable by a test. | Think before coding, goal-driven |
| `plan.ts` | No new abstraction, layer, service or dependency unless the stories require it. Lists alternatives with tradeoffs and states the chosen interpretation plus assumptions. Keeps each task to the files it needs. Every task gets a `verification` step. | Simplicity, think before coding, surgical, goal-driven |
| `review.ts` | Infers the change's purpose from commit messages before judging scope. New `scope` category for unrelated edits, capped at `minor`. Raises no scope findings when intent is unclear. Speculative abstractions flagged under maintainability, capped at `minor`. Dead code is mentioned, not deleted. | Surgical, simplicity |
| `tests.ts` | Every missing test ties to a behavior the diff introduces. Bug fixes start with a regression test that fails before the fix. Sketches stay minimal. | Goal-driven, simplicity |

Security, inception and release agents are unchanged.

### Output and rendering (`src/render.ts`)

- Plan schema gains `assumptions` (array) and `alternatives` (array). Each task gains `verification` (string).
- The plan report renders new "Assumptions" and "Alternatives considered" sections and a `Verify:` line under each task.
- The review schema's `category` enum gains `scope`. The severity gate is unchanged.

### Claude Code

- `CLAUDE.md`: new "Coding guidelines" section that imports `.claude/skills/karpathy-guidelines/SKILL.md`. It sits outside the `sdlc:start`/`sdlc:end` block that `sdlc init` manages.
- `.claude/skills/karpathy-guidelines/SKILL.md`: the skill, with the four principles and the success signs.

### Cursor

- `.cursor/rules/karpathy-guidelines.mdc`: the same principles with `alwaysApply: true`, so it loads in every Cursor chat. The existing `sdlc.mdc` rule is `alwaysApply: false`.

### Commit `7e1b274` also includes (not part of the guidelines work)

- `.gitignore`: root-anchors `/.cursor` and `/.claude`.
- `templates/.claude/agents/inception.md`, `templates/.claude/commands/sdlc-inception.md`, `templates/.cursor/commands/sdlc-inception.md`, `templates/.cursor/mcp.json`: inception template files.

## Known gaps

- `.cursor/` and `.claude/` are gitignored, so `.claude/skills/karpathy-guidelines/SKILL.md` and `.cursor/rules/karpathy-guidelines.mdc` are not in the commit. The `CLAUDE.md` import will point to a missing file for anyone who clones the branch. Fix by un-ignoring these paths or force-adding the two files.
- The Cursor rule is not in `templates/`, so `sdlc init` won't install it in other repos.
- The scope check relies on commit messages to infer intent. Vague messages mean fewer scope findings, by design.

## Verification

- `npm run typecheck`: passes.
- `npm test` in the repo's own working copy fails before and after these changes. `node_modules` was installed on macOS, so esbuild's native binary doesn't match. Run in a fresh Linux install of a copy of the repo, all 30 tests pass.
- A render check confirms the plan report includes the Assumptions, Alternatives and Verify sections.
- Not yet done: real model runs comparing old and new prompts on a sample diff. Needed to confirm the scope rule catches real drive-by edits without false positives.

## Suggested PR

**Title:** `feat: add Karpathy coding guidelines to sdlc agents and rules`

**Description:** see the PR description section below.

---

## PR description

### Summary

Applies Andrej Karpathy's four coding guidelines (think before coding, simplicity first, surgical changes, goal-driven execution) to the sdlc agents and to the Claude Code and Cursor setup in this repo.

### Changes

- **Agent prompts:** `stories`, `plan`, `review` and `tests` now surface assumptions, prefer simple designs, keep changes scoped, and tie tasks and tests to verifiable goals.
- **Plan report:** new `assumptions` and `alternatives` fields, and a `verification` step per task.
- **Review:** new `scope` category for unrelated edits, capped at `minor` so it can't fail the gate on its own.
- **Claude Code:** `CLAUDE.md` imports the Karpathy skill.
- **Cursor:** `.cursor/rules/karpathy-guidelines.mdc` with `alwaysApply: true`.

### Reviewer notes

- The `.gitignore` change and the `templates/` inception files in `7e1b274` are unrelated to the guidelines. Split them out or confirm they belong in this PR.
- `.claude/skills/karpathy-guidelines/SKILL.md` and `.cursor/rules/karpathy-guidelines.mdc` are gitignored and not committed. Until they're added, the `CLAUDE.md` import is broken for other clones.
- Scope and simplicity findings are capped at `minor` by design, so they don't block CI.

### Testing

- `npm run typecheck` passes.
- All 30 tests pass in a clean Linux install of the branch.
- Plan render check passes for the new sections.
- Not yet run: real model comparisons of old and new prompts.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01HRv4pWzWJrjaHhVTYkcx5T
