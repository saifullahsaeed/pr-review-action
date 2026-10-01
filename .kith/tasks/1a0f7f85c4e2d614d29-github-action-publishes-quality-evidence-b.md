# GitHub Action publishes quality evidence before enforcing verdict

**Status:** working · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-01T15:06:10.103289+00:00

## How you know it is done

Action passes fail-on and trusted base policy to CLI, publishes summary/artifacts before final gate failure, handles fork permissions and annotations; automated tests verify wiring and publishing behavior; npm test and npm run typecheck pass.

## Checklist

- [x] Wire gate inputs, trusted base revision and policy into the Action
- [x] Publish job summary, idempotent PR feedback and artifacts before exit enforcement
- [x] Test Action paths and document required branch protection and limitations


## Delivered

- GitHub quality gate configuration and usage

---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
