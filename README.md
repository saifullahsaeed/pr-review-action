# Harrier

<div align="center">

**Self-Hosted, Privacy-First Code Review Engine & CI Bot**

*Deterministic Security & Code Scanners + Multi-Pass LLM Review + Adversarial Hallucination Verifier*

[![Node 24](https://img.shields.io/badge/Node-24%2B-green.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org)
[![SARIF 2.1.0](https://img.shields.io/badge/SARIF-2.1.0-orange.svg)](https://sarifweb.azurewebsites.net)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

</div>

---

Harrier is a code review engine designed for engineering teams that cannot send source code to third-party cloud services. It runs locally in developer workflows, in CI/CD pipelines, or as an air-gapped Docker container.

Harrier combines **deterministic scanning tools** with **adversarial semantic LLM passes**, validating all findings into a single unified schema rendered into four synchronized formats:
1. **`report.json`** — Canonical, byte-stable JSON model.
2. **`report.sarif`** — Full SARIF 2.1.0 specification for GitHub Code Scanning and IDEs.
3. **`report.md`** — Clean GitHub Flavored Markdown summary.
4. **`report.html`** — Interactive single-page report with instant severity/category filters and code search.

---

## Key Features

- **100% Self-Hosted & Air-Gapped:** Zero telemetry. Compatible with local vLLM or Ollama instances, or remote endpoints via OpenRouter/OpenAI.
- **Hybrid Review Architecture:**
  - **Facts (Deterministic Probes):** Dependency vulnerabilities (`osv-scanner`), secret detection (`gitleaks`), security patterns (`semgrep`), style and linting (`eslint`, `ruff`), and algorithmic structural metrics (`metrics.ts`).
  - **Semantic Judgement (LLM Passes):** Deep inspection for architecture, software quality, and business/authorization logic flaws.
- **Codebase AST & Dependency Graph:** Parses JS/TS and Python symbols and cross-file imports to discover reverse dependencies and callers.
- **Adversarial Hallucination Verifier:** A secondary verification agent evaluates all proposed model findings against the source code context, discarding false positives and nitpicks.
- **Diff & PR Scoping (`--diff <ref>`):** Automatically reviews only modified files and their direct AST dependents, saving token budgets and speeding up CI reviews.
- **Conversational PR Bot:** GitHub Action integration that reviews PR diffs and responds to inline `@harrier` comments.
- **Flexible Configuration (`harrier.config.json`):** Tune token budgets, scanner timeouts, categories, and severity thresholds.

---

## Quick Start

### Prerequisites
- Node.js 24+ (Harrier runs TypeScript files natively with zero build step)
- Git

### 1. Local CLI Review

```sh
# Run a full review over any directory
node src/cli.ts review /path/to/project --out ./report

# Focus on changes in a pull request / branch
node src/cli.ts review . --diff origin/main

# Review with a local Ollama model
node src/cli.ts review . \
  --endpoint http://localhost:11434/v1 \
  --model llama3
```

### 2. Run with Docker Compose

Mount your repository read-only:

```sh
HARRIER_TARGET=/path/to/project HARRIER_LLM_API_KEY=your-key docker compose up
```

Artifacts will be written directly to `./report`.

---

## Configuration (`harrier.config.json`)

Harrier automatically looks for `harrier.config.json` or `.harrier.json` in your repository root:

```json
{
  "categories": ["security", "bug", "structure", "quality", "dependency", "secret"],
  "minSeverity": "info",
  "outDir": "./report",
  "useLlm": true,
  "endpoint": "https://openrouter.ai/api/v1",
  "model": "anthropic/claude-3.5-sonnet",
  "passes": ["structure", "quality", "bug"],
  "timeoutMs": 120000,
  "budget": {
    "maxFiles": 40,
    "maxLinesPerFile": 400,
    "maxTotalLines": 6000
  }
}
```

---

## CLI Options

```
harrier review <path> [options]

Options:
  --out <dir>          Where the report goes (default: ./report)
  --config <path>      Path to custom configuration file (e.g. harrier.config.json)
  --diff <ref>         Focus LLM review on files changed compared to git ref (e.g. main, HEAD~1)
  --since <ref>        Alias for --diff
  --categories <a,b>   Filter by categories (dependency, secret, security, quality, structure, bug)
  --severity <level>   Minimum severity (critical, high, medium, low, info)
  --endpoint <url>     OpenAI-compatible LLM endpoint
  --model <id>         Model identifier (default: anthropic/claude-3.5-sonnet)
  --no-llm             Run deterministic scanners and metrics only
  --offline            Do not perform external network lookups
  --timeout <ms>       Per-scanner timeout in milliseconds (default: 120000)
```

---

## CI/CD GitHub Actions Integration

Harrier includes two ready-to-use workflows in `.github/workflows/`:
- **`harrier-review.yml`**: Automatically reviews every Pull Request diff, runs probes and verifiers, uploads report artifacts, and posts a triage summary table.
- **`harrier-bot.yml`**: Allows engineers to mention `@harrier <question>` in PR comments to get context-aware answers and suggested code fixes.

---

## Development & Testing

```sh
# Run the test suite (40+ unit and integration tests)
npm test

# Type-check TypeScript sources
npm run typecheck
```

---

## License

Harrier is open-source software licensed under the [MIT License](LICENSE).
Author: [Saifullah Saeed](https://github.com/saifullahsaeed).
