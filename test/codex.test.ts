import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createAgents } from "../src/agents.ts";
import { toStrictSchema } from "../src/engines/strict-schema.ts";

const BIN = resolve("bin/sdlc.mjs");
const FAKE_CODEX = resolve("test/fixtures/fake-codex.mjs");

/** The rules OpenAI strict mode enforces on every object in the schema. */
function assertStrict(schema: any, path = "$") {
  if (!schema || typeof schema !== "object") return;
  if (schema.type === "object") {
    assert.equal(schema.additionalProperties, false, `${path}: additionalProperties must be false`);
    assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort(), `${path}: every property required`);
    for (const [k, v] of Object.entries(schema.properties)) assertStrict(v, `${path}.${k}`);
  }
  if (schema.items) assertStrict(schema.items, `${path}[]`);
  for (const s of schema.anyOf ?? []) assertStrict(s, path);
  assert.equal(schema.oneOf, undefined, `${path}: oneOf is not allowed`);
}

test("every agent's output schema becomes strict-mode valid", () => {
  for (const [name, a] of Object.entries(createAgents("x"))) {
    const raw = JSON.parse(JSON.stringify(a.outputSchema));
    assert.doesNotThrow(() => assertStrict(toStrictSchema(raw)), name);
  }
});

test("optional fields become required + nullable, unsupported keywords dropped", () => {
  const strict = toStrictSchema({
    type: "object",
    properties: { a: { type: "string", minLength: 1 }, b: { type: "integer", description: "count" } },
    required: ["a"],
  });
  assert.deepEqual(strict, {
    type: "object",
    properties: { a: { type: "string" }, b: { description: "count", anyOf: [{ type: "integer" }, { type: "null" }] } },
    required: ["a", "b"],
    additionalProperties: false,
  });
});

test("records are rejected with a clear message", () => {
  assert.throws(
    () => toStrictSchema({ type: "object", properties: { m: { type: "object", additionalProperties: { type: "string" } } }, required: ["m"] }),
    /\$\.m is a record/,
  );
});

async function repo() {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-codex-"));
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(dir, "a.js"), "export const a = 1;\n");
  git("add", ".");
  git("commit", "-qm", "init");
  await writeFile(join(dir, "a.js"), "export const a = 2;\n");
  return dir;
}

const runCodex = (dir: string, env: Record<string, string>) =>
  spawnSync(process.execPath, [BIN, "review", "--engine", "codex", "--model", "gpt-5.5"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 60_000,
    env: { ...process.env, SDLC_CODEX_BIN: FAKE_CODEX, CODEX_API_KEY: "test", ...env },
  });

test("codex engine sends a strict schema, read-only sandbox, and the chosen model", async () => {
  const dir = await repo();
  const logFile = join(dir, "codex-calls.log");
  const res = runCodex(dir, { FAKE_CODEX_LOG: logFile });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /from fake codex/);
  const call = JSON.parse((await readFile(logFile, "utf8")).trim().split("\n")[0]!);
  assertStrict(call.schema);
  assert.ok(call.args.includes("gpt-5.5"), "model passed through");
  assert.ok(call.args.join(" ").includes("read-only"), "read-only sandbox");
});

test("a failed codex turn is reported cleanly instead of crashing Node", async () => {
  const dir = await repo();
  const res = runCodex(dir, { FAKE_CODEX_MODE: "fail" });
  assert.equal(res.status, 2, `expected the CLI's error exit code, got ${res.status}\n${res.stderr}`);
  assert.match(res.stderr, /Invalid schema for response_format/);
  assert.doesNotMatch(res.stderr, /AbortError|node:internal/);
});
