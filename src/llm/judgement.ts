import type { Category, FindingInput, Severity } from "../findings.ts";
import { CATEGORIES, SEVERITIES, validateFindingInput } from "../findings.ts";
import type { ChatMessage, ChatResult } from "./client.ts";
import type { ReviewContext } from "./context.ts";
import type { JudgementPass } from "./prompts.ts";
import { PASS_BRIEFS, SYSTEM_PROMPT, buildUserMessage } from "./prompts.ts";

const CATEGORY_OF_PASS: Record<JudgementPass, Category> = {
  structure: "structure",
  quality: "quality",
  bug: "bug",
};

export interface RawJudgement {
  ruleName?: string;
  severity?: string;
  message?: string;
  path?: string;
  startLine?: number;
  endLine?: number;
  evidence?: string;
  confidence?: string;
  fixHint?: string;
}

export interface JudgementResponse {
  findings?: RawJudgement[];
  overview?: string;
}

export interface PassStatus {
  pass: JudgementPass;
  status: "ok" | "failed";
  detail?: string;
}

export interface JudgementResult {
  findings: FindingInput[];
  /** What the model produced that failed the self-check. Kept for the log, never shipped. */
  dropped: RawJudgement[];
  overview?: string;
  passes: PassStatus[];
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Models wrap JSON in fences and prose. Take the outermost object rather than trusting either. */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("no JSON object in the model response");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * The self-check: a finding with no real path and line is dropped, not shipped. The model is
 * told to cite locations; this is where that instruction is enforced.
 */
export function parseJudgementResponse(
  pass: JudgementPass,
  text: string,
): { findings: FindingInput[]; dropped: RawJudgement[]; overview?: string } {
  const parsed = extractJson(text) as JudgementResponse;
  const findings: FindingInput[] = [];
  const dropped: RawJudgement[] = [];
  for (const raw of parsed.findings ?? []) {
    const severity = (SEVERITIES as readonly string[]).includes(raw.severity ?? "")
      ? (raw.severity as Severity)
      : "medium";
    const confidence =
      raw.confidence === "high" || raw.confidence === "medium" || raw.confidence === "low"
        ? raw.confidence
        : "medium";
    const category = CATEGORY_OF_PASS[pass];
    if (!(CATEGORIES as readonly string[]).includes(category)) {
      dropped.push(raw);
      continue;
    }
    const candidate: FindingInput = {
      ruleId: `llm/${pass}.${slug(raw.ruleName ?? "finding")}`,
      ruleName: raw.ruleName ?? `${pass} finding`,
      category,
      severity,
      message: raw.message ?? "",
      locations:
        typeof raw.path === "string" && typeof raw.startLine === "number"
          ? [
              {
                path: raw.path,
                startLine: raw.startLine,
                ...(typeof raw.endLine === "number" ? { endLine: raw.endLine } : {}),
              },
            ]
          : [],
      source: "llm",
      confidence,
    };
    if (typeof raw.evidence === "string" && raw.evidence.trim() !== "") {
      candidate.evidence = raw.evidence;
    }
    if (typeof raw.fixHint === "string" && raw.fixHint.trim() !== "") {
      candidate.fixHint = raw.fixHint;
    }
    if (validateFindingInput(candidate).length > 0) {
      dropped.push(raw);
      continue;
    }
    findings.push(candidate);
  }
  const result: { findings: FindingInput[]; dropped: RawJudgement[]; overview?: string } = {
    findings,
    dropped,
  };
  if (typeof parsed.overview === "string" && parsed.overview.trim() !== "") {
    result.overview = parsed.overview;
  }
  return result;
}

export type CompleteFn = (messages: ChatMessage[]) => Promise<ChatResult>;

export async function runJudgement(
  completeFn: CompleteFn,
  context: ReviewContext,
  passes: JudgementPass[] = ["structure", "quality", "bug"],
  priorFindings: readonly { ruleName: string; category: string; severity: string; message: string; path?: string; line?: number }[] = [],
): Promise<JudgementResult> {
  const findings: FindingInput[] = [];
  const dropped: RawJudgement[] = [];
  const statuses: PassStatus[] = [];
  const overviews: string[] = [];

  for (const pass of passes) {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserMessage(context, pass, priorFindings) },
    ];
    try {
      const response = await completeFn(messages);
      const parsed = parseJudgementResponse(pass, response.content);
      findings.push(...parsed.findings);
      dropped.push(...parsed.dropped);
      if (parsed.overview !== undefined) overviews.push(`${pass}: ${parsed.overview}`);
      statuses.push({ pass, status: "ok" });
    } catch (error) {
      statuses.push({ pass, status: "failed", detail: String(error).slice(0, 300) });
    }
  }

  const result: JudgementResult = { findings, dropped, passes: statuses };
  if (overviews.length > 0) result.overview = overviews.join("\n\n");
  return result;
}

export { PASS_BRIEFS };
