# Large PRs receive bounded AI batches with explicit coverage

**Status:** done · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-04T11:59:28.856369+00:00

## How you know it is done

400-file batching and deep line coverage plus opt-in exact BPE content-token guard for selected OpenAI models. Chat-template overhead is reserved separately; unsupported models/missing cache never fall back. npm test and typecheck pass.

## Delivered

- Batched review implementation

---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
