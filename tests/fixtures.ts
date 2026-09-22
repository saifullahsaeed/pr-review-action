import type { FindingInput } from "../src/findings.ts";
import type { Report } from "../src/findings.ts";
import { buildReport } from "../src/report.ts";

/**
 * A fixed finding set covering every category, every severity and both sources.
 * Golden files are rendered from this, so it must stay deterministic.
 */
export function fixtureFindings(): FindingInput[] {
  return [
    {
      ruleId: "gitleaks/aws-access-key",
      ruleName: "Credential in source",
      category: "secret",
      severity: "critical",
      message: "An AWS access key id is committed in source.",
      locations: [{ path: "src/config.ts", startLine: 12 }],
      source: "probe",
      probe: "gitleaks",
      evidence: "AKIAxxxxxxxxxxxxxxxx",
      fixHint: "Rotate the key and remove it from history.",
    },
    {
      ruleId: "osv/CVE-2020-8203",
      ruleName: "Dependency with known vulnerability",
      category: "dependency",
      severity: "critical",
      message: "lodash@4.17.15 is affected by CVE-2020-8203 (prototype pollution).",
      locations: [{ path: "package-lock.json", startLine: 42 }],
      source: "probe",
      probe: "osv-scanner",
      evidence: "lodash@4.17.15",
      fixHint: "Upgrade lodash to 4.17.21.",
    },
    {
      ruleId: "semgrep/node-sql-injection",
      ruleName: "SQL injection",
      category: "security",
      severity: "high",
      message: "Query built by string concatenation with request input.",
      locations: [
        { path: "src/api/users.ts", startLine: 88, startColumn: 5, endLine: 92 },
        { path: "src/api/admin.ts", startLine: 31 },
      ],
      source: "probe",
      probe: "semgrep",
      evidence: 'db.query("SELECT * FROM users WHERE id = " + req.params.id)',
      fixHint: "Use a parameterised query.",
    },
    {
      ruleId: "llm/bug.non-idempotent-retry",
      ruleName: "Non-idempotent retry",
      category: "bug",
      severity: "high",
      message:
        "The retry loop calls sendCharge() again on timeout without an idempotency key, so a slow response double-charges.",
      locations: [{ path: "src/billing/charge.ts", startLine: 57 }],
      source: "llm",
      confidence: "high",
      evidence: "await sendCharge(amount); // no idempotency key, retried on ETIMEDOUT",
      fixHint: "Pass an idempotency key derived from the invoice id.",
    },
    {
      ruleId: "llm/structure.layering",
      ruleName: "Layering violation",
      category: "structure",
      severity: "medium",
      message:
        "The web layer imports straight from the database layer, bypassing the service boundary (7 imports).",
      locations: [{ path: "src/web/routes/orders.ts", startLine: 3 }],
      source: "llm",
      confidence: "medium",
      evidence: 'import { ordersTable } from "../../db/schema.ts";',
      fixHint: "Route these reads through the orders service.",
    },
    {
      ruleId: "llm/quality.copy-paste",
      ruleName: "Copy-paste duplication",
      category: "quality",
      severity: "medium",
      message:
        "Totalling and rounding logic is copy-pasted from src/billing/totals.ts with one sign flipped.",
      locations: [{ path: "src/orders/settle.ts", startLine: 10, endLine: 48 }],
      source: "llm",
      confidence: "medium",
      fixHint: "Extract the shared totalling helper.",
    },
    {
      ruleId: "eslint/no-unused-vars",
      ruleName: "Mechanical quality",
      category: "quality",
      severity: "low",
      message: "'legacyTotal' is assigned a value but never used.",
      locations: [{ path: "src/orders/settle.ts", startLine: 61 }],
      source: "probe",
      probe: "eslint",
    },
    {
      ruleId: "metrics/long-file",
      ruleName: "Measured structure",
      category: "structure",
      severity: "info",
      message: "File is 912 lines with 14 top-level functions; review cost is high.",
      locations: [{ path: "src/legacy/importer.ts", startLine: 1 }],
      source: "probe",
      probe: "metrics",
    },
  ];
}

export function fixtureReport(): Report {
  const { report } = buildReport({
    tool: { name: "harrier", version: "0.1.0" },
    target: { root: "fixtures/planted", commit: "0000000" },
    startedAt: "2026-09-22T10:00:00.000Z",
    finishedAt: "2026-09-22T10:03:12.000Z",
    overview:
      "Secrets and dependency exposure are the urgent part: an AWS key is in source and the lockfile pins a vulnerable lodash. Below that, one injection path and one double-charge path, then layering and duplication debt in the orders area.",
    probes: [
      { probe: "osv-scanner", categories: ["dependency"], status: "ok" },
      { probe: "gitleaks", categories: ["secret"], status: "ok" },
      { probe: "semgrep", categories: ["security"], status: "ok" },
      { probe: "eslint", categories: ["quality"], status: "ok" },
      {
        probe: "ruff",
        categories: ["quality"],
        status: "skipped",
        detail: "ruff is not installed, so no Python lint rules ran",
      },
      { probe: "metrics", categories: ["structure"], status: "ok" },
    ],
    findings: fixtureFindings(),
  });
  return report;
}
