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

## Project-rule and document compliance

Harrier checks project requirements as well as security and general code quality. Configure existing documents directly; you do not need to rewrite their contents into individual checker rules. AGENTS inheritance is optional.

```json
{
  "enforcement": {
    "version": 1,
    "agents": { "enabled": true, "required": true },
    "documents": [
      {
        "id": "backend-architecture",
        "paths": ["docs/architecture", "docs/rules/CODING.md"],
        "scope": ["backend/**/*.py"],
        "exclude": ["backend/**/migrations/**"],
        "role": "standards",
        "required": true
      },
      {
        "id": "product-context",
        "paths": ["docs/PRODUCT.md"],
        "scope": ["**"],
        "role": "reference",
        "required": false
      }
    ],
    "maxContextChars": 48000,
    "rules": [
      {
        "id": "permissions.no-legacy",
        "description": "Use project permissions rather than user.has_perm",
        "status": "approved",
        "required": true,
        "severity": "high",
        "scope": ["backend/**/*.py"],
        "exclude": ["backend/**/tests/**"],
        "source": { "path": "AGENTS.md", "startLine": 63, "endLine": 66 },
        "checker": { "kind": "python-call", "forbidden": ["*.has_perm"] }
      }
    ]
  }
}
```

Paths are literal repository-relative file/folder paths, not URLs or external filesystem paths. Folders are read recursively (Markdown, text, RST, JSON and YAML); unsupported files, missing material and symlink escapes produce incomplete coverage. Hidden entries are excluded from configured folders. Scope/exclude use Node path glob syntax. References are context only; standards may contain mandatory requirements. Explicit proposals/drafts must not become blocking requirements.

```sh
node src/cli.ts review . --gate --baseline origin/main --out /tmp/harrier-report
```

With `--baseline`, **enforcement policy, cited rule text and documents come from that exact base revision**, not modified PR files. Policy changes are listed separately. Introduce policy on the trusted base first. Without a baseline, explicitly configured local policy is used and all tracked/unignored untracked files are checked. Enforcement configured locally automatically enables the gate. Other display/LLM configuration is still loaded by the CLI; use the trusted `--policy-file` mechanism in CI. The composite Action already supplies base configuration. Required-check branch protection must be configured by the team.

- **Pass (0):** required configured checks completed with no reported violation. Document pass means model review completed, not proof of universal compliance.
- **Fail (1):** required syntax/ledger/test checks or adversarially confirmed document violations failed. Each document violation must exactly cite a supplied requirement and offending source line.
- **Incomplete (2):** required material, model access, valid response, verifier agreement, execution evidence or context capacity is unavailable. `--no-llm` cannot silently pass required document review. `--fail-on never` does not disable required rule checks.

Document review supplies a whole changed file and all documents for each applicable source, with no hidden truncation. Each file/source can make a review request plus a verifier request; requests are sequential. `maxContextChars` limits numbered context; protocol and verification add overhead. Large context is **incomplete**, not automatically chunked yet. AGENTS chains are root-to-local; root principles remain safeguards and local specifics specialize them. All applicable configured sources are included as related context so conflicts can be surfaced by the model. Conflict detection and semantic interpretation are not deterministic guarantees. Linked documents are not automatically crawled: list the necessary paths explicitly. Runtime/process guarantees need execution evidence, not just a model reading code.

Explicit checkers use stable IDs and declared scopes; approved/proposed status is operator-supplied, never inferred automatically from prose. A checker can omit `source` when defined directly in configuration; the citation defaults to `harrier.config.json:1`. Supported first-release kinds:

| Kind | Configuration | Verification boundary |
| --- | --- | --- |
| `python-call` | `forbidden`: dotted names, `*` segments | Python AST calls and basic import aliases; no runtime dispatch/dataflow guarantee |
| `python-import` | `forbidden`: dotted module prefixes | Absolute and repository-relative imports; configure both spellings where needed |
| `dependency-ledger` | `manifests`, `ledger` | Dependency deltas in package.json/simple requirements*.txt need changed Markdown rows: Package, Status, Reason; removals need `removed`. Reason quality is not proven. Unsupported manifests are incomplete |
| `evidence` | `checkId` | External trusted producer reports execution for the exact clean reviewed Git revision |
| `semantic` | `instructions` | No deterministic checker: required entries remain incomplete. Use configured documents for model-based review |

Python checks require `python3`; Harrier uses isolated standard-library AST parsing and never imports the reviewed Python modules. Comments/strings are not treated as calls. Deletions under Python/document scopes currently produce incomplete instead of inventing evidence about removed code. Rules without applicable changed files are `not-applicable`. Checks inspect the whole changed file, not just added lines, so pre-existing violations in an edited file may block.

For trusted test evidence, use `--evidence-file /outside/repo/evidence.json`:

```json
{
  "version": 1,
  "revision": "0123456789012345678901234567890123456789",
  "checks": [{ "checkId": "tenant-isolation", "exitCode": 0, "command": "python -m pytest tenant_tests" }]
}
```

The revision must match HEAD and the reviewed tree must be clean. Harrier validates producer attestations, **does not prove their authenticity**, and never executes repository test scripts automatically. Configure trusted isolated execution separately. JSON and Markdown expose per-rule results, citations and gaps; security scanners and general AI reviews continue separately. Live model/GitHub validation is distinct from fixture tests.

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

### Large-PR AI batching

AI review processes changed text hunks in multiple bounded batches, retaining original line numbers and up to three surrounding context lines. Changes past line 400 are included; large hunks split across batches. Non-PR reviews batch all eligible source files. Each batch runs the configured passes and, when needed, the verifier. Small direct-caller excerpts use spare capacity; this is not comprehensive impact analysis.

```json
{
  "budget": {
    "maxFiles": 40,
    "maxLinesPerFile": 400,
    "maxTotalLines": 6000,
    "maxChars": 48000,
    "maxBatches": 100
  }
}
```

Optional exact text-token enforcement can additionally be configured:

```json
{ "tokenBudget": { "maxInputTokens": 12000, "reservedTokens": 256 } }
```

This counts every outgoing message's content with the model's BPE tokenizer, including instructions, code, document review and verifier requests. It rejects oversized requests before network submission; reduce batch/context sizes to avoid incomplete coverage. It does not automatically repack batches. Chat-template/provider overhead is a separately configured reserve, **not an exact server-side prompt-token count**. First supported models are gpt-4o / gpt-4o-2024-08-06, gpt-4o-mini / gpt-4o-mini-2024-07-18 and gpt-4-turbo / gpt-4-turbo-2024-04-09, optionally prefixed `openai/`. This opt-in mode requires installed Python `tiktoken` and preloaded encoding cache; Harrier never downloads tokenizer data implicitly. Missing tooling/cache or unsupported models report failed/incomplete AI coverage rather than falling back to character estimates. Tokenizer dependencies are not installed in the Docker image by this release. Without tokenBudget, existing character bounds remain in effect.

The first four limits are **per batch**, not per review. `maxChars` bounds numbered source context (characters, not model tokens or the entire prompt). Instructions, hints and verifier findings add overhead; choose limits for your endpoint. `maxBatches` caps batches: each can make one request per pass plus a verifier. Batches run sequentially, so large reviews take longer and cost more.

`report.json` includes `aiCoverage`; Markdown/PR summaries show line ranges, pass statuses, support excerpts and exclusions. Budget-exhausted ranges, oversized lines, unsupported/deleted/binary/mode-only files and failures are explicit. Invalid diff references do not silently fall back. Partial AI coverage remains advisory and does not change the deterministic gate verdict. No claim of full-repository semantic review is made. `ignore` and rule enable/disable settings remain unsupported.

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
