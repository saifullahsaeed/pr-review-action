import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import type { FindingInput } from "../findings.ts";
import type { Probe } from "./types.ts";

/**
 * Measured structure — the one probe that needs no external tool, so it always runs.
 * Three deterministic measurements: file size, duplicated blocks, and the import graph
 * (cycles and fan-out). Heuristics, stated as heuristics in the finding text.
 */

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "vendor",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  "coverage",
  ".next",
  ".cache",
  ".harrier",
]);

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".rb",
  ".php",
]);

export interface SourceFile {
  path: string;
  lines: string[];
}

export interface MetricsThresholds {
  longFileLines: number;
  duplicateLines: number;
  fanoutLimit: number;
}

export const DEFAULT_THRESHOLDS: MetricsThresholds = {
  longFileLines: 800,
  duplicateLines: 12,
  fanoutLimit: 25,
};

export function collectSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];
  const walk = (directory: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(directory, entry);
      let stats;
      try {
        stats = statSync(full);
      } catch {
        continue;
      }
      if (stats.isDirectory()) {
        walk(full);
      } else if (SOURCE_EXTENSIONS.has(extname(entry))) {
        const text = readFileSync(full, "utf8");
        files.push({ path: relative(root, full).split("\\").join("/"), lines: text.split(/\r?\n/) });
      }
    }
  };
  walk(resolve(root));
  return files;
}

function normalized(lines: readonly string[]): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  lines.forEach((line, index) => {
    const text = line.trim();
    if (text !== "") out.push({ text, line: index + 1 });
  });
  return out;
}

function duplicateBlocks(
  files: readonly SourceFile[],
  window: number,
): Array<{ paths: string[]; startLines: number[]; span: number }> {
  const windows = new Map<string, Array<{ path: string; line: number }>>();
  for (const file of files) {
    const lines = normalized(file.lines);
    if (lines.length < window) continue;
    for (let index = 0; index + window <= lines.length; index += 1) {
      const slice = lines.slice(index, index + window);
      const first = slice[0];
      if (first === undefined) continue;
      const key = slice.map((entry) => entry.text).join("\u0000");
      const seen = windows.get(key) ?? [];
      seen.push({ path: file.path, line: first.line });
      windows.set(key, seen);
    }
  }

  const candidates = [...windows.entries()]
    .filter(([, seen]) => seen.length >= 2)
    .map(([key, seen]) => ({ key, seen }))
    .sort((a, b) => {
      const firstA = a.seen[0];
      const firstB = b.seen[0];
      if ((firstA?.path ?? "") !== (firstB?.path ?? "")) {
        return (firstA?.path ?? "") < (firstB?.path ?? "") ? -1 : 1;
      }
      return (firstA?.line ?? 0) - (firstB?.line ?? 0);
    });

  // One stretch of copied code is one finding: overlapping windows of the same block are merged.
  const out: Array<{ paths: string[]; startLines: number[]; span: number }> = [];
  const accepted: Array<{ path: string; line: number }> = [];
  for (const candidate of candidates) {
    const overlaps = candidate.seen.some((occurrence) =>
      accepted.some(
        (taken) =>
          taken.path === occurrence.path && Math.abs(taken.line - occurrence.line) < window,
      ),
    );
    if (overlaps) continue;
    accepted.push(...candidate.seen);
    out.push({
      paths: candidate.seen.map((entry) => entry.path),
      startLines: candidate.seen.map((entry) => entry.line),
      span: window,
    });
  }
  return out;
}

const IMPORT_PATTERNS: RegExp[] = [
  /(?:import|export)\s+[^"'()]*?from\s+['"]([^'"]+)['"]/g,
  /import\s+['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /^\s*from\s+([\w.]+)\s+import\s+/gm,
  /^\s*import\s+([\w.,\s]+)$/gm,
  /import\s+(?:\w+\s+)?"([^"]+)"/g,
];

export function importTargets(file: SourceFile): string[] {
  const text = file.lines.join("\n");
  const targets = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const target = match[1];
      if (target !== undefined && target.trim() !== "") targets.add(target.trim());
    }
  }
  return [...targets];
}

/** Resolve an import specifier to a collected source file, if it points at one. */
export function resolveImport(from: string, specifier: string, paths: ReadonlySet<string>): string | undefined {
  const base = specifier.split("\\").join("/");
  const candidates: string[] = [];
  if (base.startsWith(".")) {
    const joined = relative("", join(dirname(from), base)).split("\\").join("/");
    candidates.push(joined);
    for (const extension of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go"]) {
      candidates.push(`${joined}${extension}`);
      candidates.push(`${joined}/index${extension}`);
    }
  } else {
    for (const path of paths) {
      if (path.endsWith(`/${base}`) || path === base) candidates.push(path);
    }
  }
  for (const candidate of candidates) {
    if (paths.has(candidate)) return candidate;
  }
  return undefined;
}

export function importGraph(files: readonly SourceFile[]): Map<string, string[]> {
  const paths = new Set(files.map((file) => file.path));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const resolved: string[] = [];
    for (const target of importTargets(file)) {
      const match = resolveImport(file.path, target, paths);
      if (match !== undefined && match !== file.path) resolved.push(match);
    }
    graph.set(file.path, resolved.sort());
  }
  return graph;
}

/** Every cycle once, each rotated to start at its lexicographically smallest member. */
export function findCycles(graph: ReadonlyMap<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): void => {
    if (onStack.has(node)) {
      const start = stack.indexOf(node);
      const cycle = stack.slice(start);
      const smallest = [...cycle].sort()[0] ?? node;
      const rotation = [...cycle.slice(cycle.indexOf(smallest)), ...cycle.slice(0, cycle.indexOf(smallest))];
      const key = rotation.join(">");
      if (!seen.has(key)) {
        seen.add(key);
        cycles.push(rotation);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.push(node);
    onStack.add(node);
    for (const next of graph.get(node) ?? []) visit(next);
    stack.pop();
    onStack.delete(node);
  };

  for (const node of [...graph.keys()].sort()) visit(node);
  return cycles;
}

export function metricsFindings(
  files: readonly SourceFile[],
  thresholds: MetricsThresholds = DEFAULT_THRESHOLDS,
): FindingInput[] {
  const findings: FindingInput[] = [];
  const source = "probe" as const;
  const probe = "metrics";

  for (const file of files) {
    const lineCount = file.lines.length;
    if (lineCount > thresholds.longFileLines) {
      findings.push({
        ruleId: "metrics/long-file",
        ruleName: "Measured structure",
        category: "structure",
        severity: "info",
        message: `File is ${lineCount} lines (over ${thresholds.longFileLines}); review cost is high.`,
        locations: [{ path: file.path, startLine: 1 }],
        source,
        probe,
        fixHint: "Split by responsibility.",
      });
    }
  }

  for (const block of duplicateBlocks(files, thresholds.duplicateLines)) {
    findings.push({
      ruleId: "metrics/duplicate-block",
      ruleName: "Duplicated code block",
      category: "quality",
      severity: "medium",
      message: `A ${block.span}-line block is duplicated ${block.paths.length} times, verbatim.`,
      locations: block.paths.map((path, index) => ({
        path,
        startLine: block.startLines[index] ?? 1,
      })),
      source,
      probe,
      fixHint: "Extract the shared logic into one place.",
    });
  }

  const graph = importGraph(files);
  for (const cycle of findCycles(graph)) {
    findings.push({
      ruleId: "metrics/import-cycle",
      ruleName: "Import cycle",
      category: "structure",
      severity: "medium",
      message: `Import cycle: ${[...cycle, cycle[0]].join(" -> ")}.`,
      locations: cycle.map((path) => ({ path, startLine: 1 })),
      source,
      probe,
      fixHint: "Break the cycle by moving the shared dependency out.",
    });
  }

  for (const [path, targets] of graph) {
    if (targets.length > thresholds.fanoutLimit) {
      findings.push({
        ruleId: "metrics/high-fanout",
        ruleName: "High fan-out",
        category: "structure",
        severity: "info",
        message: `File imports ${targets.length} modules (over ${thresholds.fanoutLimit}); it knows too much about the codebase.`,
        locations: [{ path, startLine: 1 }],
        source,
        probe,
      });
    }
  }

  return findings;
}

/** Structure and quality measured directly — no external tool, so this probe always runs. */
export const metricsProbe: Probe = {
  name: "metrics",
  categories: ["structure", "quality"],
  async run(context) {
    return {
      probe: "metrics",
      status: "ok",
      findings: metricsFindings(collectSourceFiles(context.root)),
    };
  },
};
