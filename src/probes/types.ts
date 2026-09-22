import type { Category, FindingInput, ProbeStatus } from "../findings.ts";

export type { ProbeStatus };

export interface ProbeContext {
  root: string;
  timeoutMs: number;
  /** Probe-specific configuration, e.g. { semgrepConfig: "p/default" }. */
  options?: Record<string, string>;
}

export interface ProbeOutcome {
  probe: string;
  status: ProbeStatus;
  detail?: string;
  findings: FindingInput[];
}

export interface Probe {
  name: string;
  categories: Category[];
  run(context: ProbeContext): Promise<ProbeOutcome>;
}
