import type { FindingInput, ProbeRun } from "../findings.ts";
import type { Probe, ProbeContext } from "./types.ts";

export interface ProbeSweep {
  runs: ProbeRun[];
  findings: FindingInput[];
}

/**
 * Run every probe and record what happened to each one. The runs are what the report must carry:
 * a review that silently skipped its secret scan is worse than no review.
 */
export async function runProbes(
  probes: readonly Probe[],
  context: ProbeContext,
): Promise<ProbeSweep> {
  const runs: ProbeRun[] = [];
  const findings: FindingInput[] = [];
  for (const probe of probes) {
    let outcome;
    try {
      outcome = await probe.run(context);
    } catch (error) {
      outcome = { probe: probe.name, status: "failed" as const, findings: [], detail: error instanceof Error ? error.message : String(error) };
    }
    runs.push({
      probe: outcome.probe,
      categories: probe.categories,
      status: outcome.status,
      ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
    });
    findings.push(...outcome.findings);
  }
  return { runs, findings };
}

export { gitleaksProbe, parseGitleaks } from "./adapters/gitleaks.ts";
export { semgrepProbe, parseSemgrep } from "./adapters/semgrep.ts";
export { osvScannerProbe, parseOsVScanner } from "./adapters/osvScanner.ts";
export { eslintProbe, ruffProbe, parseEslint, parseRuff } from "./adapters/linters.ts";
export { metricsFindings, metricsProbe, collectSourceFiles, DEFAULT_THRESHOLDS } from "./metrics.ts";
