import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { createAgents } from "./agents.ts";
import {
  dependencyAudit,
  detectTestCommand,
  diffContext,
  externalScanners,
  isGitRepo,
  latestTag,
  readOptional,
  redactSecrets,
  releaseContext,
  repoSnapshot,
  runTests,
  scanDiffForSecrets,
} from "./context.ts";
import { loadProjectEnv } from "./dotenv.ts";
import { EMBEDDED_TEMPLATES } from "./embedded-templates.ts";
import { ENGINES, resolveEngineConfig, setupEngine } from "./engine.ts";
import { renderPlan, renderRelease, renderReview, renderSecurity, renderStories, renderTests } from "./render.ts";

const HELP = `sdlc — AI SDLC assistant built on Rig

Usage: sdlc <command> [options]

Commands
  stories <idea> | --file req.md     Requirements -> epic + user stories with acceptance criteria
  plan <feature> | --file spec.md    Technical design + task breakdown grounded in this repo
  review   [--base main]             Code review of the diff
  test     [--base main] [--cmd ..]  Run tests, explain failures, propose missing tests
  release  [--from v1.2.0]           Version bump + release notes since the last tag
  security [--base main] [--compliance HIPAA,PCI]
                                     Secure code review (secrets, deps, OWASP, compliance)
  pr       [--base main]             review + test + security in parallel (for CI)
  init     [--force] [--tool <t>]    Add agent commands/rules and a GitHub Actions workflow to this repo
                                     --tool cursor (default) | claude | codex | all

Options
  --engine <${ENGINES.join("|")}>   default: $SDLC_ENGINE or auto
  --model <id>                      default: $SDLC_MODEL or per-engine default
  --out <dir>                       report directory (default .sdlc/reports)
  --json                            print JSON instead of Markdown
  --dotenv <path>                   load settings from this file instead of the project's .env
  --no-dotenv                       don't read .env files
  --fail-on <none|critical|high|medium>
                                    exit 1 when findings reach this level or tests fail (default none)
`;

const RANK: Record<string, number> = {
  blocker: 4, critical: 4, major: 3, high: 3, minor: 2, medium: 2, nit: 1, low: 1, info: 0,
};
const THRESHOLD: Record<string, number> = { none: Infinity, critical: 4, high: 3, medium: 2 };

const log = (msg: string) => process.stderr.write(`\x1b[2m[sdlc]\x1b[0m ${msg}\n`);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      engine: { type: "string" },
      model: { type: "string" },
      out: { type: "string", default: ".sdlc/reports" },
      json: { type: "boolean", default: false },
      file: { type: "string" },
      stories: { type: "string" },
      base: { type: "string" },
      cmd: { type: "string" },
      from: { type: "string" },
      version: { type: "string" },
      compliance: { type: "string" },
      "dotenv": { type: "string" },
      "no-dotenv": { type: "boolean", default: false },
      "fail-on": { type: "string", default: "none" },
      force: { type: "boolean", default: false },
      tool: { type: "string", default: "cursor" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (!command || values.help || command === "help") {
    process.stdout.write(HELP);
    return;
  }
  if (command === "init") return init(values.force, values.tool!);

  // Before anything reads settings: pull sdlc keys from the project's .env.
  if (!values["no-dotenv"]) {
    const env = loadProjectEnv({ envFile: values["dotenv"] });
    if (env.files.length) {
      const where = env.files.map((f) => relative(process.cwd(), f) || f).join(", ");
      log(`env: ${env.loaded.length ? env.loaded.join(", ") : "nothing new"} from ${where}${env.skipped ? ` (${env.skipped} non-sdlc keys ignored)` : ""}`);
    }
  }
  values.compliance ??= process.env["SDLC_COMPLIANCE"] ?? "";

  const failOn = values["fail-on"]!;
  if (!(failOn in THRESHOLD)) throw new Error(`--fail-on must be one of ${Object.keys(THRESHOLD).join(", ")}`);
  const engine = resolveEngineConfig(values.engine, values.model);
  await setupEngine(engine);
  const agents = createAgents(engine.model);
  log(`engine=${engine.engine} model=${engine.model}`);

  const outDir = values.out!;
  const emit = async (name: string, data: unknown, markdown: string) => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, `${name}.json`), JSON.stringify(data, null, 2));
    await writeFile(join(outDir, `${name}.md`), markdown);
    process.stdout.write(values.json ? JSON.stringify(data, null, 2) + "\n" : markdown);
    log(`saved ${join(outDir, name)}.md`);
  };

  const textArg = async () => {
    const text = values.file ? await readOptional(values.file) : rest.join(" ");
    if (!text.trim()) throw new Error(`"${command}" needs text or --file <path>`);
    return text;
  };

  if (["review", "test", "security", "pr", "release"].includes(command) && !(await isGitRepo())) {
    throw new Error(`"${command}" must run inside a git repository`);
  }

  // ---- individual steps (reused by `pr`) ----
  const doReview = async () => {
    const ctx = await diffContext(values.base);
    log(`review: ${ctx.changedFiles.length} changed files`);
    const result = await agents.review({ diff: redactSecrets(ctx.diff), changedFiles: ctx.changedFiles, commits: ctx.commits });
    return { result, markdown: renderReview(result), level: Math.max(0, ...result.findings.map((f) => RANK[f.severity] ?? 0)) };
  };

  const doTests = async () => {
    const ctx = await diffContext(values.base);
    const testCmd = values.cmd ?? process.env["SDLC_TEST_CMD"] ?? detectTestCommand();
    log(testCmd ? `test: running "${testCmd}"` : "test: no test command detected");
    const run = await runTests(testCmd);
    const result = await agents.tests({
      diff: redactSecrets(ctx.diff),
      changedFiles: ctx.changedFiles,
      testCommand: run.command,
      testExitCode: run.exitCode,
      testOutput: run.output,
    });
    return { result, markdown: renderTests(result, run.command), failed: run.ran && run.exitCode !== 0 };
  };

  const doSecurity = async () => {
    const ctx = await diffContext(values.base);
    const secretHits = scanDiffForSecrets(ctx.diff);
    log(`security: ${secretHits.length} possible secrets, running dependency audit and scanners`);
    const [audit, scanners] = await Promise.all([dependencyAudit(), externalScanners()]);
    const result = await agents.security({
      diff: redactSecrets(ctx.diff),
      changedFiles: ctx.changedFiles,
      secretHits,
      dependencyAudit: audit,
      scannerOutput: scanners,
      complianceFocus: values.compliance!,
    });
    return { result, markdown: renderSecurity(result), level: Math.max(0, ...result.findings.map((f) => RANK[f.severity] ?? 0)) };
  };

  let exitCode = 0;
  const gate = (level: number, testsFailed = false) => {
    if (level >= THRESHOLD[failOn]! || (testsFailed && failOn !== "none")) exitCode = 1;
  };

  switch (command) {
    case "stories": {
      const idea = await textArg();
      const result = await agents.stories({ idea, productContext: (await readOptional("README.md")).slice(0, 8000) });
      await emit("stories", result, renderStories(result));
      break;
    }
    case "plan": {
      const feature = await textArg();
      const storiesPath = values.stories ?? join(outDir, "stories.json");
      const stories = await readOptional(storiesPath);
      if (stories) log(`plan: using stories from ${storiesPath}`);
      const snap = await repoSnapshot();
      const result = await agents.plan({ feature, stories, fileTree: snap.tree, keyFiles: snap.keyFiles });
      await emit("plan", result, renderPlan(result));
      break;
    }
    case "review": {
      const r = await doReview();
      await emit("review", r.result, r.markdown);
      gate(r.level);
      break;
    }
    case "test": {
      const r = await doTests();
      await emit("tests", r.result, r.markdown);
      gate(0, r.failed);
      break;
    }
    case "security": {
      const r = await doSecurity();
      await emit("security", r.result, r.markdown);
      gate(r.level);
      break;
    }
    case "release": {
      const ctx = await releaseContext(values.from);
      const pkg = JSON.parse((await readOptional("package.json")) || "{}");
      const previousVersion = values.version ?? ((await latestTag()) || pkg.version || "0.0.0");
      const result = await agents.release({ previousVersion, commits: ctx.commits, diffStat: ctx.diffStat });
      await emit("release", result, renderRelease(result, ctx.since));
      break;
    }
    case "pr": {
      const [review, tests, security] = await Promise.all([doReview(), doTests(), doSecurity()]);
      const markdown = `<!-- sdlc-rig-report -->\n# 🤖 SDLC report\n\n${review.markdown}\n---\n\n${tests.markdown}\n---\n\n${security.markdown}`;
      await emit("pr", { review: review.result, tests: tests.result, security: security.result }, markdown);
      gate(Math.max(review.level, security.level), tests.failed);
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Run "sdlc --help".`);
  }
  if (exitCode) log(`failing: findings reached --fail-on ${failOn}`);
  process.exitCode = exitCode;
}

const INIT_TOOLS = ["cursor", "claude", "codex", "all"];
const BLOCK_START = "<!-- sdlc:start -->";
const BLOCK_END = "<!-- sdlc:end -->";

// Which agent a template belongs to. "shared" files (the GitHub workflow) install for every choice.
function toolFor(rel: string): "cursor" | "claude" | "codex" | "shared" {
  const p = rel.replace(/\\/g, "/");
  if (p.startsWith(".cursor/")) return "cursor";
  if (p.startsWith(".claude/") || p === "CLAUDE.md") return "claude";
  if (p.startsWith(".codex/") || p === "AGENTS.md") return "codex";
  return "shared";
}

// AGENTS.md and CLAUDE.md are shared with the user's own notes: only the sdlc block is owned by sdlc.
function mergeManagedBlock(existing: string | undefined, template: string): string {
  const block = template.slice(template.indexOf(BLOCK_START), template.indexOf(BLOCK_END) + BLOCK_END.length);
  if (existing === undefined) return template;
  const s = existing.indexOf(BLOCK_START);
  const e = existing.indexOf(BLOCK_END);
  if (s !== -1 && e > s) return existing.slice(0, s) + block + existing.slice(e + BLOCK_END.length);
  return `${existing.trimEnd()}\n\n${block}\n`;
}

async function init(force = false, tool = "cursor") {
  if (!INIT_TOOLS.includes(tool)) throw new Error(`--tool must be one of ${INIT_TOOLS.join(", ")}`);
  // Standalone binary: templates are embedded. From source: read ./templates.
  let files = Object.entries(EMBEDDED_TEMPLATES);
  if (files.length === 0) {
    const templates = join(dirname(fileURLToPath(import.meta.url)), "..", "templates");
    files = await Promise.all(
      (await listFiles(templates)).map(async (file) => [relative(templates, file), await readFile(file, "utf8")] as [string, string]),
    );
  }
  for (const [rel, content] of files) {
    const owner = toolFor(rel);
    if (tool !== "all" && owner !== "shared" && owner !== tool) continue;
    const dest = join(process.cwd(), rel);
    if (content.includes(BLOCK_START)) {
      const existing = existsSync(dest) ? await readFile(dest, "utf8") : undefined;
      const merged = mergeManagedBlock(existing, content);
      if (merged === existing) {
        log(`up to date ${rel}`);
        continue;
      }
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, merged);
      log(`${existing === undefined ? "added" : "updated sdlc block in"} ${rel}`);
      continue;
    }
    if (existsSync(dest) && !force) {
      log(`skip ${rel} (exists; use --force)`);
      continue;
    }
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
    log(`added ${rel}`);
  }
  if ((tool === "claude" || tool === "all") && !process.env["ANTHROPIC_API_KEY"]) {
    log("note: sdlc calls the Anthropic API itself; set ANTHROPIC_API_KEY (a Claude Code login does not cover it)");
  }
  if ((tool === "codex" || tool === "all") && !process.env["OPENAI_API_KEY"] && !process.env["CODEX_API_KEY"]) {
    log("note: Codex needs `codex login`, or OPENAI_API_KEY / CODEX_API_KEY");
  }
  log("done. Add .sdlc/ to .gitignore if you don't want reports committed.");
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) => (e.isDirectory() ? listFiles(join(dir, e.name)) : Promise.resolve([join(dir, e.name)]))),
  );
  return nested.flat();
}

main()
  .catch((err) => {
    log(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
  })
  // Rig's timeout addon leaves an un-ref'd timer running, which would keep the
  // process alive until it fires. Flush stdout, then exit explicitly.
  .then(() => new Promise<void>((done) => process.stdout.write("", () => done())))
  .then(() => process.exit(process.exitCode ?? 0));
