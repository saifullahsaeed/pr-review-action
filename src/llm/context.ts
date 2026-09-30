import { collectSourceFiles } from "../probes/metrics.ts";

export interface ReviewContext {
  root: string;
  /** The tree, as the model sees it. */
  tree: string;
  /** File bodies with line numbers, because a model cites the lines you show it. */
  body: string;
  included: string[];
  /** Files whose content was cut short, so the report can say the view was partial. */
  truncated: string[];
}

export interface ContextBudget {
  maxFiles: number;
  maxLinesPerFile: number;
  maxTotalLines: number;
  targetFiles?: string[];
}

export const DEFAULT_BUDGET: ContextBudget = {
  maxFiles: 40,
  maxLinesPerFile: 400,
  maxTotalLines: 6000,
};

export function buildContext(
  root: string,
  budget: Partial<ContextBudget> = {},
): ReviewContext {
  const limits = { ...DEFAULT_BUDGET, ...budget };
  let files = collectSourceFiles(root);

  if (limits.targetFiles && limits.targetFiles.length > 0) {
    const targetSet = new Set(
      limits.targetFiles.map((p) => p.replace(/^\.\//, "").split("\\").join("/"))
    );
    // Prioritize target files first
    files = [
      ...files.filter((f) => targetSet.has(f.path)),
      ...files.filter((f) => !targetSet.has(f.path)),
    ];
  }
  const included: string[] = [];
  const truncated: string[] = [];
  const sections: string[] = [];
  let totalLines = 0;

  for (const file of files.slice(0, limits.maxFiles)) {
    const slice = file.lines.slice(0, limits.maxLinesPerFile);
    const room = limits.maxTotalLines - totalLines;
    if (room <= 0) {
      truncated.push(file.path);
      continue;
    }
    const kept = slice.slice(0, room);
    if (kept.length < file.lines.length) truncated.push(file.path);
    totalLines += kept.length;
    included.push(file.path);
    const numbered = kept
      .map((line, index) => `${String(index + 1).padStart(5)}| ${line}`)
      .join("\n");
    sections.push(`## ${file.path}\n${numbered}`);
  }
  for (const file of files.slice(limits.maxFiles)) truncated.push(file.path);

  return {
    root,
    tree: files.map((file) => file.path).join("\n"),
    body: sections.join("\n\n"),
    included,
    truncated,
  };
}
