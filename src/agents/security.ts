import { agent, s } from "rig";
import { createCommon } from "./model.ts";

type SecurityAgentOptions = Pick<Parameters<typeof agent>[0], "model">;

function createSecurityAgent(option: SecurityAgentOptions){
  return agent({
    ...createCommon(),
    ...option,
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
};

export default createSecurityAgent;
