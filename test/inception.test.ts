import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InceptionResult } from "../src/agents.ts";
import { buildInceptionReport, inceptionFacts, renderInception } from "../src/inception.ts";

const EMPTY_AGENT = {
  stack: { languages: ["TypeScript"], runtimes: ["Node.js"], frameworks: ["Express"], databases: [], notableLibraries: [] },
  architecture: "REST API",
  keyDirectories: [],
  entryPoints: [],
  buildRunCommands: ["npm start"],
  authAndAccess: { status: "Warn", observations: "No auth middleware found." },
  inputValidation: { status: "Warn", observations: "None found." },
  securityHeadersCorsRateLimit: { status: "Warn", observations: "None found." },
  findings: [],
  nextSteps: [],
} as unknown as InceptionResult;

// Built at runtime so this test file never contains a complete credential-shaped literal.
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "inception-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "package.json"), JSON.stringify({ name: "demo", dependencies: { express: "*", zod: "^3.0.0" } }));
  await writeFile(join(dir, ".gitignore"), "dist\n");
  await writeFile(join(dir, ".env"), "DB_URL=postgres://localhost\n");
  await writeFile(join(dir, "src", "index.ts"), `const key = "${"AKIA" + "IOSFODNN7EXAMPLE"}";\n`);
  return dir;
}

test("detects deterministic issues in a repo without git", async () => {
  const facts = await inceptionFacts(await fixture());
  assert.equal(facts.isGit, false);
  assert.ok(facts.manifests.includes("package.json"));
  assert.ok(facts.missingLockfiles.includes("package.json"));
  assert.ok(facts.unpinned.some((u) => u.startsWith("express@*")));
  assert.ok(!facts.unpinned.some((u) => u.startsWith("zod")));
  assert.ok(facts.secretHits.some((h) => h.pattern === "AWS access key" && h.file === "src/index.ts" && h.line === 1));
  assert.ok(facts.sensitive.some((s) => s.path === ".env" && s.tracked === null));
  assert.ok(facts.gitignore.missing.includes(".env"));
  assert.ok(facts.gitignore.missing.includes("node_modules"));
});

test("health is derived from findings, not from the model", async () => {
  const facts = await inceptionFacts(await fixture());
  const report = buildInceptionReport(facts, EMPTY_AGENT, "demo");
  assert.equal(report.health, "🔴 High Risk");
  assert.equal(report.checks.find((c) => c.name === "Secrets & Hardcoded Keys")?.status, "Fail");
});

test("renders the fixed layout and never echoes a secret value", async () => {
  const facts = await inceptionFacts(await fixture());
  const md = renderInception(buildInceptionReport(facts, EMPTY_AGENT, "demo"));
  for (const heading of [
    "## 1. Executive Summary",
    "## 2. Repository Map & Entry Points",
    "## 3. Security & Configuration Baseline Audit",
    "## 4. Key Security Warnings & Recommendations",
    "## 5. Next Steps for Developer",
  ]) {
    assert.ok(md.includes(heading), heading);
  }
  assert.ok(md.includes("| **Secrets & Hardcoded Keys** | Fail |"));
  assert.ok(!md.includes("IOSFODNN7EXAMPLE"), "secret value must never appear in the report");
});

test("npm audit results become dependency findings", async () => {
  const facts = await inceptionFacts(await fixture());
  facts.audit = {
    dependencyAudit: "npm audit:\nhigh: lodash (<4.17.21) — fix available\nmoderate: qs (<6.5.3)",
    scanners: "No external scanners installed.",
  };
  const report = buildInceptionReport(facts, EMPTY_AGENT, "demo");
  const lodash = report.findings.find((f) => f.title === "Vulnerable dependency: lodash");
  assert.equal(lodash?.severity, "high");
  assert.ok(lodash?.remediation.includes("patched version"));
  assert.equal(report.findings.find((f) => f.title === "Vulnerable dependency: qs")?.severity, "medium");
});
