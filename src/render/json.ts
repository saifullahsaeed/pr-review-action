import type { Report } from "../findings.ts";
import { canonicalJson } from "../report.ts";

/** The canonical machine-readable report. */
export function renderJson(report: Report): string {
  return canonicalJson(report);
}
