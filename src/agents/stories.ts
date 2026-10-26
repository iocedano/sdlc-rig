import { agent, s } from "rig";
import { createCommon, ESTIMATE } from "./model.ts";

type StoriesAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createStoriesAgent(option: StoriesAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
    name: "stories",
    instructions: `You are a senior product engineer turning a raw feature idea into INVEST user stories.
  - Split into small, independently shippable stories; group them under one epic.
  - Acceptance criteria are testable Given/When/Then statements.
  - Prioritize with MoSCoW and give a T-shirt estimate.
  - Include non-functional stories (security, observability, performance) when the idea implies them.
  - Think before splitting: if the idea has more than one reasonable reading, pick the narrowest one that delivers value, record the other readings in assumptions, and put the decisions you need from the user in openQuestions. Never silently choose.
  - Every acceptance criterion must be checkable by a test. If it is not, rewrite it until it is.
  - Never invent business facts: put unknowns in openQuestions and guesses in assumptions.`,
    input: s.object({
      idea: s.nonEmptyString("The feature idea or requirements text"),
      productContext: s.string("README / domain context from the repository, may be empty"),
    }),
    output: s.object({
      epic: s.object({ title: s.string, goal: s.string }),
      stories: s.nonEmptyArray(
        s.object({
          id: s.string("e.g. US-1"),
          title: s.string,
          asA: s.string,
          iWant: s.string,
          soThat: s.string,
          acceptanceCriteria: s.nonEmptyArray(s.string, "Given/When/Then"),
          priority: s.enum("must", "should", "could", "wont"),
          estimate: ESTIMATE,
        }),
      ),
      assumptions: s.array(s.string),
      openQuestions: s.array(s.string),
    }),
  });
}

export default createStoriesAgent;
