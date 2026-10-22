# V14B frozen-gate evidence — provenance

Source run: coordinator frozen gate on the V14B frozen commit
`4883425958486fdc62897b2270097dd98f40d0fa` (QA spec only; production
tree byte-identical to the V14 frozen commit `0c2d779`).

- Gate run: `scripts/run-review-tests.mjs` + `scripts/run-negative-checks.mjs`,
  repo root, `QA_BROWSER=chromium`.
- Runtime: Node v24.20.0; Chromium 156.0.8078.4 (QA browser build).
- Result: exit 0. Node suites 14/14. Browser 29 total / 28 required
  PASS. Negative checks 17/17.
- runId `735ae833-629a-456e-a88d-0364a0be3e63`;
  generatedAt `2026-10-22T16:57:15.419Z`.
- Tested commit in the results file: `4883425`. Store SHA-256
  `7f77e9effc6556c1e27e995da5db3835bb6da40564241cad7a7a669a5578dd95`;
  feeds SHA-256 `b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88`.

## Files

| File | Raw SHA-256 | Published SHA-256 | Treatment |
|---|---|---|---|
| gate-output-v14b.txt | `3e9e65bfcf1dfb03198465b05149160ab47992cebd930b78becf93dd945f7831` | `e2f8bd605ac9c68ec8b41ae3db39e1602fb5caa7978132d12accea14b0df8260` | Sanitized: the local frozen-tree absolute path prefix replaced by `<tree>`, 14 occurrences. No other byte changed. Round-trip verified: replacing `<tree>` with the prefix reproduces the raw file exactly. |
| browser-results-v14b.json | `60fe95e964d95d954bd0cf1d2d245172ef8ed28945d8af3520c0b4007d018441` | `60fe95e964d95d954bd0cf1d2d245172ef8ed28945d8af3520c0b4007d018441` | Byte-identical to the raw gate output. |
| negative-v14b.txt | `0aa866200880a2cd0436200e537e39a45ba5ae83e9b721d7689da4a0c9f6a968` | `0aa866200880a2cd0436200e537e39a45ba5ae83e9b721d7689da4a0c9f6a968` | Byte-identical to the raw gate output. |

## Independent verification (Codex, reported 2026-10-22)

Codex reran the full gate independently at branch head
`1696d372e3ce6bf0fc9d875c31747d65d7b22cdb` (production tree identical
to the frozen commit): installed Chrome 155.0.8059.85, Node 24.19,
isolated native IndexedDB/BroadcastChannel, invented records, no
source substitutions. Full gate exit 0: 28 required browser cases
PASS (29 total), 14 Node files, negative 17/17. runId
`efb3274d-f662-4b8e-9c36-5c82f899c06d`. A separate places run also
passed with a real stale proof (distinct captured ids at token
revision 2, winner revision 3, disk proof under hold: id-less record
at revision 2; stale save rejected with the disk unchanged; fresh
commit and retry verified). Codex retains its own logs/JSON; this
folder publishes the coordinator's frozen-gate artifacts.
