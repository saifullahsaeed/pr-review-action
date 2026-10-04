# Trusted project-rule verdicts enforce CLI and CI approvals

**Status:** planning · **Priority:** high · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-10-04T11:11:43.073612+00:00

## How you know it is done

Rule results are exposed in reports and gate exit codes; base-revision rule policy cannot be weakened by working-tree edits. All six acceptance scenarios run, npm test and npm run typecheck exit 0; documentation distinguishes supported enforcement, semantic advisory review and unverified workflow requirements.

## Checklist

- [ ] Integrate trusted base policy and changed-file selection with quality review
- [ ] Publish per-rule evidence and coverage before gate enforcement
- [ ] Connect applicable AGENTS context to semantic review without claiming guaranteed compliance
- [ ] Run six end-to-end acceptance scenarios including policy weakening
- [ ] Document configuration and limitations, review diff and commit passing work


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
