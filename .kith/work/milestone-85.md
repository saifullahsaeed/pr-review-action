# Milestone 85 — V1: a team can review a repo and get the full findings report

Project: Harrier (#31). Filed 22 Sep 2026.

## Scope

V1 is **report only**. The review engine produces one findings report per repo, rendered three
ways from one model:

- `report.json` — canonical, machine-readable (the "feed to AI" artifact)
- `report.sarif` — SARIF 2.1.0
- `report.md` — human

Engine approach **A** (agreed by the standard, 22 Sep 2026): deterministic probes — dependency
advisories, secrets, security patterns, mechanical quality, measured structure — find facts;
LLM judgement passes — structure, quality, bugs — plus the write-up do the rest. Both land in
one findings model.

## Out of scope for this milestone

- Dashboard (next milestone), PR comments (after that)
- Any hosted element. Harrier is self-hosted; nothing about the reviewed code leaves the team's
  network except model calls the team itself configures (any OpenAI-compatible endpoint).
- Fix generation.

## Exit criteria

From a clean checkout: `npm install`, `npm test` exits 0, and `harrier review <path> --out ./report`
writes `report.json`, `report.sarif` and `report.md` for a real repo, with findings from both the
probe layer and the LLM layer carrying file/line/severity/category.

## Required evidence

- `npm test` output, exit 0, covering schema + renderers + probes + LLM layer
- The three report files from an end-to-end run over two real repos
- A `docker compose up` run log from a clean checkout

## Open decisions

- Language: TypeScript (Kith's call, 22 Sep 2026 — veto with "Python")
- ~~Which language linters ship wired in v1~~ — DECIDED 22 Sep 2026 by Kith: eslint (JS/TS) and
  ruff (Python), each optional and reported as `skipped` when absent.
- ~~Model endpoint for the LLM judgement passes~~ — DECIDED 22 Sep 2026 (he picked "OpenRouter,
  your key"): OpenRouter via the Keychain key `claude-openrouter`, default model
  deepseek/deepseek-v4.1-flash. Any OpenAI-compatible endpoint stays configurable — that is the
  self-hosted story.
- Vulnerability-DB mirror mechanics for air-gapped installs (task 223)
- PR-run semantics — whole-repo vs scoped to changed files (later milestone)
