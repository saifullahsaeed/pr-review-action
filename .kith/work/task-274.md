# Baseline-aware quality gates
Approved in chat: user said “ok make it” after the proposed first slice (gate engine, baseline comparison, GitHub publishing).

Scope: validated gate policy; deterministic probe findings block, AI remains advisory; baseline from a resolved git base revision scanned with the same settings; new/existing/worsened/resolved classification; required current and baseline scan gaps fail closed; gate JSON and Markdown plus CLI exit codes. No UI, new architecture rules, coverage ingestion or exceptions in this slice.

Checks: npm test and npm run typecheck. Integration cases: clean pass, new violation fail, unchanged debt pass, required scanner failure incomplete. Baseline retrieval and invalid policy must not silently pass.
