# CLI and container a team can run

**Status:** planning · **Priority:** normal · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-09-22T15:40:18.203141+00:00

## How you know it is done

`harrier review <path> --out ./report` writes report.json, report.sarif and report.md, and `docker compose up` works from a clean checkout with a mirrored vulnerability database. Done: an end-to-end run over two real repos writes all three report files and exits 0.

## Checklist

- [x] `harrier review` CLI with --out, --endpoint, --categories and --severity flags
- [x] Pipeline: probes -> LLM passes -> merge/dedupe -> render
- [x] Dockerfile and docker-compose.yml
- [x] Offline/mirrored vulnerability-DB path documented and wired
- [x] End-to-end over two real repos; all three report files verified


## Delivered

- Self-review report — Harrier reviewing its own repo in the container (post non-root fix)

---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
