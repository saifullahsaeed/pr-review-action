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
```

Requires Node 24 (sources run as TypeScript directly; there is no build step yet).

## The findings model

`schemas/findings.schema.json` is the language-neutral contract; `src/findings.ts` is the typed
implementation. Every layer speaks it: deterministic probes (dependency advisories, secrets,
security patterns, mechanical quality, measured structure) produce `source: "probe"` findings,
LLM judgement passes (structure, quality, bugs) produce `source: "llm"` findings with a
confidence, and both are merged, deduped by fingerprint and rendered three ways.
