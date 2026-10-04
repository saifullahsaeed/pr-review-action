# Project-rule enforcement: contract and resolver

User approved the proposed rule-enforcement plan in chat on 4 Oct 2026 with “go ahed”. This brief covers its first unit; downstream work is tasks 301 and 302.

## Requirements
- Explicit validated project policy: stable rule IDs, scopes, rule-source references, required/advisory classification and checker contracts. Prose is not automatically converted into mandatory checks.
- Resolve each file's ancestor AGENTS chain from the configured trusted root; preserve sources and proposal markers. Root safeguards cannot be silently overridden; conflicts require explicit policy, not invented interpretation.
- Generic policy, not hardcoded Sadeef rules. Sadeef-like fixtures are test inputs only; do not change Sadeef V2.
- Per-rule pass/fail/incomplete with evidence and coverage.
- Tests cover nesting, explicit exceptions, invalid policy, proposals and path containment. npm test and npm run typecheck must pass.

## First-release implementation choices (Kith)
- Policy is an explicit `enforcement` section of harrier.config.json. Machine entries cite prose source, but no Markdown parser claims to understand ratification or resolve semantic conflicts. Enforced entries must explicitly be marked approved; proposed entries remain advisory.
- Supported checker kinds: python-call, python-import, dependency-ledger, evidence. Semantic requirements without an executable check are declared unsupported/incomplete when required. No automatic repository script execution.
- Python standard-library ast parser runs in isolated mode on source bytes, never imports reviewed code. Missing python or syntax failures are incomplete, not pass.
- Test evidence must be supplied outside the reviewed tree by the invoking trusted workflow, identify exact reviewed commit and configured check ID, and assert successful execution. Harrier validates the envelope, not the truthfulness of an untrusted test producer. Sandboxed execution orchestration is not built in this release.
- Original slice kept AI semantic results advisory. User subsequently approved document-path compliance review in this conversation on 4 Oct 2026. Configured required document sources now participate in the gate: model-review completion is not deterministic proof; cited violations require an adversarial verifier; missing sources/model/context or verifier disagreement is incomplete. Explicit semantic checker entries without document review remain incomplete.
- Configuration-only checker entries may omit source; their citation defaults to harrier.config.json:1. Optional configured document files/folders and optional AGENTS chains supply scoped standards/reference material. Documents come from the trusted base in baseline mode; linked files must be explicitly configured.

## Downstream acceptance (tasks 301/302)
Compliant change passes; forbidden permission call fails; cross-app internal import fails; changed dependency without matching ledger change fails; absent required test evidence is incomplete; working-tree policy weakening cannot bypass trusted base rules. Report source rules, offending paths/lines and missing coverage. Changes to rule files are visible but do not redefine trusted policy.
