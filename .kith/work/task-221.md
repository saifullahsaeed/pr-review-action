# Task 221 — Probe layer (work log)

Built 22 Sep 2026 and recorded after the fact: the work was approved inside the milestone plan at
`.kith/work/milestone-85.md`, and there is no separate pre-work plan for this task. Say so if one
was wanted.

## What exists

- `src/probes/types.ts` — Probe / ProbeContext / ProbeOutcome
- `src/probes/exec.ts` — `runCommand`, with "missing" as its own outcome
- `src/probes/adapters/gitleaks.ts` — secrets
- `src/probes/adapters/semgrep.ts` — security patterns
- `src/probes/adapters/osvScanner.ts` — dependency advisories
- `src/probes/adapters/linters.ts` — eslint (JS/TS) + ruff (Python)
- `src/probes/metrics.ts` — file size, duplicated blocks, import graph (cycles, fan-out) + `metricsProbe`
- `src/probes/run.ts` — `runProbes`, which records what ran and what it found
- `tests/fixtures/outputs/*.json` — recorded scanner output in the real formats
- `tests/fixtures/planted/` — a planted import cycle and a planted duplicated block
- `tests/probes.test.ts`

## Decisions taken while building (mine, not ratified)

1. **`probes[]` added to the report model** (types, canonical JSON, Markdown, SARIF properties,
   JSON Schema). The report has to say what it actually ran: "no secret findings" means nothing if
   gitleaks never ran. Optional field, so nothing already built breaks.
2. **Secrets are redacted before they reach a report** — gitleaks' `Secret` value is replaced with
   `[redacted]` in the evidence. A findings file gets pasted into tickets; it must not carry live
   credentials.
3. **Linters wired for v1: eslint (JS/TS) and ruff (Python)** — this answers the open question in
   the milestone contract.
4. **Lint findings are low/info severity**; a file that fails to parse is high, because that is
   real damage rather than a style note.
5. **Dependency findings point at the lockfile as a whole (line 1)**, not the line the package sits
   on, and severity comes from the advisory's `database_specific.severity` when it has one
   (the GHSA convention) rather than parsing a CVSS vector. Both limitations are stated in the
   adapter.

## What is checked, and what is not

- Checked: every parser against recorded output in the formats verified today from those tools'
  own source and docs — gitleaks v8 (bare PascalCase array), semgrep JSON, osv-scanner v2/v3,
  eslint JSON, ruff JSON.
- **Not checked: any parser against live tool output.** No scanner is installed on this machine.
  That validation belongs to task 223's end-to-end run inside the Docker image, where the tools
  are actually installed.
- Heuristics, stated as such: duplication is a normalised-line window match (12 lines by default),
  not token-based; the import graph resolves relative imports best-effort.

## Evidence

`npm test`: 24 pass, 0 fail. `npm run typecheck` (tsc --noEmit) clean.
