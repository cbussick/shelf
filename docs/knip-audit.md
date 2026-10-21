# Knip audit

Knip **6.42.1** is a pinned local devDependency. Run `npm run knip` and
`npm run knip:production`. Both report zero issues. This repository has no
aggregate verification script or CI workflow; the README lists both checks.

## Scope and findings

`knip.jsonc` includes the Express TypeScript entry because `npm start` names
compiled output. Normal mode already discovers this entry through `dev:server`
and emits a redundant-entry hint; the explicit entry is required in production.
Vite discovers the browser entry, and vite-plugin-pwa discovers `src/client/sw.ts`
(the injectManifest service worker); production debug output confirmed both.
Test configs discover unit/E2E tests, global setup, and imported fixtures. Only
`src` is a production project. There are no nested packages or public library
exports. No dependencies, runtime modules, or tests are ignored.

The initial normal report flagged `audioMimeTypeSchema`, used inside the same
contracts module. Initial production also missed six server modules and reported
three test fixtures, ten dependencies, and server schema exports. Runtime-root
configuration and production project scope resolve those false positives.
`ignoreExportsUsedInFile` retains genuinely internally used schemas/helpers.
No application code, tests, or APIs were deleted.

## Original verification (superseded by follow-up below)

- `npm run knip` and `npm run knip:production`: pass (0 issues).
- Temporary `src/shared/knipProbe.ts`, imported only by a unit test: normal
  passed (0), production failed (1) on the unused source file. Removed both
  probes and reran both clean audits.
- `npm run typecheck` and `npm run build`: pass.
- `npm test`: unit suite 23 passed. Initial E2E run lacked Chromium build 1243.
  Installed the matching headless browser under the task worktree and retried
  with `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp-browsers" npm test`: 110 E2E passed,
  two failed. WebKit test `audio.spec.ts:357` is blocked by missing WebKit build
  2359; it was not downloaded under the resource limits. The 320px editor-color
  test read `notes[0].color` before a note existed. The focused retry
  `PLAYWRIGHT_BROWSERS_PATH="$PWD/.tmp-browsers" npx --no-install playwright test tests/e2e/editor-colors.spec.ts`
  passed both viewport cases. No application/test code changed; the timing
  failure was not reproduced by that retry.
- `npm run audit`: fails on one high-severity Vite advisory group
  (GHSA-698v-4r3x-3vcv, GHSA-r825-w8mm-5pxw, GHSA-587h-7wmj-h5pm).
  Vite 7.3.6 and Playwright 1.63.0 are unchanged from main. Security upgrades
  are outside this task; no automatic audit fixes were applied.

Tests used their existing per-test temporary databases and local servers. No
live data, deployments, credentials, or services were used. Installs and heavy
checks were serialized with `/tmp/fernblick-knip-heavy.lock`. Task-created
dependencies, browser download, build and test outputs were removed after checks.

## Security follow-up and verification

Vite is updated from 7.3.6 to **7.3.7**, the patched release for the three
advisories above. The manifest minimum and locked Vite entry are the only
dependency changes. No forced audit fix, dependency override, or suppression is
used. Both `npm run audit` and the full `npm audit --json` now pass with zero
vulnerabilities.

The first follow-up browser run passed 111 tests and reproduced the original
320px color-test race. Its trace shows the test's API read preceding the note
upload. Clicking Close starts an asynchronous save; the background Synced label
can still describe the pre-save state until closing completes. The test now waits
for the editor to be hidden before checking Synced and reading the persisted
color. The persistence, reload, accessibility, and color assertions are unchanged;
no application code, test coverage, or timeouts were weakened.

- `npm run typecheck`, `npm run build`, both Knip modes and audit: pass.
- `npx --no-install playwright test tests/e2e/editor-colors.spec.ts --repeat-each=5`:
  all 10 viewport cases pass after the explicit save-completion wait.
- Subsequent full `npm test`: all 23 unit tests and all 112 E2E tests pass,
  including the WebKit audio case. Tests use their existing isolated servers and
  temporary databases. Installed dependencies, browsers and builds were removed
  after checks; diagnostic evidence is retained outside tracked files.

These results record the initial security follow-up. The combined branch also
retains newer main's Node 24.22.1 floor. Current verification and integration
status are tracked in [PR #63](https://github.com/cbussick/shelf/pull/63).
Publishing uses ordinary Git over SSH; integration must use the reviewed PR.
Verification did not change a deployment or production data.
