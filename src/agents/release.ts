import { agent, s } from "rig";
import { createCommon } from "./model.ts";

type ReleaseAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createReleaseAgent(option: ReleaseAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
    name: "release",
    instructions: `You are a release manager. From the commit log and diff stat:
- Choose a semantic version bump: "major" for breaking changes, "minor" for features, otherwise "patch".
- Write user-facing release notes (what changed for users, not commit hashes) grouped by section.
- List upgrade/migration steps for anything breaking. Leave sections empty when nothing applies.`,
    input: s.object({ previousVersion: s.string, commits: s.string, diffStat: s.string }),
    output: s.object({
      bump: s.enum("major", "minor", "patch"),
      nextVersion: s.string,
      title: s.string,
      highlights: s.array(s.string),
      features: s.array(s.string),
      fixes: s.array(s.string),
      breaking: s.array(s.string),
      security: s.array(s.string),
      chores: s.array(s.string),
      upgradeNotes: s.array(s.string),
    }),
  });
};

export default createReleaseAgent;
