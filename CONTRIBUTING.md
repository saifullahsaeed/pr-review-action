# Contributing to Harrier

Thank you for your interest in contributing to Harrier! We welcome contributions to deterministic scanners, AST graphs, LLM evaluation pipelines, report renderers, and CI integrations.

## Code Architecture

Harrier is built to run directly on **Node 24+** using modern TypeScript without a required compilation build step:

- `src/findings.ts` — Central findings schema, fingerprint generation, severity ranking, and deduplication.
- `src/probes/` — Deterministic probe runners and adapters (`gitleaks`, `semgrep`, `osv-scanner`, `eslint`, `ruff`, and `metrics.ts`).
- `src/probes/astGraph.ts` — Multi-language (JS/TS, Python) AST symbol indexing, call cross-referencing, and reverse dependency resolver.
- `src/llm/` — OpenAI-compatible client, line-budget context compiler, prompt templates, structured JSON parsers, and adversarial hallucination verifier (`verifier.ts`).
- `src/render/` — Canonical JSON, SARIF 2.1.0, GitHub Markdown, and interactive HTML viewer generator.
- `src/pipeline.ts` — Orchestration flow tying probes, context scoping, LLM passes, adversarial verifier, and report writing.

## Development Setup

1. **Clone & install dependencies:**
   ```sh
   git clone https://github.com/saifullahsaeed/harrier.git
   cd harrier
   npm install
   ```

2. **Run tests:**
   ```sh
   npm test
   ```

3. **Check types:**
   ```sh
   npm run typecheck
   ```

## Pull Request Guidelines

- Ensure both `npm test` and `npm run typecheck` exit with code `0`.
- All deterministic scanner integrations must handle tool absence gracefully (returning status `"skipped"` instead of crashing).
- New report features must produce deterministic, byte-stable outputs where applicable.
