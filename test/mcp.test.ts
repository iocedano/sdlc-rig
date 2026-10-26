import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

const BIN = resolve("bin/sdlc.mjs");

async function fixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "sdlc-mcp-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "Test");
  await writeFile(join(dir, "index.js"), "export const add = (a, b) => a + b;\n");
  git("add", ".");
  git("commit", "-qm", "feat: initial");
  git("checkout", "-qb", "feature");
  await writeFile(join(dir, "index.js"), "export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n");
  git("commit", "-qam", "feat: add sub");
  return dir;
}

test("MCP server lists the stage tools and runs review with the mock engine", async () => {
  const dir = await fixtureRepo();
  const child = spawn(process.execPath, [BIN, "mcp"], { cwd: dir, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map<number, (msg: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg);
      pending.delete(msg.id);
    }
  });
  const send = (id: number, method: string, params: object) =>
    new Promise<any>((done) => {
      pending.set(id, done);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });

  try {
    const init = await send(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0.0.0" },
    });
    assert.equal(init.result.serverInfo.name, "sdlc");
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

    const list = await send(2, "tools/list", {});
    const tools = new Map<string, any>(list.result.tools.map((t: any) => [t.name, t]));
    assert.deepEqual(
      [...tools.keys()].sort(),
      ["sdlc_inception", "sdlc_plan", "sdlc_pr", "sdlc_release", "sdlc_review", "sdlc_security", "sdlc_stories", "sdlc_test"],
    );
    // The test command is never an input: an MCP client cannot choose what runs.
    assert.ok(!("cmd" in tools.get("sdlc_test").inputSchema.properties));
    // Inception analyzes the server's own project; a client must not pick the directory.
    assert.ok(!("path" in tools.get("sdlc_inception").inputSchema.properties));

    const call = await send(3, "tools/call", { name: "sdlc_review", arguments: { engine: "mock" } });
    assert.notEqual(call.result.isError, true, call.result.content?.[0]?.text);
    assert.match(call.result.content[0].text, /\.sdlc\/reports\/review\.md/);
  } finally {
    child.kill();
  }
});
