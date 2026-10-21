# Technical plan: Claude Code and Codex support for sdlc-rig

Oct 20, 2026 · @io

Adds Claude Code and Codex support to sdlc-rig. Phases 1 to 3 need no new dependencies. The MCP server in phase 4 is optional.

## Decisions to confirm first

1. **Scope:** templates and `init` only (phases 1 to 3), or also the MCP server (phase 4)?
2. **`init` default:** keep Cursor-only when no flag is given, or install for every tool detected in the repo?
3. **Claude Code auth:** `sdlc` calls the Anthropic API itself, so Claude Code users need `ANTHROPIC_API_KEY`. A Claude Code subscription alone won't cover it. Is that acceptable?

## Phases 1 to 3: templates, init and engine-neutral commands

**Phase 1, templates.** Add these files under `templates/`:

- `.claude/commands/sdlc-{stories,plan,review,test,security,release,pr}.md`, mirroring the Cursor commands but calling `npx sdlc <stage>` with no `--engine` flag, so the engine comes from `SDLC_ENGINE`.
- `.claude/sdlc.md`, referenced from `CLAUDE.md` with `@.claude/sdlc.md`. `init` skips existing files, so a repo that already has a `CLAUDE.md` would otherwise get nothing.
- `AGENTS.md` for Codex, using the managed-block approach in phase 2.
- `.codex/prompts/sdlc-*.md` for Codex slash commands. Check the current Codex docs first, since custom prompts may have moved to skills.

Keep the Cursor templates unchanged so existing users see no difference.

**Phase 2, `init` in `src/cli.ts`.**

- Add `--tool cursor|claude|codex|all` to the options (around line 63) and the usage text (line 39).
- Tag each template by tool using its path prefix. Shared files such as `.github/workflows/sdlc.yml` always install.
- For `AGENTS.md` and `CLAUDE.md`, write content between `<!-- sdlc:start -->` and `<!-- sdlc:end -->` markers. Replace only the block, and create the file if it is missing. This is idempotent and keeps the user's content.
- Keep skip-if-exists for command files, and keep `--force` as the overwrite switch.
- Verify that the `build-binary.ts` glob and `listFiles` include dot-folders such as `.claude/` and `.codex/`.

**Phase 3, engine-neutral behavior.** New templates must not name an engine. Optionally, `init` warns when the chosen tool's CLI or key is missing, for example `codex` without `codex login` or `OPENAI_API_KEY`.

## Phase 4 (optional): MCP server

1. **Entry point:** add `src/mcp.ts` and a `bin/sdlc-mcp.mjs` launcher, or a `sdlc mcp` subcommand. The subcommand is simpler because it reuses the existing binary.
2. **Dependency:** add `@modelcontextprotocol/sdk` with the stdio transport. Check that it bundles with Bun for the standalone binary.
3. **Tools:** `sdlc_stories`, `sdlc_plan`, `sdlc_review`, `sdlc_test`, `sdlc_security`, `sdlc_release`, `sdlc_pr`. Each takes the same inputs as its CLI command and returns the parsed JSON report plus the report path.
4. **Implementation:** spawn the CLI as a child process with `--json` first. This avoids refactoring `cli.ts`. A later refactor can return results directly.
5. **Timeouts:** each agent can run up to 300 seconds, and `pr` takes longer. Document this and check how each client handles long tool calls.
6. **Registration:** `init --tool claude` writes `.mcp.json`, and Cursor gets `.cursor/mcp.json`. Codex is user-level (`~/.codex/config.toml`, `[mcp_servers.sdlc]`), so document it rather than having `init` write it.
7. **Safety:** tools use the same Node-side context gathering and secret redaction, so behavior matches the CLI.

## Phases 5 and 6: tests and documentation

**Tests**

- `test/cli.test.ts`: `init` with no flag keeps current output. `init --tool claude` installs only the Claude files, and `init --tool codex` only the Codex files. Managed blocks are idempotent, and `--force` refreshes them.
- A test that every template referenced by the grouping exists.
- `test/mcp.test.ts` (phase 4 only): stdio handshake, `tools/list`, and one tool call against the mock engine.
- Run `npm test` and `npm run typecheck`. Tests run offline with the mock engine.

**Docs**

- README: add "Using it in Claude Code" and "Using it in Codex" sections, update the `init` row in the command table, and drop the Cursor-only wording.
- Add a note to the engine table on which engine each client should use.

## Risks

| Risk | Mitigation |
| --- | --- |
| Claude Code users pay API usage on top of their subscription | Say so in the README and in `init` output |
| Codex prompt or config formats change | Pin templates to the tested version and check docs before release |
| Standalone binary grows with the MCP SDK (today about 60 to 85 MB) | Measure the binary size after phase 4 |
| Users edit inside managed blocks and lose changes on `--force` | Document that the markers are owned by `sdlc` |

## Rough sizing

- Phases 1 to 3 and 5 (templates, `init`, tests): about 1 to 2 days.
- Phase 4 (MCP server): about 1 to 2 more days, plus testing with each client.

Estimates assume the repo's current structure and no changes to the Rig dependency.
