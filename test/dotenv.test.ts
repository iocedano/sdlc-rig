import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findEnvDir, isSdlcKey, loadProjectEnv, parseDotenv } from "../src/dotenv.ts";

test("parses dotenv syntax", () => {
  const parsed = parseDotenv(
    [
      "# comment",
      "SDLC_ENGINE=cursor",
      "export SDLC_MODEL = gpt-5.5   # inline comment",
      "ANTHROPIC_API_KEY='sk-ant-#not-a-comment'",
      'SDLC_COMPLIANCE="HIPAA, SOC 2"',
      'MULTI="line1\\nline2"',
      "SPAN=\"first",
      "second\"",
      "EMPTY=",
      "not a pair",
    ].join("\n"),
  );
  assert.deepEqual(parsed, {
    SDLC_ENGINE: "cursor",
    SDLC_MODEL: "gpt-5.5",
    ANTHROPIC_API_KEY: "sk-ant-#not-a-comment",
    SDLC_COMPLIANCE: "HIPAA, SOC 2",
    MULTI: "line1\nline2",
    SPAN: "first\nsecond",
    EMPTY: "",
  });
});

test("only sdlc-related keys qualify by default", () => {
  for (const k of ["SDLC_ENGINE", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY", "CURSOR_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "RIG_DEBUG"]) {
    assert.ok(isSdlcKey(k), k);
  }
  for (const k of ["DATABASE_URL", "NODE_ENV", "PORT", "AWS_SECRET_ACCESS_KEY"]) assert.ok(!isSdlcKey(k), k);
});

async function project(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-env-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(dir, name, ".."), { recursive: true });
    await writeFile(join(dir, name), content);
  }
  return dir;
}

test(".env.local overrides .env, the shell overrides both, other keys are ignored", async () => {
  const dir = await project({
    ".env": "SDLC_ENGINE=anthropic\nSDLC_MODEL=from-env\nDATABASE_URL=postgres://x\n",
    ".env.local": "SDLC_MODEL=from-local\n",
  });
  const env: NodeJS.ProcessEnv = { SDLC_ENGINE: "cursor" };
  const res = loadProjectEnv({ cwd: dir, env });
  assert.equal(env["SDLC_ENGINE"], "cursor", "shell wins");
  assert.equal(env["SDLC_MODEL"], "from-local", ".env.local wins over .env");
  assert.equal(env["DATABASE_URL"], undefined, "app keys are not loaded");
  assert.deepEqual(res.loaded, ["SDLC_MODEL"]);
  assert.equal(res.skipped, 1);
});

test("SDLC_DOTENV_ALL=1 loads every key; SDLC_NO_DOTENV=1 loads none", async () => {
  const dir = await project({ ".env": "DATABASE_URL=postgres://x\nSDLC_ENGINE=mock\n" });
  const all: NodeJS.ProcessEnv = { SDLC_DOTENV_ALL: "1" };
  loadProjectEnv({ cwd: dir, env: all });
  assert.equal(all["DATABASE_URL"], "postgres://x");
  const none: NodeJS.ProcessEnv = { SDLC_NO_DOTENV: "1" };
  assert.deepEqual(loadProjectEnv({ cwd: dir, env: none }).files, []);
  assert.equal(none["SDLC_ENGINE"], undefined);
});

test("finds .env in a parent folder but never above the git root", async () => {
  const dir = await project({ ".env": "SDLC_ENGINE=mock\n", "packages/api/index.js": "" });
  assert.equal(findEnvDir(join(dir, "packages/api")), dir);
  const inner = await project({ "sub/x.js": "" });
  assert.equal(findEnvDir(join(inner, "sub")), undefined);
});

const BIN = resolve("bin/sdlc.mjs");
const run = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const clean = { ...process.env };
  for (const k of Object.keys(clean)) if (k.startsWith("SDLC_")) delete clean[k];
  return spawnSync(process.execPath, [BIN, ...args], { cwd, encoding: "utf8", env: { ...clean, ...env } });
};

test("the CLI picks its engine and settings from the project's .env", async () => {
  const dir = await project({ ".env": "SDLC_ENGINE=mock\nSDLC_COMPLIANCE=HIPAA\nDATABASE_URL=postgres://x\n", "a.js": "1\n" });
  execFileSync("git", ["-c", "user.email=t@e.com", "-c", "user.name=T", "commit", "-qm", "i", "--allow-empty"], { cwd: dir });

  const res = run(dir, ["security"]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stderr, /env: SDLC_ENGINE, SDLC_COMPLIANCE from \.env \(1 non-sdlc keys ignored\)/);
  assert.match(res.stderr, /engine=mock/);

  const off = run(dir, ["security", "--no-dotenv"], { SDLC_ENGINE: "mock" });
  assert.doesNotMatch(off.stderr, /env:/);

  await writeFile(join(dir, "ci.env"), "SDLC_ENGINE=mock\nSDLC_MODEL=from-file\n");
  const custom = run(dir, ["review", "--dotenv", "ci.env"]);
  assert.match(custom.stderr, /engine=mock model=from-file/);

  const missing = run(dir, ["review", "--dotenv", "nope.env"]);
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /--dotenv not found/);
});
