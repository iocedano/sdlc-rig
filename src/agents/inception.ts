import { agent, s } from "rig";
import { createCommon } from "./model.ts";

type InceptionAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createInceptionAgent(option: InceptionAgentOptions) {
  return agent({
    ...createCommon(),
    ...option,
    name: "inception",
    instructions: `You are a Project Inception & Security Auditor. You onboard an engineer to a repository they have never seen.
- READ-ONLY. You never edit, commit or delete anything, and you never claim you did.
- The deterministic facts (manifests, lockfiles, .gitignore coverage, sensitive files, unpinned dependencies, secret hits, entry candidates) were computed in code and are authoritative. Explain them and add judgment on top. Do not contradict them.
- Infer the stack from manifests and key files only. Name the language version, runtime, framework, database connectors and main libraries. Write "unknown" rather than guess.
- Judge the architecture from the tree and entry points (Monolith, Microservices, Clean/Hexagonal, MVC, Serverless, Monorepo, REST API, ...). Write "unclear" when the evidence is thin.
- Security: look for auth middleware (JWT, OAuth, sessions), input validation, security headers, CORS and rate limiting. Mark a control "Warn" when you cannot find it. Use "Fail" only for a clear gap for this kind of service.
- Never print secret values. Refer to them by file and pattern only.
- Keep it concise and scannable. Keep only high-signal findings, and give each one a concrete remediation.`,
    input: s.object({
      repoName: s.string,
      facts: s.string("Deterministic facts computed in code, as text"),
      tree: s.string("Tracked or walked file list, capped"),
      keyFiles: s.string("Manifests, configs, README and entry files, truncated and secret-redacted"),
    }),
    output: s.object({
      stack: s.object({
        languages: s.array(s.string),
        runtimes: s.array(s.string),
        frameworks: s.array(s.string),
        databases: s.array(s.string),
        notableLibraries: s.array(s.string),
      }),
      architecture: s.string,
      keyDirectories: s.array(s.object({ path: s.string, purpose: s.string })),
      entryPoints: s.array(s.string),
      buildRunCommands: s.array(s.string),
      authAndAccess: s.object({ status: s.enum("Pass", "Fail", "Warn"), observations: s.string }),
      inputValidation: s.object({ status: s.enum("Pass", "Fail", "Warn"), observations: s.string }),
      securityHeadersCorsRateLimit: s.object({ status: s.enum("Pass", "Fail", "Warn"), observations: s.string }),
      findings: s.array(
        s.object({
          severity: s.enum("critical", "high", "medium", "low", "info"),
          title: s.string,
          file: s.nullable(s.string),
          detail: s.string,
          remediation: s.string,
        }),
      ),
      nextSteps: s.array(s.string),
    }),
  });
}

export default createInceptionAgent;
