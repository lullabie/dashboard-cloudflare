# FEEDS-FIX Manifest

## Task Description
Fix edge cases and race conditions in `js/feeds.js` during refresh, maintaining monotonic overlap resolution and URL identity cache protection.

## Input Hashes
- feeds.js base `4c785682e1a7a090be910a1d0dcc38cecc0431a4d88ee2509d0700b387b0f2f3`

## Output
1. `js/feeds.js` patched to address:
   - URL-bound status and cache updates
   - Monotonic generation tokens for refresh overlap
   - Rejecting HTML-shaped XML without wiping caches
   - Atom `rel="alternate"` prioritization over `rel="self"`
2. `test_refresh_persistence.js` implemented the adapter mock testing the explicit required edge cases (7 constraints passing).

## Limitations
- UI bounds validation substituted by NodeJS mocking per project constraint.
