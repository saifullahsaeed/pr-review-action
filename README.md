# Harrier

<div align="center">

**Self-Hosted Code Quality Control for GitHub Actions**

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

### Baseline-aware quality gate

Use the composite Action from a **reviewed, pinned commit SHA**. It scans the PR base and current checkout, loads policy from the base revision, publishes evidence, then enforces the verdict. The example below is a template: replace `REVIEWED_COMMIT_SHA` with the release commit you trust.

```yaml
name: Code quality
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  quality:
    name: Harrier quality
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: saifullahsaeed/pr-review-action@REVIEWED_COMMIT_SHA
        # Optional: enable advisory AI and configure your team's endpoint.
        # with:
        #   enable-llm: 'true'
        #   endpoint: http://your-private-model/v1
        #   model: your-model
```

Add `Harrier quality` as a **required branch-protection/ruleset check**. The Action cannot configure this for you. Use `pull_request`, not `pull_request_target` with untrusted code and secrets. A full checkout normally already contains the base SHA. If it is absent, Harrier fetches it; private-repository fetch may need a narrowly scoped read credential. An unavailable base produces an incomplete, blocking result. Private endpoints require a runner able to reach them.

Commit this policy to the default/base branch:

```json
{
  "gate": {
    "failOn": "medium",
    "scope": "new",
    "requiredProbes": ["metrics", "gitleaks", "semgrep", "osv-scanner"]
  }
}
```

- Default threshold is **high**, scope **new**, with the four required probes above. `fail-on` overrides the trusted policy threshold; `never` disables finding-based failure but **does not disable required coverage**.
- **Pass (0):** no qualifying new/worsened deterministic findings and complete required coverage. **Fail (1):** policy violations. **Incomplete (2):** missing/failed required checks, invalid policy or unavailable baseline. Both 1 and 2 fail the job.
- Existing debt is non-blocking under `new`; `all` checks all current deterministic findings. AI findings remain advisory. Line drift alone does not create new debt; matching includes rule, paths, message and evidence and preserves occurrence counts. Renames or changed evidence conservatively count as new. No semantic equivalence or persisted issue history is claimed.
- The comparison uses the exact PR **base SHA** and the current checkout (normally GitHub's merge checkout), not merely changed lines. Both deterministic scans must provide comparable coverage. Baseline has no LLM pass.
- Reports are uploaded before gate enforcement, including `gate.json`, canonical `report.json` and SARIF. Job summary and PR summary carry the verdict. Inline comments are limited to gate blockers on added diff lines, capped at 20, deduplicated on reruns of the same head SHA. Older-head inline threads are not automatically resolved.
- Fork PRs get job summaries/artifacts, not privileged PR writes. Permission failures warn but do not alter the quality verdict.
- The Action excludes ESLint because repository JavaScript configuration can execute code. Requiring ESLint in this mode deliberately yields incomplete. Run it in a separate appropriately isolated job. No reviewed-repository install or test scripts run here.
- Supported automatic scanner installation currently targets **Linux x64**. On other/self-hosted platforms preinstall compatible scanners. Installation failures are exposed through required-check coverage. Scanner databases/rules and repository ignore files affect scan scope; trusted gate policy is not a sandbox against malicious scanner configuration.
- This slice does **not** add architecture boundary rules, test/coverage ingestion, expiring exceptions, or a dashboard. Existing metrics detect duplication/import cycles/fanout/long files; the gate enforces those findings according to severity.

CLI equivalent:

```sh
node src/cli.ts review . --gate --baseline origin/main --no-llm --out ./report
# --policy-file /path/to/trusted-config.json avoids working-tree policy overrides.
```

The legacy workflows below remain review/bot workflows, not this enforced quality gate.

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
