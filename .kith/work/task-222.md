# Task 222 — LLM judgement passes through a configured endpoint

Plan written before the code (22 Sep 2026).

## Why

The probe layer covers the categories where tools are right — advisories, secrets, patterns,
mechanical lint. Structure and quality judgements and real bug-hunting are the half only a reader
can do, and they are the reason this is an agent rather than a wrapper. The passes must emit
findings that carry code locations, because a finding a human cannot navigate to is noise.

## What changes

- `src/llm/config.ts` — endpoint config from environment: `HARRIER_LLM_BASE_URL`
  (default `https://openrouter.ai/api/v1`), `HARRIER_LLM_API_KEY` (or `OPENROUTER_API_KEY`),
  `HARRIER_LLM_MODEL` (default `deepseek/deepseek-v4.1-flash`, the cheap model on his own list).
  Reports what is missing instead of failing obscurely.
- `src/llm/client.ts` — minimal OpenAI-compatible `chat/completions` client (fetch, bearer auth,
  temperature 0, abort timeout).
- `src/llm/context.ts` — review context from the repo: tree plus file bodies with **line numbers
  in the prompt** (models cite the lines you show them), with file/line budgets and a record of
  what was truncated.
- `src/llm/prompts.ts` — one system contract (report only what you can point at; JSON only) and
  three pass briefs: structure, quality, bug.
- `src/llm/judgement.ts` — run passes through an injected `complete` function (so tests need no
  network), parse the JSON, normalize to `FindingInput`, and self-check: anything without a real
  path and line is dropped and counted.
- `tests/fixtures/outputs/llm-*.txt` — recorded model responses, `tests/fixtures/smoke/` — a small
  fixture with an obvious planted bug for the live run.
- `scripts/smoke-llm.ts` — the live run.
- `tsconfig.json` — exclude `tests/fixtures` from typechecking (they are test data, not code).

## What I checked

- His launcher (`~/claude-openrouter.command`) and conf: the API key is stored in the macOS
  Keychain under service `claude-openrouter`, not in the file. It will be read at run time into an
  environment variable and never printed, never written into source or the repo.
- The model list in his conf (11 Sep 2026 pricing notes); the default model is the cheap one.

## Still assuming

- OpenRouter's OpenAI-compatible `/chat/completions` interface (the same shape any vLLM/Ollama
  endpoint speaks, which is what the self-hosted product needs).
- The model returns JSON when asked in the system contract; there is no `response_format` call, so
  parsing strips fences and takes the outermost object. Deliberately loose across models.

## How I'll know it worked

`npm test` exits 0 with no network (recorded responses, including one finding with no location
being dropped), and `scripts/smoke-llm.ts` against the real endpoint over `tests/fixtures/smoke/`
prints findings carrying path and line.

## Open

- Whether the LLM passes should appear in `report.probes[]` (leaning yes — same honesty rule) or
  get their own block. The judgement result carries `passes[]` either way, so this is a wiring
  choice for task 223.
