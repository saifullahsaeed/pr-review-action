import type { ReviewContext } from "./context.ts";

export type JudgementPass = "structure" | "quality" | "bug";

export const SYSTEM_PROMPT = [
  "You are Harrier, a code reviewer. Your sole job is to review a codebase and report what is",
  "wrong with it. You are read-only: you report problems, you never rewrite code.",
  "",
  "Rules you never break:",
  "1. Report only what you can point at. Every finding must cite a file and a line that appear",
  "   in the context you are given. Never invent a path or a line.",
  "2. No speculation. If you are not sure, leave it out. One real finding beats three maybes.",
  "3. Severity is consequence: critical = credentials, money or data loss; high = a real bug or",
  "   an exploitable path; medium = a defect waiting to happen; low = maintainability cost;",
  "   info = worth knowing.",
  "4. evidence is the exact line or lines that show the problem, copied verbatim from the context.",
  "",
  "Return ONLY a JSON object, no prose and no code fence, in exactly this shape:",
  '{"findings":[{"ruleName":"...","severity":"critical|high|medium|low|info","message":"...",',
  '"path":"src/x.ts","startLine":12,"endLine":14,"evidence":"...","confidence":"high|medium|low",',
  '"fixHint":"..."}],"overview":"two or three sentences on what matters most"}',
  "endLine, evidence and fixHint are optional; everything else is required. If there is nothing to",
  'report, return {"findings":[],"overview":"..."}.',
].join("\n");

export const PASS_BRIEFS: Record<JudgementPass, string> = {
  structure:
    "PASS: structure. Look for layering violations — code importing around its boundary instead " +
    "of through it — import cycles, files carrying several unrelated responsibilities, and code " +
    "living in the wrong module. These findings are about where things live and what depends on " +
    "what, not about the code inside a function.",
  quality:
    "PASS: quality. Look for duplicated logic, copy-paste that has drifted apart, dead code, " +
    "functions doing several jobs, error handling that hides failures, and shapes that will cost " +
    "the next reader real time. Do not report style preferences or formatting.",
  bug:
    "PASS: bugs. Look for logic errors: wrong operator or comparison, off-by-one, missing empty " +
    "or null handling, non-idempotent retries that repeat side effects, wrong ordering of " +
    "operations, resource leaks, unchecked error returns, and boundary conditions. Trace what the " +
    "code actually does; do not pattern-match on names.",
};

export function buildUserMessage(
  context: ReviewContext,
  pass: JudgementPass,
  priorFindings: readonly { ruleName: string; category: string; severity: string; message: string; path?: string; line?: number }[] = [],
  customInstructions?: string,
): string {
  const parts = [
    PASS_BRIEFS[pass],
    "",
    `Repository root: ${context.root}`,
    "",
    "## Tree",
    context.tree,
  ];

  if (customInstructions && customInstructions.trim().length > 0) {
    parts.push(
      "",
      "## Repository-Specific Review Instructions & Rules (Plain English)",
      customInstructions.trim(),
    );
  }

  if (priorFindings.length > 0) {
    parts.push(
      "",
      "## Findings from Automated Scanners & Metrics",
      "Deterministic tools and code metrics already flagged the following potential issues in these files:",
      ...priorFindings.slice(0, 30).map((f) => {
        const loc = f.path ? `${f.path}${f.line ? `:${f.line}` : ""}` : "repo-wide";
        return `- [${f.severity}] ${f.category} (${f.ruleName}) at ${loc}: ${f.message}`;
      }),
      "Use these as hints to verify or deepen your review where relevant, but do not simply duplicate them without semantic judgement.",
    );
  }

  parts.push(
    "",
    "## Source",
    context.body,
  );
  if (context.truncated.length > 0) {
    parts.push("", `Note: content for ${context.truncated.length} file(s) was truncated.`);
  }
  parts.push("", "Return the JSON object now.");
  return parts.join("\n");
}
