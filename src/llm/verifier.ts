import type { FindingInput } from "../findings.ts";
import type { CompleteFn } from "./judgement.ts";
import type { ReviewContext } from "./context.ts";
import { extractJson } from "./judgement.ts";

export const VERIFIER_SYSTEM_PROMPT = [
  "You are an adversarial verifier for a code review tool.",
  "Your task is to review candidate findings and determine whether each one is a genuine issue or a hallucination/false positive.",
  "You must be skeptical. Reject findings that:",
  "1. Fail to identify a real defect (e.g. flagging safe or idiomatic patterns as bugs).",
  "2. Misunderstand the context or assume unstated invariants.",
  "3. Complain about nitpicks with no measurable consequence.",
  "Respond strictly with a JSON object: {\"verdicts\": [{\"findingIndex\": number, \"status\": \"keep\" | \"drop\", \"reason\": string}]}",
].join("\n");

export interface FindingVerdict {
  findingIndex: number;
  status: "keep" | "drop";
  reason: string;
}

export async function verifyCandidateFindings(
  completeFn: CompleteFn,
  context: ReviewContext,
  candidateFindings: FindingInput[],
): Promise<{ verified: FindingInput[]; dropped: Array<{ finding: FindingInput; reason: string }> }> {
  // Only verify LLM-generated findings; deterministic scanner findings (osv, gitleaks, metrics) are verified by tool output
  const llmCandidatesWithIndex = candidateFindings
    .map((f, i) => ({ finding: f, index: i }))
    .filter((item) => item.finding.source === "llm");

  if (llmCandidatesWithIndex.length === 0) {
    return { verified: candidateFindings, dropped: [] };
  }

  const prompt = [
    "Here are the candidate findings generated during the review pass:",
    ...llmCandidatesWithIndex.map(({ finding, index }) => {
      const loc = finding.locations[0]
        ? `${finding.locations[0].path}:${finding.locations[0].startLine}`
        : "unknown";
      return `[Candidate #${index}] [${finding.severity}] ${finding.ruleName} at ${loc}: ${finding.message}\nEvidence: ${finding.evidence ?? "(none)"}\n`;
    }),
    "Verify each candidate against the code below. If it is a false positive or hallucination, set status to 'drop' with an explicit reason.",
    "",
    "## Code Context",
    context.body,
  ].join("\n");

  const messages = [
    { role: "system" as const, content: VERIFIER_SYSTEM_PROMPT },
    { role: "user" as const, content: prompt },
  ];

  try {
    const response = await completeFn(messages);
    const parsed = extractJson(response.content) as { verdicts?: FindingVerdict[] };
    const verdicts = new Map<number, FindingVerdict>();
    if (Array.isArray(parsed.verdicts)) {
      for (const v of parsed.verdicts) {
        if (typeof v.findingIndex === "number") {
          verdicts.set(v.findingIndex, v);
        }
      }
    }

    const verified: FindingInput[] = [];
    const dropped: Array<{ finding: FindingInput; reason: string }> = [];

    candidateFindings.forEach((finding, idx) => {
      if (finding.source !== "llm") {
        verified.push(finding);
        return;
      }
      const verdict = verdicts.get(idx);
      if (verdict && verdict.status === "drop") {
        dropped.push({ finding, reason: verdict.reason });
      } else {
        verified.push(finding);
      }
    });

    return { verified, dropped };
  } catch (err) {
    // If the verifier pass times out or fails to parse, preserve original findings rather than wiping the review
    return { verified: candidateFindings, dropped: [] };
  }
}
