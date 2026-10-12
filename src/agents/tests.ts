import { agent, s } from "rig";
import { createCommon } from "./model.ts";

type TestsAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createTestsAgent(option: TestsAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
    name: "tests",
    instructions: `You are a test engineer.
- If the test run failed, explain each failure's most likely root cause from the output and propose a fix.
- Identify behavior introduced by the diff that has no test, and sketch the missing tests in the repo's existing test style/framework.
- status is "not_run" when no test command ran.`,
    input: s.object({
      diff: s.string,
      changedFiles: s.array(s.string),
      testCommand: s.string,
      testExitCode: s.int,
      testOutput: s.string,
    }),
    output: s.object({
      status: s.enum("passing", "failing", "not_run"),
      summary: s.string,
      failures: s.array(s.object({ test: s.string, likelyCause: s.string, suggestedFix: s.string })),
      missingTests: s.array(
        s.object({
          file: s.string("Where the test should live"),
          scenario: s.string,
          type: s.enum("unit", "integration", "e2e"),
          sketch: s.string("Test code sketch"),
        }),
      ),
      coverageRisks: s.array(s.string),
    }),
  });
};

export default createTestsAgent;
