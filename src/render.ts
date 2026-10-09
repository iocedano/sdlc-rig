import type {
  PlanResult,
  ReleaseResult,
  ReviewResult,
  SecurityResult,
  StoriesResult,
  TestsResult,
} from "./agents.ts";

const list = (items: readonly string[], empty = "_None._") =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : empty;
const loc = (file: string, line: number | null) => (line ? `\`${file}:${line}\`` : `\`${file}\``);
const ICON: Record<string, string> = {
  blocker: "🛑", critical: "🛑", major: "🟠", high: "🟠", minor: "🟡", medium: "🟡", nit: "⚪", low: "⚪", info: "🔵",
};

export function renderStories(r: StoriesResult): string {
  const stories = r.stories
    .map(
      (st) => `### ${st.id} — ${st.title}  \`${st.priority.toUpperCase()}\` · \`${st.estimate}\`

**As a** ${st.asA}, **I want** ${st.iWant}, **so that** ${st.soThat}.

${st.acceptanceCriteria.map((c) => `- [ ] ${c}`).join("\n")}`,
    )
    .join("\n\n");
  return `# Epic: ${r.epic.title}

${r.epic.goal}

## User stories

${stories}

## Assumptions
${list(r.assumptions)}

## Open questions
${list(r.openQuestions)}
`;
}

export function renderPlan(r: PlanResult): string {
  const tasks = r.tasks
    .map(
      (t) =>
        `| ${t.id} | ${t.title} | ${t.estimate} | ${t.dependsOn.join(", ") || "—"} | ${t.files.map((f) => `\`${f}\``).join(", ") || "—"} |`,
    )
    .join("\n");
  return `# Technical plan

${r.summary}

## Approach
${r.approach}

## Components
${r.components.map((c) => `- **${c.name}** — ${c.responsibility}${c.files.length ? ` (${c.files.map((f) => `\`${f}\``).join(", ")})` : ""}`).join("\n") || "_None._"}

## Data model changes
${list(r.dataModelChanges)}

## API changes
${list(r.apiChanges)}

## Tasks
| ID | Task | Est. | Depends on | Files |
|---|---|---|---|---|
${tasks}

${r.tasks.map((t) => `**${t.id}. ${t.title}** — ${t.description}`).join("\n\n")}

## Rollout
${list(r.rollout)}

## Risks
${r.risks.map((x) => `- **${x.risk}** → ${x.mitigation}`).join("\n") || "_None._"}

## Test strategy
${list(r.testStrategy)}
`;
}

export function renderReview(r: ReviewResult): string {
  const verdict = { approve: "✅ Approve", comment: "💬 Comment", request_changes: "❌ Request changes" }[r.verdict];
  const findings = r.findings
    .map(
      (f) => `#### ${ICON[f.severity] ?? ""} [${f.severity}] ${f.title} — ${loc(f.file, f.line)}
_${f.category}_ · ${f.detail}

**Suggestion:** ${f.suggestion}`,
    )
    .join("\n\n");
  return `## Code review — ${verdict}

${r.summary}

### Findings (${r.findings.length})
${findings || "_No issues found._"}

### Strengths
${list(r.strengths)}
`;
}

export function renderTests(r: TestsResult, command: string): string {
  const status = { passing: "✅ passing", failing: "❌ failing", not_run: "⏭️ not run" }[r.status];
  return `## Tests — ${status}${command ? ` (\`${command}\`)` : ""}

${r.summary}

### Failures
${r.failures.map((f) => `- **${f.test}** — ${f.likelyCause}\n  - Fix: ${f.suggestedFix}`).join("\n") || "_None._"}

### Missing tests
${
  r.missingTests
    .map((t) => `- **${t.scenario}** (${t.type}) → \`${t.file}\`\n\n\`\`\`\n${t.sketch}\n\`\`\``)
    .join("\n") || "_None._"
}

### Coverage risks
${list(r.coverageRisks)}
`;
}

export function renderRelease(r: ReleaseResult, since: string): string {
  const section = (title: string, items: readonly string[]) => (items.length ? `### ${title}\n${list(items)}\n\n` : "");
  return `# ${r.nextVersion} — ${r.title}

_Bump: **${r.bump}** (since ${since})_

${list(r.highlights, "")}

${section("⚠️ Breaking changes", r.breaking)}${section("✨ Features", r.features)}${section("🐛 Fixes", r.fixes)}${section("🔒 Security", r.security)}${section("🧹 Maintenance", r.chores)}${section("Upgrade notes", r.upgradeNotes)}`.trimEnd() + "\n";
}

export function renderSecurity(r: SecurityResult): string {
  const findings = r.findings
    .map(
      (f) => `#### ${ICON[f.severity] ?? ""} [${f.severity}] ${f.title}${f.cwe ? ` (${f.cwe})` : ""} — ${loc(f.file, f.line)}
${f.detail}

**Remediation:** ${f.remediation}`,
    )
    .join("\n\n");
  return `## Security review — risk: **${r.riskLevel}**

${r.summary}

### Findings (${r.findings.length})
${findings || "_No security issues found._"}

${r.complianceNotes.length ? `### Compliance\n| Framework | Control | Note |\n|---|---|---|\n${r.complianceNotes.map((c) => `| ${c.framework} | ${c.control} | ${c.note} |`).join("\n")}\n\n` : ""}### Checklist
${r.checklist.map((c) => `- [ ] ${c}`).join("\n") || "_None._"}
`;
}
