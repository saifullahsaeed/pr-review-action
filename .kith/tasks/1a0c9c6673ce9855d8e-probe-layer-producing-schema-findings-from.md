# Probe layer producing schema findings from deterministic tools

**Status:** done · **Priority:** normal · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-09-22T16:35:12.190575+00:00

## How you know it is done

Deterministic scanners run and their output normalized into the findings model. Done: the probe run over a fixture repo with planted issues exits 0 and yields the expected findings per category (dependency, secret, security, quality, structure), asserted in tests.

## Checklist

- [x] Probe runner interface: run a tool, capture output, normalize to findings
- [x] osv-scanner/trivy probe for dependency advisories
- [x] gitleaks probe for secrets
- [x] semgrep probe for security patterns
- [x] Linter and structure-metrics probes (duplication, size, coupling)
- [x] Fixture repo with planted issues; expected-findings tests green


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
