/**
 * Rig engine adapter for OpenAI Codex (replaces rig/engines/codex).
 *
 * Differences from Rig's built-in adapter:
 *  - Output schemas are converted to OpenAI strict mode (`additionalProperties: false`,
 *    all fields required). Without it the API answers 400 `invalid_json_schema`.
 *  - Each turn gets its own AbortController that is aborted only while the turn is
 *    still running. The Codex SDK removes the child process's error listener when a
 *    turn ends but leaves the abort signal attached, so aborting a finished turn's
 *    signal (what Rig's close() does) crashes Node with an unhandled AbortError.
 *  - Runs read-only with no approval prompts, matching the Cursor engine.
 *  - Rig's default model aliases ("default", "small", ...) let Codex pick its configured model.
 *
 * Auth: `codex login`, or CODEX_API_KEY / OPENAI_API_KEY.
 */
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { Codex } from "@openai/codex-sdk";
import type { CodexOptions, ThreadOptions } from "@openai/codex-sdk";
import type { AgentFactory } from "rig";
import { toStrictSchema } from "./strict-schema.ts";

export type CodexEngineOptions = CodexOptions & { thread?: Omit<ThreadOptions, "model"> };

const DEFAULT_MODEL_ALIASES = new Set(["", "default", "small", "mini", "nano"]);

export function codexEngine(options: CodexEngineOptions = {}): AgentFactory {
  const { thread: threadOptions, ...clientOptions } = options;
  const apiKey = clientOptions.apiKey ?? process.env["CODEX_API_KEY"] ?? process.env["OPENAI_API_KEY"];
  const codexPathOverride = clientOptions.codexPathOverride ?? process.env["SDLC_CODEX_BIN"];

  return (agentOptions) => {
    if (agentOptions.tools && agentOptions.tools.length > 0) {
      throw new Error("codexEngine does not support Rig tools; pass context through agent input instead");
    }
    const systemMessage =
      typeof agentOptions.systemMessage === "string" ? agentOptions.systemMessage : undefined;
    const makeClient = (path?: string) =>
      new Codex({
        ...clientOptions,
        ...(apiKey && { apiKey }),
        ...(path && { codexPathOverride: path }),
        ...(systemMessage !== undefined && {
          config: { ...clientOptions.config, developer_instructions: systemMessage },
        }),
      });
    let codex: Codex;
    try {
      codex = makeClient(codexPathOverride);
    } catch (err) {
      // The SDK looks for its bundled CLI in node_modules, which the standalone
      // binary doesn't have. Fall back to a `codex` on PATH.
      const onPath = findOnPath(process.platform === "win32" ? "codex.exe" : "codex");
      if (!onPath) {
        throw new Error(
          `Codex CLI not found (${(err as Error).message}). Install it (npm i -g @openai/codex) or set SDLC_CODEX_BIN.`,
        );
      }
      codex = makeClient(onPath);
    }
    const model = agentOptions.model;
    const thread = codex.startThread({
      sandboxMode: "read-only",
      approvalPolicy: "never",
      skipGitRepoCheck: true,
      ...threadOptions,
      ...(model && !DEFAULT_MODEL_ALIASES.has(model) && { model }),
    });

    const running = new Set<AbortController>();
    let closed = false;

    return {
      async ask(prompt, askOptions = {}) {
        if (closed) throw new DOMException("Agent closed", "AbortError");
        const turn = new AbortController();
        const forward = () => turn.abort(askOptions.signal?.reason);
        if (askOptions.signal?.aborted) forward();
        askOptions.signal?.addEventListener("abort", forward, { once: true });
        running.add(turn);
        try {
          const result = await thread.run(prompt, {
            signal: turn.signal,
            ...(askOptions.outputSchema !== undefined && {
              outputSchema: toStrictSchema(askOptions.outputSchema as Record<string, unknown>),
            }),
          });
          const text = result.finalResponse;
          return typeof text === "string" ? text : JSON.stringify(text);
        } finally {
          // Detach before the SDK drops its listeners, so nothing aborts a finished child.
          running.delete(turn);
          askOptions.signal?.removeEventListener("abort", forward);
        }
      },
      async close() {
        closed = true;
        // Only turns that are still in flight; their child process still has its error listener.
        for (const turn of running) turn.abort(new DOMException("Agent closed", "AbortError"));
        running.clear();
      },
    };
  };
}

function findOnPath(name: string): string | undefined {
  for (const dir of (process.env["PATH"] ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}
