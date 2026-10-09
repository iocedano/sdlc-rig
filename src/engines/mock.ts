/**
 * Offline engine: answers with a placeholder value that satisfies the requested
 * output schema. Use it to try the CLI, wire up CI, or run tests without an LLM.
 */
import type { AgentFactory } from "rig";

type JsonSchema = {
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: JsonSchema | boolean;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  description?: string;
};

export function mockEngine(): AgentFactory {
  return () => ({
    async ask(_prompt, options = {}) {
      return JSON.stringify(sample((options.outputSchema ?? { type: "string" }) as JsonSchema, "result"));
    },
    async close() {},
  });
}

export function sample(schema: JsonSchema, name: string): unknown {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum?.length) return schema.enum[0];
  const variant = schema.anyOf ?? schema.oneOf;
  if (variant?.length) return sample(variant.find((v) => v.type !== "null") ?? variant[0]!, name);
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type;
  switch (type) {
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(schema.properties ?? {})) out[key] = sample(child, key);
      if (!schema.properties && typeof schema.additionalProperties === "object") {
        out["example"] = sample(schema.additionalProperties, "example");
      }
      return out;
    }
    case "array":
      return [sample(schema.items ?? { type: "string" }, name)];
    case "integer":
      return 1;
    case "number":
      return 1;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      return `(mock ${name})`;
  }
}
