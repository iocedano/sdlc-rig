#!/usr/bin/env node
// Stand-in for the `codex` CLI. Speaks the `codex exec --experimental-json` event
// protocol the SDK reads. FAKE_CODEX_MODE=fail answers like OpenAI rejecting the schema.
import { appendFileSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
const schemaPath = args.includes("--output-schema") ? args[args.indexOf("--output-schema") + 1] : undefined;
if (process.env.FAKE_CODEX_LOG) {
  appendFileSync(
    process.env.FAKE_CODEX_LOG,
    JSON.stringify({ args, schema: schemaPath ? JSON.parse(readFileSync(schemaPath, "utf8")) : null }) + "\n",
  );
}
process.stdin.resume();
process.stdin.on("end", () => {
  const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
  emit({ type: "thread.started", thread_id: "thread-1" });
  emit({ type: "turn.started" });
  if (process.env.FAKE_CODEX_MODE === "fail") {
    emit({ type: "turn.failed", error: { message: "Invalid schema for response_format 'codex_output_schema'" } });
    // Like the real CLI: still shutting down when the SDK kills it, so a later abort hits a live process.
    process.on("SIGTERM", () => {});
    setTimeout(() => process.exit(1), 1_500);
    return;
  }
  const review = { verdict: "approve", summary: "from fake codex", findings: [], strengths: ["small diff"] };
  emit({ type: "item.completed", item: { id: "m1", type: "agent_message", text: JSON.stringify(review) } });
  emit({ type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } });
});
