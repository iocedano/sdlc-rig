import { test } from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agent, configureAgent, s } from "rig";
import { cursorEngine } from "../src/engines/cursor.ts";
import { mockEngine, sample } from "../src/engines/mock.ts";

test("mock schema sampler satisfies nested schemas", () => {
  const value = sample(
    { type: "object", properties: { a: { enum: ["x", "y"] }, b: { type: "array", items: { type: "integer" } }, c: { anyOf: [{ type: "null" }, { type: "string" }] } } },
    "root",
  );
  assert.deepEqual(value, { a: "x", b: [1], c: "(mock c)" });
});

test("rig agent runs end-to-end on the mock engine", async () => {
  configureAgent(mockEngine());
  const a = agent({ instructions: "x", output: s.object({ verdict: s.enum("ok", "bad"), n: s.int }) });
  assert.deepEqual(await a(""), { verdict: "ok", n: 1 });
});

test("cursor engine calls the CLI headless, parses JSON and resumes the chat", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cursor-fake-"));
  const logFile = join(dir, "calls.log");
  const bin = join(dir, "agent");
  await writeFile(
    bin,
    `#!/usr/bin/env node
require("fs").appendFileSync(${JSON.stringify(logFile)}, JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write("some log line\\n" + JSON.stringify({ type: "result", subtype: "success", is_error: false, result: '{"title":"hi"}', session_id: "chat-123" }) + "\\n");
`,
  );
  await chmod(bin, 0o755);
  const factory = cursorEngine({ command: bin, args: ["--trust"] });
  const runtime = await factory({ model: "default", systemMessage: "SYS" });
  assert.equal(await runtime.ask("first"), '{"title":"hi"}');
  await runtime.ask("second");
  const calls = (await readFile(logFile, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(calls[0], ["-p", "--output-format", "json", "--trust", "SYS\n\nfirst"]);
  assert.deepEqual(calls[1], ["-p", "--output-format", "json", "--resume", "chat-123", "--trust", "second"]);
});

test("cursor engine passes explicit models and reports a missing binary clearly", async () => {
  const runtime = await cursorEngine({ command: "definitely-not-a-cursor-binary" })({ model: "gpt-5" });
  await assert.rejects(runtime.ask("x"), /Cursor CLI "definitely-not-a-cursor-binary" not found/);
});
