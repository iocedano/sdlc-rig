/**
 * Project inception: onboarding facts for a repository the engineer has never seen.
 *
 * Deterministic checks run in Node (manifests, lockfiles, .gitignore coverage,
 * sensitive files, unpinned dependencies, secret patterns). The model adds judgment
 * on top: stack, architecture, auth controls and recommendations. The health rating
 * and the audit table come from the facts, so they cannot drift from the evidence.
 */
import { readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { InceptionResult } from "./agents.ts";
import { LIMITS, SECRET_PATTERNS, git, isGitRepo, readOptional, redactSecrets, truncate } from "./context.ts";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "venv", ".venv", "__pycache__", "vendor", "target", ".next", "coverage"]);
const MAX_FILES = 5_000;
const MAX_SCAN_BYTES = 512 * 1024;
const MAX_HITS = 50;
const KEY_FILE_CHARS = 6_000;
const KEY_FILE_EXTRA = ["README.md", "Dockerfile", "compose.yaml", "docker-compose.yml"];

const MANIFESTS = new Set([
  "package.json", "go.mod", "pyproject.toml", "requirements.txt", "Pipfile", "Cargo.toml", "pom.xml",
  "build.gradle", "build.gradle.kts", "Gemfile", "composer.json", "Dockerfile", "compose.yaml", "docker-compose.yml",
]);
// Lockfiles that must sit next to their manifest.
const LOCK_FOR: Record<string, string[]> = {
  "package.json": ["package-lock.json", "yarn.lock", "pnpm-lock.yaml", "bun.lock", "bun.lockb"],
  "go.mod": ["go.sum"],
  Gemfile: ["Gemfile.lock"],
  "composer.json": ["composer.lock"],
  "pyproject.toml": ["poetry.lock", "uv.lock"],
  Pipfile: ["Pipfile.lock"],
};
const LOCKFILE_NAMES = new Set(Object.values(LOCK_FOR).flat());
const ENTRY_NAMES = new Set([
  "index.ts", "index.js", "main.ts", "main.js", "server.ts", "server.js", "app.ts", "app.js",
  "cli.ts", "cli.js", "cli.mjs", "main.go", "app.py", "main.py", "manage.py", "wsgi.py", "Program.cs", "main.rs", "Main.java",
]);
const SENSITIVE = /(^|\/)(\.env(\.[^/]+)?|[^/]+\.(pem|key|p12|pfx)|id_rsa|id_ed25519|credentials(\.json)?)$/;
const ENV_TEMPLATE = /(^|\/)\.env\.(example|template|sample)$/;
const ENV_FILE = /(^|\/)\.env(\.[^/]+)?$/;
const EXAMPLE_PATH = /(^|\/)(test|tests|__tests__|spec|fixtures?|docs?|examples?)\/|\.(test|spec)\.[a-z]+$/i;

type Severity = "critical" | "high" | "medium" | "low" | "info";
const RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

export type Sensitive = { path: string; tracked: boolean | null };
export type SecretHit = { pattern: string; file: string; line: number };
export type InceptionFacts = {
  isGit: boolean;
  fileCount: number;
  files: string[];
  manifests: string[];
  missingLockfiles: string[];
  unpinned: string[];
  sensitive: Sensitive[];
  secretHits: SecretHit[];
  gitignore: { present: boolean; missing: string[] };
  envExample: string | null;
  entryPoints: string[];
  topDirs: { name: string; files: number }[];
};

export type Finding = { severity: Severity; title: string; file: string | null; detail: string; remediation: string };
export type Check = { name: string; status: "Pass" | "Fail" | "Warn"; observations: string };
export type InceptionReport = {
  repoName: string;
  facts: { isGit: boolean; fileCount: number };
  health: string;
  stack: string;
  architecture: string;
  keyDirectories: { path: string; purpose: string }[];
  entryPoints: string[];
  buildRunCommands: string[];
  checks: Check[];
  findings: Finding[];
  nextSteps: string[];
};

async function walk(root: string, dir = ""): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(join(root, dir), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!IGNORED_DIRS.has(e.name)) out.push(...(await walk(root, rel)));
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
  return out.slice(0, MAX_FILES);
}

function unpinnedDeps(file: string, content: string): string[] {
  if (basename(file) === "package.json") {
    try {
      const pkg = JSON.parse(content);
      return Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies })
        .filter(([, v]) => typeof v === "string" && (v === "" || v === "*" || v === "latest" || /^[>x*]/i.test(v)))
        .map(([name, v]) => `${name}@${v || "*"} (${file})`);
    } catch {
      return [];
    }
  }
  if (basename(file) === "requirements.txt") {
    return content
      .split("\n")
      .map((l) => l.split("#")[0]!.trim())
      .filter((l) => l && !l.startsWith("-") && !l.includes("=="))
      .map((l) => `${l} (${file})`);
  }
  return [];
}

// Each entry is a list of acceptable rules; any one of them counts as covered.
function requiredIgnores(manifestNames: Set<string>): string[][] {
  const required: string[][] = [[".env", ".env.*", "*.env"]];
  if (manifestNames.has("package.json")) required.push(["node_modules"], ["dist", "build"]);
  if (["pyproject.toml", "requirements.txt", "Pipfile"].some((m) => manifestNames.has(m))) {
    required.push(["venv", ".venv"], ["__pycache__"]);
  }
  return required;
}

export async function inceptionFacts(root: string): Promise<InceptionFacts> {
  const isGit = await isGitRepo(root);
  // In git, only tracked files count: an ignored or untracked .env is not a repo problem.
  const all = isGit ? (await git(["ls-files"], root)).split("\n").filter(Boolean) : await walk(root);
  const files = all.slice(0, MAX_FILES);
  const fileSet = new Set(files);

  const manifests = files.filter((f) => MANIFESTS.has(basename(f)) && f.split("/").length <= 3);
  const missingLockfiles = manifests.filter((m) => {
    const candidates = LOCK_FOR[basename(m)];
    if (!candidates) return false;
    const dir = dirname(m);
    return !candidates.some((c) => fileSet.has(dir === "." ? c : `${dir}/${c}`));
  });

  const unpinned: string[] = [];
  for (const m of manifests) {
    if (["package.json", "requirements.txt"].includes(basename(m))) {
      unpinned.push(...unpinnedDeps(m, await readOptional(join(root, m))));
    }
  }

  const sensitive: Sensitive[] = files
    .filter((f) => SENSITIVE.test(f) && !ENV_TEMPLATE.test(f))
    .map((path) => ({ path, tracked: isGit ? true : null }));

  const secretHits: SecretHit[] = [];
  for (const f of files) {
    if (secretHits.length >= MAX_HITS) break;
    if (LOCKFILE_NAMES.has(basename(f))) continue;
    const content = await readOptional(join(root, f));
    if (!content || content.length > MAX_SCAN_BYTES || content.includes("\u0000")) continue;
    content.split("\n").forEach((line, i) => {
      for (const [pattern, re] of SECRET_PATTERNS) {
        if (line.match(re)) secretHits.push({ pattern, file: f, line: i + 1 });
      }
    });
  }

  const gitignoreText = await readOptional(join(root, ".gitignore"));
  const rules = gitignoreText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => l.replace(/^\/+/, "").replace(/^\*\*\//, "").replace(/\/+$/, ""));
  const manifestNames = new Set(manifests.map((m) => basename(m)));
  const gitignoreMissing = requiredIgnores(manifestNames)
    .filter((alts) => !alts.some((a) => rules.includes(a)))
    .map((alts) => alts[0]!);

  // package.json main/bin first (what the project says it runs), then conventional names.
  let declared: string[] = [];
  try {
    const pkg = JSON.parse((await readOptional(join(root, "package.json"))) || "{}");
    const bin = typeof pkg.bin === "string" ? [pkg.bin] : Object.values(pkg.bin ?? {});
    declared = [pkg.main, ...bin].filter((p): p is string => typeof p === "string").map((p) => p.replace(/^\.\//, ""));
  } catch {
    /* not a valid package.json: no declared entry points */
  }
  const entryPoints = [
    ...new Set([
      ...declared.filter((p) => fileSet.has(p)),
      ...files.filter((f) => ENTRY_NAMES.has(basename(f)) && f.split("/").length <= 3),
    ]),
  ].slice(0, 20);

  const counts = new Map<string, number>();
  for (const f of files) {
    if (!f.includes("/")) continue;
    const d = f.split("/")[0]!;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const topDirs = [...counts]
    .map(([name, n]) => ({ name, files: n }))
    .sort((a, b) => b.files - a.files)
    .slice(0, 20);

  return {
    isGit,
    fileCount: files.length,
    files,
    manifests,
    missingLockfiles,
    unpinned,
    sensitive,
    secretHits,
    gitignore: { present: gitignoreText.length > 0, missing: gitignoreMissing },
    envExample: files.find((f) => ENV_TEMPLATE.test(f)) ?? null,
    entryPoints,
    topDirs,
  };
}

function describeFacts(facts: InceptionFacts): string {
  return [
    `Source: ${facts.isGit ? "git-tracked files" : "filesystem walk (not a git repository)"}`,
    `Files: ${facts.fileCount}`,
    `Manifests: ${facts.manifests.join(", ") || "none"}`,
    `Missing lockfiles: ${facts.missingLockfiles.join(", ") || "none"}`,
    `Unpinned dependencies: ${facts.unpinned.slice(0, 30).join("; ") || "none"}`,
    `Sensitive files: ${facts.sensitive.map((s) => `${s.path} (${s.tracked === true ? "tracked" : "tracking unknown"})`).join(", ") || "none"}`,
    `Possible secrets (values withheld): ${facts.secretHits.map((h) => `${h.pattern} at ${h.file}:${h.line}`).join("; ") || "none"}`,
    `Gitignore present: ${facts.gitignore.present}; missing rules: ${facts.gitignore.missing.join(", ") || "none"}`,
    `.env template: ${facts.envExample ?? "missing"}`,
    `Entry point candidates: ${facts.entryPoints.join(", ") || "none"}`,
    `Top directories: ${facts.topDirs.map((d) => `${d.name} (${d.files} files)`).join(", ") || "none"}`,
  ].join("\n");
}

/** Facts plus the model input, collected in Node so the agent sees the same evidence every run. */
export async function collectInception(root: string) {
  const facts = await inceptionFacts(root);
  const picks = [
    ...facts.manifests,
    ...facts.entryPoints.slice(0, 5),
    ".gitignore",
    ...(facts.envExample ? [facts.envExample] : []),
    ...KEY_FILE_EXTRA,
  ];
  const keyFiles: string[] = [];
  for (const f of [...new Set(picks)].slice(0, 25)) {
    const content = await readOptional(join(root, f));
    if (content) keyFiles.push(`### ${f}\n${truncate(redactSecrets(content), KEY_FILE_CHARS, f)}`);
  }
  const more = facts.files.length > LIMITS.tree ? `\n... (${facts.files.length - LIMITS.tree} more files)` : "";
  return {
    facts,
    input: {
      facts: describeFacts(facts),
      tree: facts.files.slice(0, LIMITS.tree).join("\n") + more,
      keyFiles: keyFiles.join("\n\n"),
    },
  };
}

/** Merges code-derived checks with the model's judgment. Health and the audit table come from here. */
export function buildInceptionReport(facts: InceptionFacts, agent: InceptionResult, repoName: string): InceptionReport {
  const findings: Finding[] = [];
  for (const h of facts.secretHits) {
    const example = EXAMPLE_PATH.test(h.file);
    findings.push({
      severity: example ? "low" : "critical",
      title: `Possible hardcoded secret (${h.pattern})${example ? " in test or docs" : ""}`,
      file: `${h.file}:${h.line}`,
      detail: example
        ? "Under a test or docs path, so it is probably a placeholder. Confirm it is fake."
        : "Matches a known credential pattern. The value is withheld from this report.",
      remediation: "Move it to an environment variable or secret manager and rotate the credential. If it was committed, rotating matters more than deleting it.",
    });
  }
  for (const s of facts.sensitive) {
    findings.push({
      severity: s.tracked === true ? "high" : "medium",
      title: "Sensitive file in the repository",
      file: s.path,
      detail: s.tracked === true ? "Tracked by git, so anyone with repository access can read it." : "Present on disk. This is not a git repo, so tracking cannot be verified.",
      remediation: "Add it to .gitignore, untrack it with `git rm --cached`, and rotate any secrets it contains.",
    });
  }
  if (facts.missingLockfiles.length) {
    findings.push({
      severity: "medium",
      title: "Missing lockfile",
      file: facts.missingLockfiles[0] ?? null,
      detail: `No lockfile next to: ${facts.missingLockfiles.join(", ")}. Installs are not reproducible and versions can drift.`,
      remediation: "Install dependencies once and commit the lockfile.",
    });
  }
  if (facts.unpinned.length) {
    findings.push({
      severity: "low",
      title: "Unpinned or wildcard dependencies",
      file: null,
      detail: `${facts.unpinned.length} dependency(ies) use *, latest or open ranges, e.g. ${facts.unpinned.slice(0, 5).join(", ")}.`,
      remediation: "Pin to a range you have tested and rely on the lockfile for exact versions.",
    });
  }
  if (!facts.gitignore.present) {
    findings.push({
      severity: "medium",
      title: "No .gitignore",
      file: null,
      detail: "Nothing stops secrets and build output from being committed.",
      remediation: "Add a .gitignore covering env files, dependency folders and build output.",
    });
  } else if (facts.gitignore.missing.length) {
    findings.push({
      severity: "medium",
      title: "Incomplete .gitignore",
      file: ".gitignore",
      detail: `Missing rules for: ${facts.gitignore.missing.join(", ")}.`,
      remediation: "Add the missing rules.",
    });
  }
  for (const f of agent.findings) {
    findings.push({ severity: f.severity, title: f.title, file: f.file, detail: f.detail, remediation: f.remediation });
  }
  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity]);

  // Hits under test/docs paths are probably placeholders: they warn instead of failing.
  const realHits = facts.secretHits.filter((h) => !EXAMPLE_PATH.test(h.file));
  const secretsStatus =
    realHits.length || facts.sensitive.some((s) => s.tracked === true)
      ? "Fail"
      : facts.secretHits.length || facts.sensitive.length
        ? "Warn"
        : "Pass";
  const secretsObs = [
    facts.secretHits.length
      ? `${facts.secretHits.length} possible secret(s), e.g. ${facts.secretHits.slice(0, 3).map((h) => `${h.pattern} in ${h.file}:${h.line}`).join("; ")}.`
      : `No credential patterns in ${facts.fileCount} scanned files.`,
    facts.sensitive.length
      ? `Sensitive files: ${facts.sensitive.map((s) => s.path).join(", ")}${facts.isGit ? " (tracked)" : " (tracking unknown, not a git repo)"}.`
      : "",
  ].filter(Boolean).join(" ");

  const giStatus = !facts.gitignore.present ? "Fail" : facts.gitignore.missing.length ? "Warn" : "Pass";
  const giObs = !facts.gitignore.present
    ? "No .gitignore found."
    : facts.gitignore.missing.length
      ? `Missing rules: ${facts.gitignore.missing.join(", ")}.`
      : "Covers env files and dependency/build folders for the detected stack.";

  const envTracked = facts.sensitive.some((s) => s.tracked === true && ENV_FILE.test(s.path));
  const envStatus = envTracked ? "Fail" : facts.envExample ? "Pass" : "Warn";
  const envObs = [
    envTracked ? ".env is tracked by git, so its values live in repository history." : "",
    facts.envExample ? `Template: ${facts.envExample}.` : "No .env.example or .env.template, so new developers can't see which variables to set.",
  ].filter(Boolean).join(" ");

  const a = agent.authAndAccess;
  const v = agent.inputValidation;
  const h = agent.securityHeadersCorsRateLimit;
  const authStatuses = [a.status, v.status, h.status];
  const authStatus = authStatuses.includes("Fail") ? "Fail" : authStatuses.includes("Warn") ? "Warn" : "Pass";
  const authObs = `${a.observations} Input validation: ${v.observations} Headers/CORS/rate limiting: ${h.observations}`;

  const checks: Check[] = [
    { name: "Secrets & Hardcoded Keys", status: secretsStatus, observations: secretsObs },
    { name: "Gitignore Coverage", status: giStatus, observations: giObs },
    { name: "Environment Configuration", status: envStatus, observations: envObs },
    { name: "Auth & Access Control", status: authStatus, observations: authObs },
  ];

  const top = findings[0]?.severity;
  const health =
    top === "critical" || top === "high"
      ? "🔴 High Risk"
      : top === "medium" || checks.some((c) => c.status !== "Pass")
        ? "🟡 Moderate Risk"
        : "🟢 Low Risk";

  return {
    repoName,
    facts: { isGit: facts.isGit, fileCount: facts.fileCount },
    health,
    stack: [...agent.stack.languages, ...agent.stack.runtimes, ...agent.stack.frameworks, ...agent.stack.databases].join(", ") || "Unknown",
    architecture: agent.architecture || "unclear",
    keyDirectories: agent.keyDirectories.length
      ? agent.keyDirectories
      : facts.topDirs.map((d) => ({ path: `${d.name}/`, purpose: `${d.files} files` })),
    entryPoints: agent.entryPoints.length ? agent.entryPoints : facts.entryPoints,
    buildRunCommands: agent.buildRunCommands,
    checks,
    findings,
    nextSteps: agent.nextSteps.length ? agent.nextSteps : ["Read the README, install dependencies, and run the test command."],
  };
}

const SHOWN_FINDINGS = 15;
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ");

export function renderInception(r: InceptionReport): string {
  const dirs = r.keyDirectories.length
    ? r.keyDirectories.map((d) => `  - \`${d.path}\` — ${d.purpose}`).join("\n")
    : "  - _None detected._";
  const cmds = r.buildRunCommands.length
    ? r.buildRunCommands.map((c) => `  - \`${c}\``).join("\n")
    : "  - _None found in manifests or scripts._";
  const rows = r.checks.map((c) => `| **${c.name}** | ${c.status} | ${cell(c.observations)} |`).join("\n");
  const shown = r.findings.slice(0, SHOWN_FINDINGS);
  const findings = shown.length
    ? shown
        .map((f) => `- **[${f.severity.toUpperCase()}]** ${f.title}${f.file ? ` — \`${f.file}\`` : ""}. ${f.detail} **Fix:** ${f.remediation}`)
        .join("\n")
    : "_No critical, high or medium findings._";
  const more = r.findings.length > SHOWN_FINDINGS ? `\n- _…${r.findings.length - SHOWN_FINDINGS} more in inception.json._` : "";
  const steps = r.nextSteps.map((st, i) => `${i + 1}. ${st}`).join("\n");

  return `# 🚀 Project Inception Report

Repository: **${r.repoName}** · ${r.facts.fileCount} files scanned (${r.facts.isGit ? "git-tracked" : "not a git repo; filesystem walk"}).

## 1. Executive Summary
- **Primary Tech Stack:** ${r.stack}
- **Architectural Style:** ${r.architecture}
- **Overall Security Health:** ${r.health}

## 2. Repository Map & Entry Points
- **Key Directories:**
${dirs}
- **Entry Points:** ${r.entryPoints.map((e) => `\`${e}\``).join(", ") || "_None detected._"}
- **Build/Run Commands:**
${cmds}

## 3. Security & Configuration Baseline Audit
| Security Check | Status | Observations / Findings |
| :--- | :--- | :--- |
${rows}

## 4. Key Security Warnings & Recommendations
${findings}${more}

## 5. Next Steps for Developer
${steps}
`;
}
