# Project memory

What a later session needs to know about this project and could not work out quickly. Keep
it short — this is read every time, so it earns its place by saving more than it costs.

Facts belong under the headings below. Anything that should hold *whatever* the work is —
a rule, a boundary, a habit — goes in "Working here", and applies to a step taken at three
in the morning with nobody watching exactly as it applies to a conversation.

## Working here
<!-- Standing instructions, not notes. "Run the tests before calling anything done."
     "Never touch migrations/ without asking." "Commit when a checker passes, not per file."
     Written for someone who has no other context and cannot ask. -->

- Run `npm test` AND `npm run typecheck` before calling anything done. Both exit 0 or nothing is done.
- Commit when a checker passes. The history is the only way back — this repo was born with zero commits once.
- Secrets never enter a report, a fixture or the repo: gitleaks evidence is redacted to `[redacted]`,
  API keys ride environment variables only and are never printed (lengths only).
- A report must record what did NOT run (`probes[]`, status skipped/failed). Never let it claim a
  clean sweep it did not do — that honesty is the product.

## How to run it
<!-- the exact commands: install, dev, test, build. Verified, not assumed. -->

- `npm install` · `npm test` (node:test + golden files) · `npm run typecheck` (tsc --noEmit)
- `npm run goldens` — regenerate `tests/golden/` after an INTENTIONAL rendering change
- `node src/cli.ts review <path> [--out ./report] [--no-llm] [--offline] [--refresh-db]`
  — Node 24 runs the .ts sources directly; there is no build step.
- Container: `docker compose build`, then
  `HARRIER_TARGET=<repo> HARRIER_OUT=./report/<name> docker compose up`
- Live LLM smoke: `OPENROUTER_API_KEY=$(security find-generic-password -s claude-openrouter -w) \
  node scripts/smoke-llm.ts <dir> bug`

## How it is laid out
<!-- where the important things live, so nobody greps for them twice. -->

- `src/findings.ts` — the model every layer speaks (Finding, Report, ProbeRun, fingerprint).
- `src/report.ts` + `src/render/{json,sarif,markdown,html}.ts` — merge/dedupe + the four renderings.
- `src/probes/` — `exec.ts` (spawn, with `missing` as its own outcome), `adapters/` (gitleaks,
  semgrep, osvScanner, linters), `metrics.ts` (the probe that needs no external tool).
- `src/llm/` — `config`/`client` (any OpenAI-compatible endpoint), `context` (line-numbered
  source), `prompts`, `judgement` (self-check drops findings with no real file+line).
- `src/cli.ts` + `src/args.ts` + `src/pipeline.ts` — the review pipeline.
- `schemas/findings.schema.json` — language-neutral contract; `tests/golden/` — golden renderings;
  `tests/fixtures/outputs/` — recorded scanner output in the real tool formats.

## Decisions
<!-- what was chosen and why, so it is not quietly undone later. -->

- Engine = A (22 Sep 2026, answered "what's the standard" after verifying it): deterministic probes
  find FACTS (dep advisories, secrets, security patterns, lint, measured structure); LLM passes
  JUDGE (structure, quality, bugs) and write up. Every shipped product is hybrid like this.
- Report is the spine (JSON canonical = "feed to AI", SARIF 2.1.0, Markdown). Product set order:
  report → PR comments → dashboard. V1 is report only.
- TypeScript (Kith's call, veto word was "Python", never used).
- v1 linters: eslint (JS/TS, the repo's own config) + ruff (Python). Lint findings are low/info;
  a file that fails to parse is high.
- Secrets redacted to `[redacted]` before reaching any report (reports get pasted into tickets).
- Dependency findings point at the lockfile as a whole (line 1); severity from the advisory's
  `database_specific.severity`, no CVSS vector parsing.

## Gotchas
<!-- what wasted time once and should never waste it again. -->

- Shell calls die at 180s: LLM passes, docker builds and multi-repo runs go to `start_process`
  (scripts in `.kith/scratch/`), never a shell call.
- gitleaks `detect --source --no-git` is DEPRECATED — use `gitleaks dir`; exit 1 means leaks OR an
  error, so trust the report FILE, not the exit code.
- Scanner assets are per-arch with inconsistent names (gitleaks `linux_x64`, osv-scanner
  `linux_amd64`). The Dockerfile maps TARGETARCH and asserts ELF e_machine — because an amd64
  binary in an arm64 image SILENTLY works under Docker Desktop emulation and dies on bare arm64.
- No scanner is installed on the Mac: parsers are tested against recorded real formats
  (`tests/fixtures/outputs/`); live validation happens inside the container.
- OpenRouter key lives in Keychain service `claude-openrouter`, not in any file — read it with
  `security find-generic-password -s claude-openrouter -w` into env; print lengths, never the key.
- node:24-bookworm-slim already owns uid 1000 as `node`: `useradd --uid 1000` dies on "UID 1000 is
  not unique". Reuse the account — `chown node:node` + `USER node`.
- `docker compose up` with both `build:` and `image:` silently reuses a local image — clean-checkout
  evidence needs an explicit `docker compose build` inside the clone.
