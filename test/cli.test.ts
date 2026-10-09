import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { scanDiffForSecrets, redactSecrets } from "../src/context.ts";

const BIN = resolve("bin/sdlc.mjs");

async function fixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(dir, "README.md"), "# Demo\n");
  await writeFile(join(dir, "index.js"), "export const add = (a, b) => a + b;\n");
  git("add", ".");
  git("commit", "-qm", "feat: initial");
  git("tag", "v0.1.0");
  git("checkout", "-qb", "feature");
  await writeFile(join(dir, "index.js"), "export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n");
  git("commit", "-qam", "feat: add sub");
  return dir;
}

const run = (dir: string, ...args: string[]) =>
  spawnSync(process.execPath, [BIN, ...args, "--engine", "mock"], { cwd: dir, encoding: "utf8" });

test("every command produces markdown + json reports with the mock engine", async () => {
  const dir = await fixtureRepo();
  for (const [args, report] of [
    [["stories", "Let users export invoices as PDF"], "stories"],
    [["plan", "Invoice PDF export"], "plan"],
    [["review", "--base", "main"], "review"],
    [["test", "--base", "main", "--cmd", "echo ok"], "tests"],
    [["security", "--base", "main", "--compliance", "HIPAA"], "security"],
    [["release"], "release"],
    [["pr", "--base", "main", "--cmd", "true"], "pr"],
  ] as const) {
    const res = run(dir, ...args);
    assert.equal(res.status, 0, `${args[0]} failed: ${res.stderr}`);
    assert.ok(existsSync(join(dir, ".sdlc/reports", `${report}.md`)), `${report}.md missing`);
    JSON.parse(await readFile(join(dir, ".sdlc/reports", `${report}.json`), "utf8"));
  }
  assert.match(await readFile(join(dir, ".sdlc/reports/pr.md"), "utf8"), /sdlc-rig-report/);
});

test("--fail-on gates on failing tests", async () => {
  const dir = await fixtureRepo();
  const res = run(dir, "test", "--cmd", "exit 3", "--fail-on", "critical");
  assert.equal(res.status, 1, res.stderr);
});

test("init installs Cursor commands and the workflow", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-init-"));
  const res = spawnSync(process.execPath, [BIN, "init"], { cwd: dir, encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  for (const f of [".cursor/commands/sdlc-review.md", ".cursor/rules/sdlc.mdc", ".github/workflows/sdlc.yml"]) {
    assert.ok(existsSync(join(dir, f)), f);
  }
});

test("secrets in added lines are detected and redacted", () => {
  const diff = "+++ b/config.js\n+const key = 'AKIAABCDEFGHIJKLMNOP';\n-const old = 'AKIAZZZZZZZZZZZZZZZZ';";
  assert.deepEqual(scanDiffForSecrets(diff), ["AWS access key in config.js: AKIA…[redacted]"]);
  assert.ok(!redactSecrets(diff).includes("ABCDEFGHIJKLMNOP"));
});
