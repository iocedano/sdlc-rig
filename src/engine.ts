import { configureAgent, copilotEngine } from "rig";
import { cursorEngine } from "./engines/cursor.ts";
import { mockEngine } from "./engines/mock.ts";

export const ENGINES = ["auto", "cursor", "anthropic", "codex", "gemini", "copilot", "mock"] as const;
export type EngineName = (typeof ENGINES)[number];

/** Model used when --model / SDLC_MODEL is not set. "default" lets the engine pick. */
const DEFAULT_MODELS: Record<EngineName, string> = {
  auto: "small",
  cursor: "default",
  anthropic: "claude-sonnet-4-5",
  codex: "default",
  gemini: "gemini-2.5-pro",
  copilot: "small",
  mock: "mock",
};

export type EngineConfig = { engine: EngineName; model: string };

export function resolveEngineConfig(engine?: string, model?: string): EngineConfig {
  const name = (engine ?? process.env["SDLC_ENGINE"] ?? "auto") as EngineName;
  if (!ENGINES.includes(name)) {
    throw new Error(`Unknown engine "${name}". Use one of: ${ENGINES.join(", ")}`);
  }
  return { engine: name, model: model ?? process.env["SDLC_MODEL"] ?? DEFAULT_MODELS[name] };
}

/** Wires the chosen engine into Rig. "auto" keeps Rig's env-based selection. */
export async function setupEngine({ engine }: EngineConfig): Promise<void> {
  switch (engine) {
    case "auto":
      return;
    case "cursor":
      return configureAgent(cursorEngine());
    case "mock":
      return configureAgent(mockEngine());
    case "copilot":
      return configureAgent(copilotEngine());
    case "anthropic": {
      const { anthropicEngine } = await import("rig/engines/anthropic");
      return configureAgent(anthropicEngine({ maxTokens: 16_000 }));
    }
    case "codex": {
      const { codexEngine } = await import("rig/engines/codex");
      return configureAgent(codexEngine());
    }
    case "gemini": {
      const { geminiEngine } = await import("rig/engines/gemini");
      return configureAgent(geminiEngine());
    }
  }
}
