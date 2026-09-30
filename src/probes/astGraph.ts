import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { collectSourceFiles } from "./metrics.ts";

export interface SymbolDef {
  name: string;
  kind: "function" | "class" | "interface" | "type" | "const" | "variable";
  path: string;
  line: number;
}

export interface SymbolRef {
  name: string;
  path: string;
  line: number;
}

export interface FileAstSummary {
  path: string;
  imports: Array<{ symbol?: string; source: string; line: number }>;
  exports: Array<{ symbol: string; kind: string; line: number }>;
  definitions: SymbolDef[];
  references: SymbolRef[];
}

export interface CodebaseAstGraph {
  files: Map<string, FileAstSummary>;
  symbolIndex: Map<string, SymbolDef[]>;
  reverseDependencies: Map<string, Set<string>>;
  callerGraph: Map<string, Array<{ callerFile: string; callerLine: number }>>;
}

const JS_TS_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const PY_EXTENSIONS = new Set([".py"]);

export function parseJsTsSymbols(filePath: string, content: string): FileAstSummary {
  const lines = content.split("\n");
  const imports: FileAstSummary["imports"] = [];
  const exports: FileAstSummary["exports"] = [];
  const definitions: SymbolDef[] = [];
  const references: SymbolRef[] = [];

  const importRegex = /import\s+(?:\{([^}]+)\}|\*\s+as\s+([\w$]+)|([\w$]+))?\s*(?:from\s*)?['"]([^'"]+)['"]/g;
  const exportDeclRegex = /export\s+(?:default\s+)?(?:async\s+)?(function|class|interface|type|const|let|var)\s+([\w$]+)/g;
  const funcDeclRegex = /(?:async\s+)?function\s+([\w$]+)\s*\(/g;
  const classDeclRegex = /class\s+([\w$]+)/g;
  const arrowOrConstRegex = /(?:const|let|var)\s+([\w$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  const wordRegex = /\b([a-zA-Z_$][a-zA-Z0-9_$]*)\b/g;

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return;

    let match: RegExpExecArray | null;

    importRegex.lastIndex = 0;
    while ((match = importRegex.exec(lineText)) !== null) {
      const symbolsStr = match[1] || match[2] || match[3] || "";
      const source = match[4] || "";
      symbolsStr.split(",").forEach((s) => {
        const cleanSym = s.trim().split(/\s+as\s+/)[0]?.trim();
        if (cleanSym) imports.push({ symbol: cleanSym, source, line: lineNum });
      });
      if (!symbolsStr) imports.push({ source, line: lineNum });
    }

    exportDeclRegex.lastIndex = 0;
    while ((match = exportDeclRegex.exec(lineText)) !== null) {
      const kind = match[1] as SymbolDef["kind"];
      const sym = match[2];
      if (sym) {
        exports.push({ symbol: sym, kind, line: lineNum });
        definitions.push({ name: sym, kind, path: filePath, line: lineNum });
      }
    }

    funcDeclRegex.lastIndex = 0;
    while ((match = funcDeclRegex.exec(lineText)) !== null) {
      const sym = match[1];
      if (sym && !definitions.some((d) => d.name === sym && d.line === lineNum)) {
        definitions.push({ name: sym, kind: "function", path: filePath, line: lineNum });
      }
    }

    classDeclRegex.lastIndex = 0;
    while ((match = classDeclRegex.exec(lineText)) !== null) {
      const sym = match[1];
      if (sym && !definitions.some((d) => d.name === sym && d.line === lineNum)) {
        definitions.push({ name: sym, kind: "class", path: filePath, line: lineNum });
      }
    }

    arrowOrConstRegex.lastIndex = 0;
    while ((match = arrowOrConstRegex.exec(lineText)) !== null) {
      const sym = match[1];
      if (sym && !definitions.some((d) => d.name === sym && d.line === lineNum)) {
        definitions.push({ name: sym, kind: "const", path: filePath, line: lineNum });
      }
    }

    wordRegex.lastIndex = 0;
    while ((match = wordRegex.exec(lineText)) !== null) {
      const sym = match[1];
      if (sym && !definitions.some((d) => d.name === sym && d.line === lineNum)) {
        references.push({ name: sym, path: filePath, line: lineNum });
      }
    }
  });

  return { path: filePath, imports, exports, definitions, references };
}

export function parsePythonSymbols(filePath: string, content: string): FileAstSummary {
  const lines = content.split("\n");
  const imports: FileAstSummary["imports"] = [];
  const exports: FileAstSummary["exports"] = [];
  const definitions: SymbolDef[] = [];
  const references: SymbolRef[] = [];

  const pyFuncRegex = /^\s*(?:async\s+)?def\s+([a-zA-Z_]\w*)\s*\(/;
  const pyClassRegex = /^\s*class\s+([a-zA-Z_]\w*)/;
  const pyImportRegex = /^\s*from\s+([\w.]+)\s+import\s+([\w,\s*]+)/;
  const pyPlainImportRegex = /^\s*import\s+([\w.,\s]+)/;
  const wordRegex = /\b([a-zA-Z_]\w*)\b/g;

  lines.forEach((lineText, idx) => {
    const lineNum = idx + 1;
    const trimmed = lineText.trim();
    if (trimmed.startsWith("#")) return;

    let match = pyFuncRegex.exec(lineText);
    if (match && match[1]) {
      definitions.push({ name: match[1], kind: "function", path: filePath, line: lineNum });
      return;
    }

    match = pyClassRegex.exec(lineText);
    if (match && match[1]) {
      definitions.push({ name: match[1], kind: "class", path: filePath, line: lineNum });
      return;
    }

    match = pyImportRegex.exec(lineText);
    if (match && match[1] && match[2]) {
      const source = match[1];
      match[2].split(",").forEach((s) => {
        const sym = s.trim().split(/\s+as\s+/)[0]?.trim();
        if (sym) imports.push({ symbol: sym, source, line: lineNum });
      });
      return;
    }

    match = pyPlainImportRegex.exec(lineText);
    if (match && match[1]) {
      match[1].split(",").forEach((s) => {
        const src = s.trim().split(/\s+as\s+/)[0]?.trim();
        if (src) imports.push({ source: src, line: lineNum });
      });
      return;
    }

    wordRegex.lastIndex = 0;
    while ((match = wordRegex.exec(lineText)) !== null) {
      const sym = match[1];
      if (sym && !definitions.some((d) => d.name === sym && d.line === lineNum)) {
        references.push({ name: sym, path: filePath, line: lineNum });
      }
    }
  });

  return { path: filePath, imports, exports, definitions, references };
}

export function buildCodebaseAstGraph(root: string): CodebaseAstGraph {
  const files = collectSourceFiles(root);
  const fileSummaries = new Map<string, FileAstSummary>();
  const symbolIndex = new Map<string, SymbolDef[]>();
  const reverseDependencies = new Map<string, Set<string>>();
  const callerGraph = new Map<string, Array<{ callerFile: string; callerLine: number }>>();

  for (const file of files) {
    const fullPath = join(root, file.path);
    if (!existsSync(fullPath)) continue;
    let content = "";
    try {
      content = readFileSync(fullPath, "utf8");
    } catch {
      continue;
    }

    const ext = file.path.slice(file.path.lastIndexOf(".")).toLowerCase();
    let summary: FileAstSummary;
    if (JS_TS_EXTENSIONS.has(ext)) {
      summary = parseJsTsSymbols(file.path, content);
    } else if (PY_EXTENSIONS.has(ext)) {
      summary = parsePythonSymbols(file.path, content);
    } else {
      summary = { path: file.path, imports: [], exports: [], definitions: [], references: [] };
    }

    fileSummaries.set(file.path, summary);

    for (const def of summary.definitions) {
      const existing = symbolIndex.get(def.name) ?? [];
      existing.push(def);
      symbolIndex.set(def.name, existing);
    }
  }

  // Cross-reference dependencies and callers
  for (const [filePath, summary] of fileSummaries.entries()) {
    for (const imp of summary.imports) {
      if (imp.source.startsWith(".")) {
        // Resolve local relative import path
        for (const candidatePath of fileSummaries.keys()) {
          const normImport = imp.source.replace(/^\.\//, "").replace(/\.[^.]+$/, "");
          const normCandidate = candidatePath.replace(/\.[^.]+$/, "");
          if (normCandidate.endsWith(normImport)) {
            const rd = reverseDependencies.get(candidatePath) ?? new Set<string>();
            rd.add(filePath);
            reverseDependencies.set(candidatePath, rd);
          }
        }
      }
    }

    for (const ref of summary.references) {
      const defs = symbolIndex.get(ref.name);
      if (defs && defs.length > 0) {
        for (const def of defs) {
          if (def.path !== filePath) {
            const calls = callerGraph.get(def.name) ?? [];
            calls.push({ callerFile: filePath, callerLine: ref.line });
            callerGraph.set(def.name, calls);
          }
        }
      }
    }
  }

  return {
    files: fileSummaries,
    symbolIndex,
    reverseDependencies,
    callerGraph,
  };
}
