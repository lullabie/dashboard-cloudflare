# Deployment record — static dashboard on Cloudflare Workers (M1)

- Deployed: 2026-10-23, ~12:21 IST, by the coordinator via wrangler
  4.152.0, authenticated through the user's `custom.cloudflare` connector
  token (account `97e61af65f51d0a87b92f890fd1a25b2`).
- Worker name: `dashboard`
- URL: https://dashboard.mnoamanhussain.workers.dev
- **Version ID: `b89a72f3-a87f-48c8-8a33-ba2eb68c5b84`**

## Source — exact

- Frozen candidate (local freeze): `cfefa9af327a83174d38c38fe27556c3685a4294`
  - Parent: `3f257bcc2b20bd24608bbf8ea6c63f7cb97eed8c`
  - Tree: `dca6329b08a9fc8d59b9834b24b52355fd4a3bf6`
- Published twin on `codex/v5-review`: `8bb25b3dc6255e3fc2cefff01dcec5522155a2e7`
  (same parent, same tree — identical content), under documentation head
  `85dd056c203d8dd8da39914707566859024650af`. No remote branch points to
  cfefa9a itself.

## Deploy-only additions (not in the source tree)

- `wrangler.jsonc` (deploy folder root), sha256
  `3c1a999ed1c6bfeef3efbf9fc9b802f47c79650c268ee386f62b943dc993744d`:
  name `dashboard`, compatibility_date `2026-10-23`, assets `./assets`.
- `_headers` (inside the assets root), sha256
  `ed8ea04da129cce0ea9855eb305ff43edf892c74323669e34f9715731ee599ab`:
  CSP `default-src 'self'; script-src 'self'; style-src 'self'; connect-src
  'self' https://www.bankofcanada.ca https: http:; frame-src
  https://www.openstreetmap.org; img-src 'self' data:; object-src 'none';
  base-uri 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: same-origin`, and `Cache-Control: no-cache` on
  `/index.html`.

## Final upload package — 22 files, 467,869 B, hashed after `_headers`

| File | sha256 |
|---|---|
| LICENSE | a09138d2168be64783ee7185c1a36bb03297c4302039d4062f19861ba4972648 |
| THIRD-PARTY-NOTICES.txt | d64682fb8b01bc8c5e205ed34af94105ca46ecafd2ddaeae72a1986e658ab6ce |
| _headers | ed8ea04da129cce0ea9855eb305ff43edf892c74323669e34f9715731ee599ab |
| css/app.css | 53c3fc28744bfaf34be84ea708fec9a05c53401e2b5d2efb9d9cb77fa07f9e3a |
| css/visual-upgrade.css | f31249152a7083ded13e987728795369429e05fab32cc20c9d81c14ad876b1b8 |
| index.html | 3cae857aedc424ccb8e646af82ade26ce9a95c6a5536b6b5910ec1ebbdcc3216 |
| js/chart.umd.js | ecc3cd1eeb8c34d2178e3f59fd63ec5a3d84358c11730af0b9958dc886d7652a |
| js/college.js | d2aeb5ea96aaf92c4478debbcc06158024434ff0a5330cc277330d500632a66a |
| js/countdowns.js | 8c85af558b24e38eb4f48529aa39a981233e2d43cda4ccb581b07cb5565f2713 |
| js/feeds.js | b0fe9d6b31caa11f6dbec86afae6fa38912ed7d6ff4c6f259001bd472620be88 |
| js/goals.js | 275274982c74e39de649da809a5168c77cc2531a4cd043cc0424381a913c4533 |
| js/habits.js | 2531e84bf44432b91544a9772d8ca6e97fc68231890bd51de7be9cbce4f8c413 |
| js/indicators.js | ff0146db804deb004fe2f05b2e1353b20f78123f3b34eca2930936b8cfc56b73 |
| js/investments.js | e7d9668eba3a4204b48286b7c0101d4a7d3584799bff39922204dea48dc03f05 |
| js/jobs.js | 4a74bf4077abad0a652c333b506d97ff784d9dde6201f9a5eec59a283ab2b9cb |
| js/main.js | 43316e7b84100416e6fd12496d47fb5c484568bd50fb6a958eb30efe8eaae7e6 |
| js/maps.js | eb8f1b9e60125c25a34a8a2111e23aaf7ba9c1acf8e3604b42a589046a0b4104 |
| js/store.js | 3d96eee79e7e34405d78049117a0741e7b7b09a0e6b7f5bb260dc32ea839e35c |
| js/visuals/chart-explorer.js | 5b3f7afffa3d2f165dea1233df72d55fe8a983015b1a426f6618c35562a2e2b5 |
| js/visuals/charts.js | 7ee5cf1fef3fb0a211a847fd94fd15b33f5386e07eb73a721d6c822804ba5404a |
| js/visuals/deadline-timeline.js | 8621f8a611a86bb6f9b6ed80f4d87d8aff6cfc2def1d00ef63709500277e3871 |
| js/visuals/progress-summary.js | e2bb90a7eae48404bbd9378ab2d996f849729c464140028cb2ca7745c6166b7a |

Wrangler reported "Uploaded 21 files": the 21 assets; `_headers` is
consumed as configuration, not counted as a served asset.

## Verification

- Coordinator (curl, 2026-10-23): `/` returns 200, byte-identical to the
  staged `index.html` (sha256 `3cae857a…`); `js/main.js`, `js/store.js`,
  `css/app.css`, `js/chart.umd.js` byte-identical live vs staged; the
  `_headers` rules are live (CSP as above, nosniff, Referrer-Policy);
  `/index.html` returns 307 → `/` with `Cache-Control: no-cache`.
- Codex (independent fetch, 2026-10-23): HTTP 200, title `Dashboard`,
  `text/html`, CSP present. **Scope of that check: public static
  reachability only.** Codex did not verify the version/hash claims or
  interactive hosted acceptance, and it is **not** scheduled-refresh
  acceptance.

## Open after this deployment

- Cloudflare Access is **not** yet in front of the workers.dev address;
  the site is public and ships empty (user data lives in the browser's
  IndexedDB on that origin).
- Data runbook not yet run: export from the old Pages origin, import on
  workers.dev, verify all sections — required before first real use.
- Gap 11: Codex's independent installed-Chrome rerun of `8bb25b3` is
  still pending. PR #2 remains draft; no merge.
- GitHub Pages retirement: decided, execution blocked (workflows 403).
- Unattended refresh is a **separate milestone** — see
  `docs/review/refresh-worker/` (design review package). This deployment
  does not provide it and must never be reported as doing so.
