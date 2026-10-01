import { execFileSync } from "node:child_process";
import type { ReviewContext } from "./context.ts";
import { collectSourceFiles } from "../probes/metrics.ts";
import { buildCodebaseAstGraph } from "../probes/astGraph.ts";

export interface BatchBudget {
  maxFiles: number;
  maxLinesPerFile: number;
  maxTotalLines: number;
  maxChars: number;
  maxBatches: number;
}
export const DEFAULT_BATCH_BUDGET: BatchBudget = {
  maxFiles: 40, maxLinesPerFile: 400, maxTotalLines: 6000, maxChars: 48000, maxBatches: 100,
};
export function validateBatchBudget(value: unknown): BatchBudget {
  if (value === undefined) return { ...DEFAULT_BATCH_BUDGET };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("budget must be an object");
  const result = { ...DEFAULT_BATCH_BUDGET };
  for (const [key, v] of Object.entries(value)) {
    if (!(key in result)) throw new Error(`Unknown budget option: ${key}`);
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 1) throw new Error(`budget.${key} must be a positive integer`);
    result[key as keyof BatchBudget] = v;
  }
  if (result.maxChars < 512) throw new Error("budget.maxChars must be at least 512");
  return result;
}
export interface LineRange { path: string; startLine: number; endLine: number }
export interface ReviewBatch { context: ReviewContext; ranges: LineRange[]; supportRanges: LineRange[] }
export interface AiCoverage {
  status: "complete" | "partial" | "failed" | "disabled";
  mode: "diff" | "repository";
  plannedFiles: number;
  plannedRanges: LineRange[];
  batches: Array<{ index: number; ranges: LineRange[]; supportRanges: LineRange[]; passes: Array<{ pass: string; status: string; detail?: string }>; verifier: "ok" | "failed" | "not-needed" }>;
  skipped: Array<{ path: string; reason: string; startLine?: number; endLine?: number }>;
  detail?: string;
}
export interface BatchPlan { batches: ReviewBatch[]; coverage: AiCoverage }

/** Parse git's explicit unquoted name list separately from hunk headers (including spaces). */
export function planBatches(root: string, budget: BatchBudget, diffRef?: string): BatchPlan {
  const source = collectSourceFiles(root);
  const byPath = new Map(source.map(f => [f.path, f]));
  const skipped: AiCoverage["skipped"] = [];
  let paths = source.map(f => f.path);
  if (diffRef !== undefined) {
    paths = execFileSync("git", ["diff", "--name-only", "-z", diffRef, "--"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).split("\0").filter(Boolean);
  }
  const segments: LineRange[] = [];
  for (const path of paths) {
    const file = byPath.get(path);
    if (!file) { skipped.push({ path, reason: "Deleted, unsupported, or excluded by source collector" }); continue; }
    const ranges: Array<[number, number]> = [];
    if (diffRef !== undefined) {
      const patch = execFileSync("git", ["diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--unified=3", diffRef, "--", path], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
      for (const match of patch.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
        const start = Number(match[1]); const count = match[2] === undefined ? 1 : Number(match[2]);
        if (count > 0) ranges.push([Math.max(1, start), Math.min(file.lines.length, start + count - 1)]);
      }
      if (!ranges.length) { skipped.push({ path, reason: "No current-side text hunk (binary, mode-only, or deletion-only change)" }); continue; }
    } else ranges.push([1, file.lines.length]);
    const merged: Array<[number, number]> = [];
    for (const [start, end] of ranges.sort((a, b) => a[0] - b[0])) {
      const last = merged.at(-1);
      if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
      else merged.push([start, end]);
    }
    for (const [start, end] of merged) segments.push({ path, startLine: start, endLine: end });
  }
  let reverse = new Map<string, Set<string>>();
  try { reverse = buildCodebaseAstGraph(root).reverseDependencies; } catch { /* optional support retrieval */ }
  const batches: ReviewBatch[] = [];
  let parts: string[] = [], ranges: LineRange[] = [], supportRanges: LineRange[] = [];
  let lines = 0, chars = 0;
  let files = new Set<string>();
  const flush = () => {
    if (!ranges.length) return;
    // Spend remaining budget on short excerpts of direct callers, never at the cost of changed lines.
    for (const target of [...files]) {
      for (const dep of reverse.get(target) ?? []) {
        if (files.has(dep) || files.size >= budget.maxFiles) continue;
        const support = byPath.get(dep);
        if (!support) continue;
        const header = `## ${dep} (support excerpt, not changed-code coverage)\n`;
        let text = header, count = 0;
        for (let i = 0; i < Math.min(support.lines.length, budget.maxLinesPerFile, 40); i++) {
          const line = `${String(i + 1).padStart(5)}| ${support.lines[i]}\n`;
          if (chars + text.length + line.length + 2 > budget.maxChars || lines + count + 1 > budget.maxTotalLines) break;
          text += line; count++;
        }
        if (count) { parts.push(text); chars += text.length + 2; lines += count; files.add(dep); supportRanges.push({ path: dep, startLine: 1, endLine: count }); }
      }
    }
    const allRanges = [...ranges, ...supportRanges];
    batches.push({ ranges, supportRanges, context: { root, tree: [...files].join("\n"), body: parts.join("\n\n"), included: [...files], truncated: [], ranges: allRanges } });
    parts = []; ranges = []; supportRanges = []; lines = 0; chars = 0; files = new Set();
  };
  for (const segment of segments) {
    let cursor = segment.startLine;
    while (cursor <= segment.endLine) {
      if (batches.length >= budget.maxBatches) { skipped.push({ ...segment, startLine: cursor, reason: "Maximum batch budget reached" }); break; }
      if ((!files.has(segment.path) && files.size >= budget.maxFiles) || lines >= budget.maxTotalLines) {
        flush();
        continue;
      }
      const header = `## ${segment.path}\n`;
      const file = byPath.get(segment.path)!;
      let text = header, count = 0;
      const already = ranges.filter(r => r.path === segment.path).reduce((n, r) => n + r.endLine - r.startLine + 1, 0);
      while (cursor + count <= segment.endLine && count + already < budget.maxLinesPerFile && lines + count < budget.maxTotalLines) {
        const line = `${String(cursor + count).padStart(5)}| ${file.lines[cursor + count - 1]}\n`;
        if (chars + text.length + line.length + 2 > budget.maxChars) break;
        text += line; count++;
      }
      if (!count) {
        if (ranges.length) { flush(); continue; }
        skipped.push({ path: segment.path, startLine: cursor, endLine: cursor, reason: "Line exceeds character budget" }); cursor++; continue;
      }
      parts.push(text); ranges.push({ path: segment.path, startLine: cursor, endLine: cursor + count - 1 });
      files.add(segment.path); chars += text.length + 2; lines += count; cursor += count;
    }
  }
  flush();
  return { batches, coverage: { status: skipped.length ? "partial" : "complete", mode: diffRef === undefined ? "repository" : "diff", plannedFiles: new Set(segments.map(s => s.path)).size, plannedRanges: segments, batches: [], skipped } };
}
