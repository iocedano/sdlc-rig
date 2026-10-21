import { agent, s } from "rig";
import { createCommon, SEVERITY } from "./model.ts";

type ReviewAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createReviewAgent(option: ReviewAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
    name: "review",
    instructions: `You are a meticulous senior reviewer. Review ONLY the provided diff.
- Focus on correctness, edge cases, error handling, concurrency, performance, maintainability and tests.
- Every finding cites a file and, when possible, the new-file line number from the diff hunk.
- Give a concrete suggestion (code when useful). Do not report style issues a linter would catch as more than "nit".
- verdict: "request_changes" if any blocker, "comment" if only major/minor, otherwise "approve".
- If the diff is empty, approve with a summary saying there is nothing to review.`,
    input: s.object({ diff: s.string, changedFiles: s.array(s.string), commits: s.string }),
    output: s.object({
      verdict: s.enum("approve", "comment", "request_changes"),
      summary: s.string,
      findings: s.array(
        s.object({
          severity: SEVERITY,
          category: s.enum("correctness", "security", "performance", "reliability", "maintainability", "testing", "style"),
          file: s.string,
          line: s.nullable(s.int),
          title: s.string,
          detail: s.string,
          suggestion: s.string,
        }),
      ),
      strengths: s.array(s.string),
    }),
  })
};

export default createReviewAgent;
