# GitHub quality gate integration
Approved in chat: user said “ok make it” after proposal for gate engine, baseline comparison and GitHub publishing.

Scope: Action fail-on wiring, base revision and trusted policy, reports published before enforcing CLI verdict, job summary and artifacts, idempotent PR feedback with fork-safe permissions. Use environment variables and argument arrays instead of interpolated shell inputs. Do not execute reviewed repository scripts with secrets. Required branch protection documented; live GitHub verification reported separately from automated tests.

Checks: npm test and npm run typecheck, automated Action/publishing tests, four CLI integration cases covered by task 274. No UI.
