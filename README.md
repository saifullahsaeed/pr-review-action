# Harrier

Self-hosted code review. Harrier's sole job is to review a codebase and report what is wrong with
it — code structure, quality, bugs, security and dependency problems — as one findings report.

Nothing about the reviewed code leaves the machine it runs on. Model calls go to whatever
OpenAI-compatible endpoint the team configures, including one inside their own network.

## Status

V1 in progress (milestone 85): the findings model and its three renderings — `report.json`
(canonical, machine-readable), `report.sarif` (SARIF 2.1.0) and `report.md`. Next: the probe
layer, the LLM judgement passes, then the CLI and container.

## Commands

```sh
npm install
npm test          # node:test, golden-file comparisons
npm run typecheck # tsc --noEmit
npm run goldens   # regenerate tests/golden/ after an intentional rendering change
node src/cli.ts review <path> [--out ./report] [--no-llm] [--offline]
```

Requires Node 24 (sources run as TypeScript directly; there is no build step yet).

## Running it

```sh
node src/cli.ts review /path/to/repo --out ./report
```

writes `report.json` (canonical, machine-readable — the thing you feed to an AI), `report.sarif`
(SARIF 2.1.0) and `report.md`. Options: `--categories dependency,secret,...`, `--severity high`,
`--endpoint <url>`, `--model <id>`, `--no-llm`, `--timeout <ms>`.

With a container, which is the self-hosted shape:

```sh
HARRIER_TARGET=/path/to/repo HARRIER_LLM_API_KEY=... docker compose up
```

The repo mounts read-only and the report lands in `./report`. With no key configured the review
still runs and reports the judgement passes as `skipped` — a report never claims a clean sweep it
did not do.

### Staying offline

`--offline` means nothing phones home: osv-scanner reads a mirrored advisory database
(`OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY`) and the judgement passes run only if `--endpoint` points
at a model inside your network. Mirror or refresh the database first with `--refresh-db`, which
runs osv-scanner's `--offline-vulnerabilities --download-offline-databases`.

### What is covered

| Category | Who finds it |
|---|---|
| dependency | osv-scanner (advisory database) |
| secret | gitleaks (redacted before it reaches the report) |
| security | semgrep |
| quality | eslint (JS/TS, the repo's own config), ruff (Python), measured duplication |
| structure | measured size, import cycles and fan-out |
| bug, plus structure/quality judgement | the LLM passes, through your configured endpoint |

## The findings model

`schemas/findings.schema.json` is the language-neutral contract; `src/findings.ts` is the typed
implementation. Every layer speaks it: deterministic probes (dependency advisories, secrets,
security patterns, mechanical quality, measured structure) produce `source: "probe"` findings,
LLM judgement passes (structure, quality, bugs) produce `source: "llm"` findings with a
confidence, and both are merged, deduped by fingerprint and rendered three ways.
