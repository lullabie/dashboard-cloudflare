# V15 gate evidence — provenance

Gate run: coordinator, 2026-10-22, on the frozen V15 candidate
(remote commit `7883921607c27f308af33c383fab74ce58371fa7`, verified
byte-identical to the locally frozen assembly `3ef0e08` before the
run). Runner: `scripts/run-review-tests.mjs` with
`QA_BROWSER=chromium` (Chromium 156.0.8078.4, Node v24.20.0), plus
`scripts/run-negative-checks.mjs` and the V15 package checker in
`--stage` mode.

Result: LOCAL GATE PASS — 33 required browser cases PASS (34 total
including the extra TEST-STORE-005), 19 Node lane-test files, all
five new V15-AUDIT cases PASS. Negative checks 17/17. Package check
PASS (exact staged manifest, dependency closure resolved). Gate
runId: `355b1fba-ed20-4cbe-ad13-a7d5b63068a1`.

Files:

- `gate-output-v15.txt` — SANITIZED copy of the full gate output.
  Raw sha256 `9d530b9caf30651326fa6b95405b42434d838afbc83764d6154edc28d586b199`;
  published sha256 `8ee15e57875e148d0066aeabcedace51d112fc70e3e812e030dd87ff380871d8`.
  Sole change: the frozen-tree absolute path prefix replaced by
  `<tree>` (16 occurrences). Verified: replacing `<tree>` with the
  prefix reproduces the raw bytes exactly. Raw artifact retained by
  the coordinator outside the repo.
- `browser-results-v15.json` — byte-identical copy of the gate's
  `qa/v4/browser-results.json`. sha256
  `bbd9d271a75479601eb766cb402d049e26bf217eb7a38a699fd62b8df81226a2`.
- `negative-v15.txt` — byte-identical copy of the negative-checks
  output. sha256
  `d5ccd30a31561e39d1ab77c28529441e9c86ded1442981e12def9b14827b3561`.
- `package-v15.txt` — byte-identical copy of the package checker's
  `--stage` output on the frozen tree. sha256
  `6c3dee4e6c77d53f760aaba2c12e711c5e991fd8e16565c44a24c49c6dc4ef1c`.

This evidence is a local sandbox-browser gate only. Host acceptance
is NOT RUN. This is not release approval.
