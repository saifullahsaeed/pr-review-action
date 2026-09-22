# Findings schema with JSON, SARIF and Markdown renderings

**Status:** done · **Priority:** normal · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-09-22T15:54:34.982935+00:00

## How you know it is done

One typed findings model that all three report formats render from. Done: `npm test` exits 0 with round-trip tests (model -> JSON -> model) and golden-file tests for SARIF 2.1.0 and Markdown against a fixed fixture set of findings.

## Checklist

- [x] Fix the findings model: categories, severities, finding fields, report envelope
- [x] Write the canonical JSON writer (deterministic key order)
- [x] Write the SARIF 2.1.0 writer mapping findings to runs[].results[]
- [x] Write the Markdown writer: summary counts plus grouped findings with file:line
- [x] Round-trip and golden tests green (`npm test` exits 0)


## Delivered

- Sample findings report — Markdown render of the 8-finding fixture

---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
