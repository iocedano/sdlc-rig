/**
 * Deterministic context gathering. Everything the agents see is collected here
 * in Node and passed as typed input, so the same agents work on engines with
 * shell access (Cursor, Copilot, Codex, Gemini) and on plain API engines
 * (Anthropic) alike, and CI runs are reproducible.
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

export const LIMITS = {
  diff: Number(process.env["SDLC_MAX_DIFF_CHARS"] ?? 120_000),
  file: 20_000,
  testOutput: 15_000,
  tree: 400,
};

export function truncate(text: string, max: number, label = "content"): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[... ${label} truncated: ${text.length - max} more characters ...]`;
}

export async function git(args: string[], cwd = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout.trimEnd();
  } catch {
    return "";
  }
}

export async function isGitRepo(cwd = process.cwd()): Promise<boolean> {
  return (await git(["rev-parse", "--is-inside-work-tree"], cwd)) === "true";
}

/** `base...HEAD` when a base is given (PR mode); otherwise uncommitted changes vs HEAD. */
function diffRange(base?: string): string[] {
  return base ? [`${base}...HEAD`] : ["HEAD"];
}

export type DiffContext = { diff: string; diffStat: string; changedFiles: string[]; commits: string };

export async function diffContext(base?: string, cwd = process.cwd()): Promise<DiffContext> {
  const range = diffRange(base);
  const exclude = [":(exclude)package-lock.json", ":(exclude)yarn.lock", ":(exclude)pnpm-lock.yaml", ":(exclude)go.sum"];
  const [diff, diffStat, names, commits] = await Promise.all([
    git(["diff", "--no-color", "-U3", ...range, "--", ".", ...exclude], cwd),
    git(["diff", "--stat", ...range], cwd),
    git(["diff", "--name-only", ...range], cwd),
    base ? git(["log", "--no-merges", "--pretty=format:%h %s (%an)", `${base}..HEAD`], cwd) : Promise.resolve(""),
  ]);
  return {
    diff: truncate(diff, LIMITS.diff, "diff"),
    diffStat,
    changedFiles: names.split("\n").filter(Boolean),
    commits,
  };
}

export async function latestTag(cwd = process.cwd()): Promise<string> {
  return git(["describe", "--tags", "--abbrev=0"], cwd);
}

export async function releaseContext(from?: string, cwd = process.cwd()) {
  const since = from ?? (await latestTag(cwd));
  const range = since ? `${since}..HEAD` : "HEAD";
  const [commits, diffStat] = await Promise.all([
    git(["log", "--no-merges", "--pretty=format:%h %s%n%b", range], cwd),
    since ? git(["diff", "--stat", range], cwd) : git(["show", "--stat", "--pretty=format:", "HEAD"], cwd),
  ]);
  return { since: since || "(repository start)", commits: truncate(commits, 60_000, "commit log"), diffStat };
}

const KEY_FILES = [
  "README.md",
  "package.json",
  "go.mod",
  "pyproject.toml",
  "requirements.txt",
  "docker-compose.yml",
  "Dockerfile",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "docs/architecture.md",
];

export async function repoSnapshot(extraFiles: string[] = [], cwd = process.cwd()) {
  const tracked = (await git(["ls-files"], cwd)).split("\n").filter(Boolean);
  const tree = tracked.slice(0, LIMITS.tree).join("\n") + (tracked.length > LIMITS.tree ? `\n... (${tracked.length - LIMITS.tree} more files)` : "");
  const keyFiles: Record<string, string> = {};
  for (const file of [...KEY_FILES, ...extraFiles]) {
    const content = await readOptional(join(cwd, file));
    if (content) keyFiles[file] = truncate(content, LIMITS.file, file);
  }
  return { tree, keyFiles };
}

export async function readOptional(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** Guess the test command from the repo when none is given. */
export function detectTestCommand(cwd = process.cwd()): string | undefined {
  if (existsSync(join(cwd, "package.json"))) return "npm test --silent";
  if (existsSync(join(cwd, "go.mod"))) return "go test ./...";
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "pytest.ini"))) return "pytest -q";
  return undefined;
}

export type TestRun = { command: string; exitCode: number; output: string; ran: boolean };

export function runTests(command: string | undefined, cwd = process.cwd()): Promise<TestRun> {
  if (!command) return Promise.resolve({ command: "", exitCode: -1, output: "", ran: false });
  return new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, env: { ...process.env, CI: "1", FORCE_COLOR: "0" } });
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    child.on("close", (code) =>
      // Keep the tail: failures and summaries are usually at the end.
      resolve({ command, exitCode: code ?? 1, output: output.slice(-LIMITS.testOutput), ran: true }),
    );
    child.on("error", (err) => resolve({ command, exitCode: 127, output: String(err), ran: true }));
  });
}

// ---------- security signals ----------

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["AWS access key", /AKIA[0-9A-Z]{16}/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["Slack token", /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ["Private key", /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["Stripe key", /sk_live_[0-9a-zA-Z]{24,}/],
  ["Generic secret assignment", /(api[_-]?key|secret|passw(or)?d|token)\s*[:=]\s*['"][^'"\s]{12,}['"]/i],
];

/** Scan only lines added in the diff, and redact the match so secrets never reach the LLM. */
export function scanDiffForSecrets(diff: string): string[] {
  const hits: string[] = [];
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    if (!line.startsWith("+") || line.startsWith("+++")) continue;
    for (const [name, re] of SECRET_PATTERNS) {
      const m = line.match(re);
      if (m) hits.push(`${name} in ${file}: ${m[0].slice(0, 4)}…[redacted]`);
    }
  }
  return hits;
}

export function redactSecrets(diff: string): string {
  return SECRET_PATTERNS.reduce((text, [, re]) => text.replace(new RegExp(re.source, re.flags + "g"), (m) => `${m.slice(0, 4)}…[REDACTED]`), diff);
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${cmd}`]);
    return true;
  } catch {
    return false;
  }
}

async function runCapture(cmd: string, args: string[], cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(cmd, args, { cwd, maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (err: any) {
    // Scanners exit non-zero when they find something; their stdout is still the report.
    return typeof err?.stdout === "string" ? err.stdout : "";
  }
}

export async function dependencyAudit(cwd = process.cwd()): Promise<string> {
  if (existsSync(join(cwd, "package-lock.json"))) {
    const raw = await runCapture("npm", ["audit", "--json", "--omit=dev"], cwd);
    try {
      const report = JSON.parse(raw);
      const vulns = Object.values<any>(report.vulnerabilities ?? {}).map(
        (v) => `${v.severity}: ${v.name} (${v.range ?? "?"})${v.fixAvailable ? " — fix available" : ""}`,
      );
      return vulns.length ? `npm audit:\n${vulns.join("\n")}` : "npm audit: no known vulnerabilities";
    } catch {
      return "npm audit: could not run (offline or no lockfile)";
    }
  }
  if (existsSync(join(cwd, "go.mod")) && (await commandExists("govulncheck"))) {
    return truncate(`govulncheck:\n${await runCapture("govulncheck", ["./..."], cwd)}`, 20_000);
  }
  return "No dependency audit available for this project type.";
}

/** Optional external scanners; each is used only if installed. */
export async function externalScanners(cwd = process.cwd()): Promise<string> {
  const parts: string[] = [];
  if (await commandExists("semgrep")) {
    const raw = await runCapture("semgrep", ["scan", "--config", "auto", "--json", "--quiet"], cwd);
    try {
      const results = JSON.parse(raw).results ?? [];
      parts.push(
        `semgrep (${results.length} results):\n` +
          results
            .slice(0, 50)
            .map((r: any) => `${r.extra?.severity} ${r.path}:${r.start?.line} ${r.check_id} — ${r.extra?.message}`)
            .join("\n"),
      );
    } catch {
      /* ignore */
    }
  }
  if (await commandExists("gitleaks")) {
    const out = await runCapture("gitleaks", ["detect", "--no-banner", "--redact", "--report-format", "json", "--report-path", "/dev/stdout"], cwd);
    parts.push(`gitleaks:\n${truncate(out, 10_000)}`);
  }
  return parts.join("\n\n") || "No external scanners installed (semgrep, gitleaks are optional).";
}
