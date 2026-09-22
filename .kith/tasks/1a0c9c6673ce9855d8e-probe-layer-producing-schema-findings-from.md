# Probe layer producing schema findings from deterministic tools

**Status:** planning · **Priority:** normal · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-09-22T15:40:18.106925+00:00

## How you know it is done

Deterministic scanners run and their output normalized into the findings model. Done: the probe run over a fixture repo with planted issues exits 0 and yields the expected findings per category (dependency, secret, security, quality, structure), asserted in tests.

## Checklist

- [ ] Probe runner interface: run a tool, capture output, normalize to findings
- [ ] osv-scanner/trivy probe for dependency advisories
- [ ] gitleaks probe for secrets
- [ ] semgrep probe for security patterns
- [ ] Linter and structure-metrics probes (duplication, size, coupling)
- [ ] Fixture repo with planted issues; expected-findings tests green


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
