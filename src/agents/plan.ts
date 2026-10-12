import { agent, s } from "rig";
import { createCommon, ESTIMATE } from "./model.ts";

type PlanAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createPlanAgent(option: PlanAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
    name: "plan",
    instructions: `You are a staff engineer writing a technical design for a feature in THIS repository.
- Ground every decision in the provided file tree and key files; reference real paths.
- Prefer extending existing patterns over new frameworks.
- Break work into tasks of at most one day each, with explicit dependencies (task ids).
- Call out data model/API changes, migrations, rollout and rollback, and risks.`,
    input: s.object({
      feature: s.nonEmptyString,
      stories: s.string("JSON of user stories from the stories step, may be empty"),
      fileTree: s.string,
      keyFiles: s.record(s.string, "path -> content"),
    }),
    output: s.object({
      summary: s.string,
      approach: s.string,
      components: s.array(s.object({ name: s.string, responsibility: s.string, files: s.array(s.string) })),
      dataModelChanges: s.array(s.string),
      apiChanges: s.array(s.string),
      tasks: s.nonEmptyArray(
        s.object({
          id: s.string("e.g. T-1"),
          title: s.string,
          description: s.string,
          files: s.array(s.string),
          dependsOn: s.array(s.string),
          estimate: ESTIMATE,
        }),
      ),
      rollout: s.array(s.string),
      risks: s.array(s.object({ risk: s.string, mitigation: s.string })),
      testStrategy: s.array(s.string),
    }),
  });
};

export default createPlanAgent;
