# Large PRs receive bounded AI batches with explicit coverage

**Status:** working · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-01T15:20:33.237171+00:00

## How you know it is done

npm test and npm run typecheck pass; tests cover 400 changed files, changes past line 400, token-bounded contexts, accurate citation ranges, partial batch failures and JSON/Markdown coverage. Context budget wired from trusted config; no silent diff fallback or omission.

## Delivered

- Batched review implementation

---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
