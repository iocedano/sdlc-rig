/**
 * MCP server for sdlc: exposes each stage as a tool over stdio, so Claude Code,
 * Cursor and Codex can call it without a shell command per stage.
 *
 * Each tool runs the CLI as a child process with --json, so the MCP layer adds no
 * logic of its own and the output matches the terminal. stdout is reserved for the
 * protocol: nothing in this file writes to it.
 */
import { spawn } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ENGINES } from "./engine.ts";

const MAX_TEXT = 100_000;

const engineField = z
  .enum(ENGINES)
  .optional()
  .describe("Engine to use. Defaults to $SDLC_ENGINE, then auto.");
const baseField = z.string().optional().describe("Compare against this branch (default: the CLI's default base).");

type Run = { ok: boolean; stdout: string; stderr: string; code: number | null };

function runSdlc(args: string[]): Promise<Run> {
  // Re-run the same entry point: `node bin/sdlc.mjs mcp` -> `node bin/sdlc.mjs <args>`.
  // A standalone binary has no script path in argv[1], so it is run directly.
  const self = process.argv[1] ?? "";
  const prefix = /\.(m?js|ts)$/.test(self) ? [self] : [];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [...prefix, ...args], {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString("utf8")));
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    child.on("error", (err) => resolve({ ok: false, stdout, stderr: `${stderr}${err.message}`, code: null }));
    child.on("close", (code) => resolve({ ok: code === 0, stdout, stderr, code }));
  });
}

const engineArgs = (engine?: string) => (engine ? ["--engine", engine] : []);

type ToolSpec = {
  name: string;
  description: string;
  // Keys match the tool's input schema.
  input: Record<string, z.ZodType>;
  // Builds the CLI arguments from validated input.
  args: (input: Record<string, string | undefined>) => string[];
  // Report file the CLI writes, relative to the project (for the reply).
  report: string;
};

const TOOLS: ToolSpec[] = [
  {
    name: "sdlc_stories",
    description: "Turn an idea into an epic and INVEST user stories with acceptance criteria and open questions.",
    input: { idea: z.string().min(1).describe("The feature idea or requirement."), engine: engineField },
    args: (i) => ["stories", "--json", ...engineArgs(i.engine), "--", i.idea!],
    report: ".sdlc/reports/stories.md",
  },
  {
    name: "sdlc_plan",
    description: "Technical design and task breakdown for a feature, grounded in this repository. Uses stories.json when present.",
    input: { feature: z.string().min(1).describe("The feature to design."), engine: engineField },
    args: (i) => ["plan", "--json", ...engineArgs(i.engine), "--", i.feature!],
    report: ".sdlc/reports/plan.md",
  },
  {
    name: "sdlc_review",
    description: "Code review of the current diff, with severity, file:line and suggested fixes.",
    input: { base: baseField, engine: engineField },
    args: (i) => ["review", "--json", ...engineArgs(i.engine), ...(i.base ? ["--base", i.base] : [])],
    report: ".sdlc/reports/review.md",
  },
  {
    // The test command is not an input: an MCP client must not choose what gets executed.
    // The CLI still uses SDLC_TEST_CMD or the detected command.
    name: "sdlc_test",
    description: "Run the project's tests, explain failures and propose missing tests. Uses SDLC_TEST_CMD or the detected test command.",
    input: { base: baseField, engine: engineField },
    args: (i) => ["test", "--json", ...engineArgs(i.engine), ...(i.base ? ["--base", i.base] : [])],
    report: ".sdlc/reports/tests.md",
  },
  {
    name: "sdlc_security",
    description: "Security review of the diff: secret scan, dependency audit, OWASP/CWE review and optional compliance notes.",
    input: {
      base: baseField,
      compliance: z.string().optional().describe("Compliance frameworks, e.g. 'HIPAA,PCI-DSS'."),
      engine: engineField,
    },
    args: (i) => [
      "security",
      "--json",
      ...engineArgs(i.engine),
      ...(i.base ? ["--base", i.base] : []),
      ...(i.compliance ? ["--compliance", i.compliance] : []),
    ],
    report: ".sdlc/reports/security.md",
  },
  {
    name: "sdlc_release",
    description: "Propose a SemVer bump and user-facing release notes since the last tag. Does not tag or publish.",
    input: { from: z.string().optional().describe("Tag to start from, e.g. v1.2.0."), engine: engineField },
    args: (i) => ["release", "--json", ...engineArgs(i.engine), ...(i.from ? ["--from", i.from] : [])],
    report: ".sdlc/reports/release.md",
  },
  {
    // No path input: an MCP client must not choose which directory is read and sent to the model.
    // It analyzes the project the server runs in.
    name: "sdlc_inception",
    description: "Onboarding report for this repository: stack, structure, entry points and a read-only baseline security audit (secrets, .gitignore, env files, dependency audit).",
    input: { engine: engineField },
    args: (i) => ["inception", "--json", ...engineArgs(i.engine)],
    report: ".sdlc/reports/inception.md",
  },
  {
    name: "sdlc_pr",
    description: "Review, tests and security in parallel, combined into one go / no-go report for a pull request.",
    input: { base: baseField, engine: engineField },
    args: (i) => ["pr", "--json", ...engineArgs(i.engine), ...(i.base ? ["--base", i.base] : [])],
    report: ".sdlc/reports/pr.md",
  },
];

function textResult(text: string, isError = false) {
  const clipped = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n\n[output truncated; see the report file]` : text;
  return { content: [{ type: "text" as const, text: clipped }], isError };
}

/** Serves MCP over stdio until the client disconnects. */
export async function serveMcp(): Promise<void> {
  const server = new McpServer({ name: "sdlc", version: "0.1.0" });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.input },
      async (input) => {
        const run = await runSdlc(tool.args(input as Record<string, string | undefined>));
        if (!run.ok) {
          const tail = run.stderr.trim().split("\n").slice(-20).join("\n");
          return textResult(`sdlc ${tool.name.replace("sdlc_", "")} failed (exit ${run.code ?? "error"}):\n${tail}`, true);
        }
        return textResult(`${run.stdout.trim()}\n\nFull report: ${tool.report}`);
      },
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // cli.ts exits when this returns, so wait until the client goes away.
  await new Promise<void>((resolve) => {
    server.server.onclose = () => resolve();
    process.stdin.on("end", () => resolve());
  });
}
