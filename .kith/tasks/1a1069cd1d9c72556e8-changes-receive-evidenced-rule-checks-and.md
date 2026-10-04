# Changes receive evidenced rule checks and fail-closed required coverage

**Status:** planning · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-04T11:11:43.064785+00:00

## How you know it is done

Generic Python syntax-aware prohibited-call and import-boundary checks, dependency-ledger delta checks and externally supplied test evidence produce per-rule pass/fail/incomplete. Controlled Sadeef-like fixtures demonstrate compliant pass, forbidden call fail, cross-app internal import fail, missing ledger fail and absent evidence incomplete.

## Checklist

- [x] Implement isolated Python AST inspection without importing reviewed modules
- [x] Implement generic configured call and import restrictions including relative imports
- [x] Compare dependency manifests and ledger changes against base
- [x] Validate externally supplied evidence tied to reviewed revision; never run repository scripts automatically
- [x] Test violations, legitimate exceptions, parse failures and missing tooling/evidence


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
