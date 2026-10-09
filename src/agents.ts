/**
 * The SDLC agents. Each one is a typed Rig agent: schema'd input in,
 * schema-validated JSON out (Rig repairs invalid JSON for up to maxTurns).
 */
import { agent, repair, s, steering, timeout } from "rig";

const severity = s.enum("blocker", "major", "minor", "nit");
const estimate = s.enum("XS", "S", "M", "L", "XL");

export function createAgents(model: string) {
  const common = {
    model,
    maxTurns: 3,
    addons: [timeout({ timeout: Number(process.env["SDLC_TIMEOUT_MS"] ?? 300_000) }), steering(), repair()],
  };

  // ---------- 1. Requirements -> user stories ----------
  const stories = agent({
    ...common,
    name: "stories",
    instructions: `You are a senior product engineer turning a raw feature idea into INVEST user stories.
- Split into small, independently shippable stories; group them under one epic.
- Acceptance criteria are testable Given/When/Then statements.
- Prioritize with MoSCoW and give a T-shirt estimate.
- Include non-functional stories (security, observability, performance) when the idea implies them.
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
          estimate,
        }),
      ),
      assumptions: s.array(s.string),
      openQuestions: s.array(s.string),
    }),
  });

  // ---------- 2. Design / technical plan ----------
  const plan = agent({
    ...common,
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
          estimate,
        }),
      ),
      rollout: s.array(s.string),
      risks: s.array(s.object({ risk: s.string, mitigation: s.string })),
      testStrategy: s.array(s.string),
    }),
  });

  // ---------- 3. Code review ----------
  const review = agent({
    ...common,
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
          severity,
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
  });

  // ---------- 4a. Tests ----------
  const tests = agent({
    ...common,
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

  // ---------- 4b. Release notes ----------
  const release = agent({
    ...common,
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

  // ---------- 5. Security ----------
  const security = agent({
    ...common,
    name: "security",
    instructions: `You are an application security engineer doing a secure code review of a change.
- Check the diff against OWASP Top 10 / ASVS: injection, authN/authZ & IDOR, secrets, crypto, SSRF, deserialization, XSS, path traversal, logging of sensitive data, insecure defaults, dependency risk.
- Use the scanner and dependency-audit output as evidence, but triage it: drop false positives, explain real ones.
- When a compliance focus is given (e.g. HIPAA, PCI-DSS, SOC 2, GDPR), add findings for controls the change affects (PHI/PII handling, audit logging, encryption at rest/in transit, access control, retention).
- Map findings to CWE ids where possible. Never repeat secret values.`,
    input: s.object({
      diff: s.string,
      changedFiles: s.array(s.string),
      secretHits: s.array(s.string),
      dependencyAudit: s.string,
      scannerOutput: s.string,
      complianceFocus: s.string("Comma-separated frameworks or empty"),
    }),
    output: s.object({
      riskLevel: s.enum("critical", "high", "medium", "low", "none"),
      summary: s.string,
      findings: s.array(
        s.object({
          severity: s.enum("critical", "high", "medium", "low", "info"),
          title: s.string,
          cwe: s.nullable(s.string),
          file: s.string,
          line: s.nullable(s.int),
          detail: s.string,
          remediation: s.string,
        }),
      ),
      complianceNotes: s.array(s.object({ framework: s.string, control: s.string, note: s.string })),
      checklist: s.array(s.string),
    }),
  });

  return { stories, plan, review, tests, release, security };
}

export type Agents = ReturnType<typeof createAgents>;
export type StoriesResult = Awaited<ReturnType<Agents["stories"]>>;
export type PlanResult = Awaited<ReturnType<Agents["plan"]>>;
export type ReviewResult = Awaited<ReturnType<Agents["review"]>>;
export type TestsResult = Awaited<ReturnType<Agents["tests"]>>;
export type ReleaseResult = Awaited<ReturnType<Agents["release"]>>;
export type SecurityResult = Awaited<ReturnType<Agents["security"]>>;
