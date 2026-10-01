# Work references

- Quality-gate scope: `.kith/work/task-274.md` and `.kith/work/task-275.md`. User approved the first slice in chat on 2026-10-01: gate engine, baseline comparison, GitHub publishing; four acceptance scenarios. Open these before expanding scope. No UI.
- Public Action integration contract and limitations: `README.md`, section “Baseline-aware quality gate”; actual implementation `action.yml`, `scripts/action-run.ts`, `scripts/github-publish.cjs`.
- Executable acceptance evidence: `tests/gate.test.ts` and `tests/action.test.ts`; run `npm test` and `npm run typecheck`. Mock GitHub publishing tests do not establish a live GitHub Action run.
