# Task 223 — CLI and container a team can run

Plan written before the code (22 Sep 2026).

## Why

Everything so far is a library. A team runs a command and gets a report; without this there is no
product, only a model and some parsers.

## What changes

- `src/args.ts` — the interface: `harrier review <path>` with `--out`, `--categories`, `--severity`,
  `--endpoint`, `--model`, `--no-llm`, `--timeout`.
- `src/cli.ts` — thin main over `review()`, printing what ran and what was not covered.
- `src/pipeline.ts` — probes → judgement passes → merged, deduped, filtered findings → the three
  report files. LLM passes appear in `report.probes[]` as `llm/structure|quality|bug` and a
  `llm/self-check` entry counts what the model offered and we refused to ship.
- `Dockerfile`, `docker-compose.yml`, `.dockerignore` — the self-hosted shape: the repo mounts
  read-only at `/workspace`, the report lands in `/report`, and the model endpoint is whatever the
  team configures.
- README usage section; the offline vulnerability-DB path documented and wired.

## What I will check before claiming it works

- The scanner install steps and CLI flags — verified against the tools' own release metadata and
  docs rather than from memory (this is what the Dockerfile is written against).
- The Docker build and a `docker compose up` run over a real repo — required evidence in the
  milestone contract. If the daemon or the pulls get in the way, that gap gets named rather than
  glossed.

## Still assuming

- eslint only runs against a repo's own configuration; with no config it reports `skipped`, not
  `failed`. Ruff runs on defaults.

## How I'll know it worked

`npm test` exit 0; `node src/cli.ts review <repo> --no-llm --out <dir>` writes all three report
files; and `docker compose up` does the same from a clean checkout.

## Progress — 22 Sep 2026

Built as planned. `.kith/scratch/acceptance.sh` ran `docker compose up` over this repo from the
built image: exit 0, all three report files written — and the LIVE scanners ran and their real
output parsed: osv-scanner, gitleaks, semgrep and ruff all `ok`. That is the live validation
task 221 left open, and it passed: the parsers, written from the tools' own docs and source,
handled real output. eslint reported `skipped` (no config in this repo) and the judgement passes
`skipped` (no endpoint configured) — both honest gaps, both by design.

The host e2e (`.kith/scratch/e2e.sh`) covered both real-repo runs: this repo with judgement passes
live (11 findings; `llm/quality` hit an endpoint timeout and was recorded as failed with its
detail, exactly as designed) and ~/Kith/vigil probes-only (15 findings, nothing of his sent
anywhere). Six report files total.

Then the interesting part: the container run reviewed Harrier itself and raised **two HIGH
security findings on our own Dockerfile** — no `USER`, so the container runs as root while reading
code nobody has vetted. Fixed by running as a non-root `harrier` user; rebuild + rescan runs in
`.kith/scratch/verify-fix.sh`, which also does the clean-checkout leg of the done-condition. The
two remaining findings are the planted fixtures under `tests/fixtures/planted`, doing their job.

Also fixed while in here: the scanner binaries were x86_64 in an arm64 image (fine under Docker
Desktop's silent emulation, exec-format-error on a bare arm64 host) — the Dockerfile now selects
assets by `TARGETARCH` and asserts ELF `e_machine` at build time.

Unexercised, named plainly: the `--offline` / `--refresh-db` path is wired (flags → osv-scanner
`--offline` / `--download-offline-databases`) and documented, but no air-gapped run has happened
yet. And one candidate follow-up, not done: a single retry per LLM pass, since the one failure we
have seen was a plain endpoint timeout.
