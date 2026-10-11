/**
 * Converts a Rig output schema into one OpenAI accepts in strict structured-output
 * mode (used by Codex `--output-schema`):
 *  - every object gets `additionalProperties: false`
 *  - every property is listed in `required`; fields that were optional become nullable
 *  - keywords strict mode rejects are dropped (the prompt still describes the shape)
 *
 * Records (`s.record`, objects with only `additionalProperties: <schema>`) cannot be
 * expressed in strict mode, so they are rejected with a clear error.
 */
type Schema = Record<string, any>;

const UNSUPPORTED = new Set([
  "minLength", "maxLength", "minProperties", "maxProperties",
  "patternProperties", "propertyNames", "unevaluatedProperties",
  "if", "then", "else", "not", "dependentRequired", "dependentSchemas", "default", "examples",
]);

export function toStrictSchema(schema: Schema, path = "$"): Schema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
  const out: Schema = {};
  for (const [key, value] of Object.entries(schema)) {
    if (!UNSUPPORTED.has(key)) out[key] = value;
  }

  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(out[key])) out[key] = out[key].map((s: Schema, i: number) => toStrictSchema(s, `${path}.${key}[${i}]`));
  }
  // Strict mode supports anyOf but not oneOf.
  if (out["oneOf"]) {
    out["anyOf"] = out["oneOf"];
    delete out["oneOf"];
  }
  if (out["items"]) out["items"] = toStrictSchema(out["items"], `${path}[]`);

  const isObject = out["type"] === "object" || (Array.isArray(out["type"]) && out["type"].includes("object"));
  if (isObject) {
    if (!out["properties"] && typeof out["additionalProperties"] === "object") {
      throw new Error(
        `Output schema at ${path} is a record (open-ended keys), which strict structured output does not support. Use an array of { key, value } objects instead.`,
      );
    }
    const properties: Schema = {};
    const required = new Set<string>(out["required"] ?? []);
    for (const [name, child] of Object.entries<Schema>(out["properties"] ?? {})) {
      let converted = toStrictSchema(child, `${path}.${name}`);
      if (!required.has(name)) converted = makeNullable(converted);
      properties[name] = converted;
    }
    out["properties"] = properties;
    out["required"] = Object.keys(properties);
    out["additionalProperties"] = false;
  }
  return out;
}

function makeNullable(schema: Schema): Schema {
  if (schema["type"] === "null") return schema;
  if (Array.isArray(schema["anyOf"])) {
    return schema["anyOf"].some((s: Schema) => s["type"] === "null")
      ? schema
      : { ...schema, anyOf: [...schema["anyOf"], { type: "null" }] };
  }
  const { description, ...rest } = schema;
  return { ...(description !== undefined && { description }), anyOf: [rest, { type: "null" }] };
}
