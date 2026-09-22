# LLM judgement passes through a configured endpoint

**Status:** done · **Priority:** normal · **Filed by:** saifullahsaeed.work@gmail.com (Kith) · **Updated:** 2026-09-22T16:44:04.295367+00:00

## How you know it is done

Structure, quality and bug review passes calling a configured OpenAI-compatible endpoint, emitting schema findings with code locations. Done: `npm test` exits 0 offline against recorded responses, and a live run against a real endpoint produces findings carrying file/line locations.

## Checklist

- [x] Endpoint config (base URL, key, model) and typed client
- [x] Review protocol per category (structure, quality, bugs) requiring code locations
- [x] Normalization plus a self-check dropping findings without locations
- [x] Recorded-response fixtures; suite green with no network
- [x] Live smoke run against the fixture repo


---

Mirrored from Kith's board. Edit the task in Kith rather than here — this file is rewritten whenever the task changes.
