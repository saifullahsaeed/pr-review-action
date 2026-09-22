# Task 220 — Findings schema with JSON, SARIF and Markdown renderings

## Why

The report is the spine of Harrier: PR comments and the dashboard are later renderings of the
same findings. Everything downstream — probes (221), LLM passes (222), CLI (223) — writes into
this model, so its shape is the first thing to get right.

## What changes

Greenfield in `~/Desktop/personal/harrier` (empty except `.kith/`):

- `src/findings.ts` — the model: Severity, Category, Source, Location, Finding, Report, Summary,
  plus fingerprint, validation and `normalizeFinding` (drops findings with no locations)
- `src/report.ts` — `buildReport` (normalize, dedupe by fingerprint, sort, summarize) and the
  canonical JSON form
- `src/render/json.ts`, `src/render/sarif.ts` (SARIF 2.1.0), `src/render/markdown.ts`
- `schemas/findings.schema.json` — language-neutral JSON Schema of the canonical form
- `tests/`, `tests/golden/`, `scripts/goldens.ts`

## What I checked

- Node v24.5.0 / npm 11.5.1 on this machine — `.ts` runs natively (type stripping), so no build
  step for now; `tsc --noEmit` is the typecheck.
- SARIF 2.1.0 shape (`runs[].tool.driver.rules`, `results[]` with `physicalLocation`/`region` and
  `partialFingerprints`) from knowledge of the spec.

## Still assuming

- `id` = fingerprint: sha256/16 of `ruleId|path|startLine|normalised message`. Line numbers are
  in the basis, so a finding that moves counts as new — deliberate for v1, it avoids false dedupe.
- Severity → SARIF level: critical/high = error, medium = warning, low/info = note.
- TypeScript (my call, vetoable in one word).
- The report carries an optional LLM `overview` paragraph.

## How I'll know it worked

`npm test` exits 0: round-trip stability (`canonicalJson(parse(x))` equals `x`), `normalizeFinding`
drops locationless findings, summary counts are right, and golden-file equality holds for JSON,
SARIF and Markdown against `tests/golden/`.

## Genuinely unsure

- Full SARIF schema validation is not wired — the tests assert structure and golden equality, not
  conformance against the official schema. Vendoring the schema or adding a validator is a
  deliberate deferral.
- Whether `overview` stays in the canonical JSON.

## Approval provenance

Plan handed over 22 Sep 2026. The approval question in chat timed out; Kith chose "as filed" and
proceeded under the ask tool's skip semantics. That is NOT an explicit word from Saifullah — say
so if this should have waited.

## Progress — 22 Sep 2026

Built as planned. `npm test`: 14 pass, 0 fail, exit 0. `npm run typecheck` (tsc --noEmit) exit 0.
Goldens generated at `tests/golden/` and read back — the Markdown rendering was eyeballed, it
reads correctly. Deferred as flagged in the plan: full SARIF schema conformance (tests assert
structure and golden equality only). Nothing remains on this task; the probe layer is task 221.
