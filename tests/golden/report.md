# Harrier review — `fixtures/planted`

`2026-09-22T10:00:00.000Z` → `2026-09-22T10:03:12.000Z` · commit `0000000` · harrier 0.1.0

## Summary

**8 findings**

| Severity | Count |
| --- | --- |
| critical | 2 |
| high | 2 |
| medium | 2 |
| low | 1 |
| info | 1 |

| Category | Count |
| --- | --- |
| dependency | 1 |
| secret | 1 |
| security | 1 |
| quality | 2 |
| structure | 2 |
| bug | 1 |

| Source | Count |
| --- | --- |
| probe | 5 |
| llm | 3 |

### Probes

- `osv-scanner` (dependency) — **ok**
- `gitleaks` (secret) — **ok**
- `semgrep` (security) — **ok**
- `eslint` (quality) — **ok**
- `ruff` (quality) — **skipped** — ruff is not installed, so no Python lint rules ran
- `metrics` (structure) — **ok**

## Overview

Secrets and dependency exposure are the urgent part: an AWS key is in source and the lockfile pins a vulnerable lodash. Below that, one injection path and one double-charge path, then layering and duplication debt in the orders area.

## Findings

### critical · dependency · `package-lock.json:42`

**Dependency with known vulnerability** — lodash@4.17.15 is affected by CVE-2020-8203 (prototype pollution).

_probe:_ `osv-scanner` · _rule:_ `osv/CVE-2020-8203`

```
lodash@4.17.15
```

_fix:_ Upgrade lodash to 4.17.21.

### critical · secret · `src/config.ts:12`

**Credential in source** — An AWS access key id is committed in source.

_probe:_ `gitleaks` · _rule:_ `gitleaks/aws-access-key`

```
AKIAxxxxxxxxxxxxxxxx
```

_fix:_ Rotate the key and remove it from history.

### high · security · `src/api/users.ts:88`

**SQL injection** — Query built by string concatenation with request input.

_probe:_ `semgrep` · _rule:_ `semgrep/node-sql-injection`

```
db.query("SELECT * FROM users WHERE id = " + req.params.id)
```

_fix:_ Use a parameterised query.

_also:_ `src/api/admin.ts:31`

### high · bug · `src/billing/charge.ts:57`

**Non-idempotent retry** — The retry loop calls sendCharge() again on timeout without an idempotency key, so a slow response double-charges.

_confidence:_ `high` · _rule:_ `llm/bug.non-idempotent-retry`

```
await sendCharge(amount); // no idempotency key, retried on ETIMEDOUT
```

_fix:_ Pass an idempotency key derived from the invoice id.

### medium · quality · `src/orders/settle.ts:10`

**Copy-paste duplication** — Totalling and rounding logic is copy-pasted from src/billing/totals.ts with one sign flipped.

_confidence:_ `medium` · _rule:_ `llm/quality.copy-paste`

_fix:_ Extract the shared totalling helper.

### medium · structure · `src/web/routes/orders.ts:3`

**Layering violation** — The web layer imports straight from the database layer, bypassing the service boundary (7 imports).

_confidence:_ `medium` · _rule:_ `llm/structure.layering`

```
import { ordersTable } from "../../db/schema.ts";
```

_fix:_ Route these reads through the orders service.

### low · quality · `src/orders/settle.ts:61`

**Mechanical quality** — 'legacyTotal' is assigned a value but never used.

_probe:_ `eslint` · _rule:_ `eslint/no-unused-vars`

### info · structure · `src/legacy/importer.ts:1`

**Measured structure** — File is 912 lines with 14 top-level functions; review cost is high.

_probe:_ `metrics` · _rule:_ `metrics/long-file`
