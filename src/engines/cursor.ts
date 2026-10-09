/**
 * Rig engine adapter for the Cursor Agent CLI (`agent` / `cursor-agent`).
 *
 * Runs Cursor headless (`-p --output-format json`) and resumes the same chat
 * across Rig repair turns so the model keeps its context. File edits are NOT
 * enabled (no `--force`), so the SDLC agents stay read-only.
 *
 * Auth: `agent login` locally, or CURSOR_API_KEY in CI.
 */
import { spawn } from "node:child_process";
import type { AgentFactory } from "rig";

export type CursorEngineOptions = {
  /** Binary to run. Defaults to $CURSOR_AGENT_BIN, then "agent". Older installs use "cursor-agent". */
  command?: string;
  cwd?: string;
  /** Extra CLI args, e.g. ["--trust"]. Defaults to $CURSOR_AGENT_ARGS split on spaces. */
  args?: string[];
  env?: NodeJS.ProcessEnv;
  /** Kill the CLI after this many ms (default 10 min). */
  timeoutMs?: number;
};

type CursorResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  chatId?: string;
};

/** Model aliases Rig uses by default; for Cursor they mean "use the account default". */
const DEFAULT_MODEL_ALIASES = new Set(["", "default", "auto-default", "small", "mini", "nano"]);

export function cursorEngine(options: CursorEngineOptions = {}): AgentFactory {
  const command = options.command ?? process.env["CURSOR_AGENT_BIN"] ?? "agent";
  const extraArgs =
    options.args ?? (process.env["CURSOR_AGENT_ARGS"] ?? "").split(" ").filter(Boolean);
  const timeoutMs = options.timeoutMs ?? 600_000;

  return (agentOptions) => {
    if (agentOptions.tools && agentOptions.tools.length > 0) {
      throw new Error("cursorEngine does not support Rig tools; pass context through agent input instead");
    }
    const systemMessage =
      typeof agentOptions.systemMessage === "string" ? agentOptions.systemMessage : undefined;
    let sessionId: string | undefined;
    const closeController = new AbortController();

    return {
      async ask(prompt, askOptions = {}) {
        const signal = askOptions.signal
          ? AbortSignal.any([askOptions.signal, closeController.signal])
          : closeController.signal;
        const fullPrompt = !sessionId && systemMessage ? `${systemMessage}\n\n${prompt}` : prompt;
        const model = agentOptions.model;
        const args = [
          "-p",
          "--output-format",
          "json",
          ...(model && !DEFAULT_MODEL_ALIASES.has(model) ? ["--model", model] : []),
          ...(sessionId ? ["--resume", sessionId] : []),
          ...extraArgs,
          fullPrompt,
        ];
        const out = await runCli(command, args, {
          cwd: options.cwd,
          env: { ...process.env, ...options.env },
          signal,
          timeoutMs,
        });
        if (out.is_error) throw new Error(`Cursor agent error: ${out.result ?? "unknown error"}`);
        sessionId = out.session_id ?? out.chatId ?? sessionId;
        return out.result ?? "";
      },
      async close() {
        closeController.abort(new DOMException("Agent closed", "AbortError"));
      },
    };
  };
}

function runCli(
  command: string,
  args: string[],
  opts: { cwd?: string; env: NodeJS.ProcessEnv; signal: AbortSignal; timeoutMs: number },
): Promise<CursorResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      signal: opts.signal,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    timer.unref();
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (c: string) => (stdout += c));
    child.stderr.setEncoding("utf8").on("data", (c: string) => (stderr += c));
    child.once("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      reject(
        err.code === "ENOENT"
          ? new Error(
              `Cursor CLI "${command}" not found. Install it (curl https://cursor.com/install -fsS | bash) or set CURSOR_AGENT_BIN.`,
            )
          : err,
      );
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Cursor CLI exited with code ${code}`));
        return;
      }
      // json mode prints a single object; be tolerant of stray log lines before it.
      const line = stdout.trim().split("\n").reverse().find((l) => l.trim().startsWith("{"));
      try {
        resolve(JSON.parse(line ?? stdout) as CursorResult);
      } catch {
        reject(new Error(`Cursor CLI returned non-JSON output: ${stdout.slice(0, 300)}`));
      }
    });
  });
}
