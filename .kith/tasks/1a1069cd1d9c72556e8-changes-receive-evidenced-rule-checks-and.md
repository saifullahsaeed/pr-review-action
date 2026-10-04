# Changes receive evidenced rule checks and fail-closed required coverage

**Status:** done · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-04T11:55:27.435346+00:00

## How you know it is done

Python AST, manifest/ledger and revision-bound evidence checks implemented and covered by passing CLI/unit tests.

## Checklist

- [x] Implement isolated Python AST inspection without importing reviewed modules
- [x] Implement generic configured call and import restrictions including relative imports
- [x] Compare dependency manifests and ledger changes against base
- [x] Validate externally supplied evidence tied to reviewed revision; never run repository scripts automatically
- [x] Test violations, legitimate exceptions, parse failures and missing tooling/evidence


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
