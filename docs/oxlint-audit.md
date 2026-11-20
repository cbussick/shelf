# Oxlint + tsrs setup

This records the historical PR93 setup. Current preset/backend versions and rule
policy are in the [Cloudflare migration report](cloudflare-oxlint-audit.md).

## Scope and versions

Shelf had no lint script at baseline `1e314be`. This adds `npm run lint`,
Oxlint **1.94.0** and tsrs **7.1.0-beta.tsrs3**, pinned in npm's manifest and
lockfile. Validation used Node **24.22.1**, npm **11.19.1**, Linux x64, and the
existing TypeScript **5.9.3**. `tsrs --version` identifies its compiler as
TypeScript 7.1.0-beta, upstream commit `3e9236361fa9`.

The configuration enables the correctness category as errors, plus explicit
`typescript/no-floating-promises`, `typescript/no-misused-promises`, and
`typescript/await-thenable`. Type-aware analysis and type-check diagnostics are
on in the root config, including for editor integrations that read it. Warnings
and unused disable directives fail the npm command. There is no formatting or
broad style migration and no existing repository CI workflow to extend; the
command is listed alongside Shelf's existing validation commands in README.

Oxlint discovers tsrs automatically; oxlint-tsgolint is not installed. Knip needs
a documented `tsrs` dependency exception because this runtime discovery has no
source import.

## Coverage and compatibility

No compiler options, TypeScript dependency version, existing `typecheck` script,
or build commands were weakened or replaced. Both existing configs also passed
`tsrs --noEmit -p tsconfig.json` and
`tsrs --noEmit -p tsconfig.server.json` directly.

A temporary server probe exposed a discovery gap: without a conventional
`src/server/tsconfig.json`, lint caught implicit-any and null assignment errors,
but missed the NodeNext requirement for `.js` import extensions. The new
one-line `extends` config delegates to the existing `tsconfig.server.json`.
With it, the same probe correctly reports TS2835 as well as TS7006 and TS2322.
The build still compiles from `tsconfig.server.json`.

Temporary client, server and test probes produced nonzero lint exits for floating
promises and invalid assignments. The client probe also triggered misused async
JSX callbacks and await-thenable. All probes were removed and lint passed again.
The file traversal was inspected: 97 files across client, server, shared code,
service worker, tests, root tool configs and loading-preview verification are linted.
Tests and files outside a discovered tsconfig use the backend's inferred program.

Lint ignores dependencies and generated build/test reports, and backend type
checking does not report every whole-project/global diagnostic. Keep both
`tsc` checks and the Vite/server compilation. Explicit `void` is allowed by the
floating-promise rule: it marks intentional detachment, not a guarantee that a
rejection is handled. The setup is not a complete audit of every async path.

## Useful findings and small fixes

- Pinning could reject without handling a local storage error. It now reports a
  notification. Reordering also handles a rejected recovery read. New browser
  regressions fail against baseline application code and pass with these fixes.
- Existing caught async form/color/close handlers now explicitly detach at void
  callback boundaries instead of implying their callers await them.
- Unknown rich-text footnote/image attributes are narrowed to strings instead of
  potentially rendering `[object Object]`.
- The Playwright fixture imported an unexported `StorageState` type. It now
  derives the type from the actual request-context API.
- Browser tests now narrow an audio element and string IndexedDB keys, and
  preserve the forwarding type of an overloaded bitmap-decoding wrapper.
- A log-privacy test could spread a cookie string into individual characters.
  It now handles a complete cookie string or array; numeric status sorting also
  uses an explicit comparator.

Narrow, explained line exceptions retain Playwright's required empty fixture
pattern, deliberately saved unbound prototype methods in fault-injection tests,
and the snapshot of a live DOM attribute collection before removing attributes.
These are not global safety-rule exclusions.

## Validation and timing

- `npm ci`: passed from a fresh dependency installation.
- `npm run lint`, `npm run typecheck`, `npm run build`: passed.
- `npm run knip`, `npm run knip:production`: passed. The existing redundant-entry
  configuration hint remains.
- `npm run test:unit`: all **61 tests in 9 files passed**.
- Final complete `npm test`: **61 unit tests passed; 238 browser tests passed,
  2 browser tests failed (9.4 minutes)**. Both failures match untouched baseline;
  this is not a green full suite. No tests were skipped or expectations weakened.
- `node docs/previews/loading/verify.mjs`: passed, including mobile/desktop,
  interruption, reduced motion and no browser errors.
- Independent read-only review of the implementation found no blocking issues.
  Browser validation and exact baseline comparisons are recorded below.
- `npm run audit` / high-severity audit threshold: passed, with **4 moderate**
  findings in the existing glob/minimatch/workbox/PWA dependency chain. No
  unrelated dependency upgrades were attempted.
- `git diff --check`: passed.

Three consecutive wall-clock runs including npm startup, without debug timing
instrumentation, measured:

| Command | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| `npm run lint` | 1.649 s | 1.286 s | 1.101 s |
| `npm run typecheck` | 13.458 s | 12.904 s | 12.740 s |

These measurements were taken on a shared host with other agents running. They
are not isolated benchmarks. Lint adds safety checks; its lower time does not
make it a replacement for tsc. Shelf had no prior linter to compare against, so
there is no measured backend-switch speedup for this repository.

## Browser test baseline limitations

The standard `npm test` command passed all unit tests, built successfully, then
was interrupted by the 600-second command time limit after **111 of 238**
browser tests completed: **108 passed, 3 failed**. This is an incomplete run,
not a passing full suite. A continuation attempt reported 126 passed and 2 failed
but suffered missing-artifact/output-directory collisions from an overlapping
focused Playwright invocation; that attempt is not relied on as a validation
pass. The final complete run above was run alone, with no other task browser
or build command overlapping, and supersedes those partial/contaminated runs.
Both new async failure regressions passed in the complete run.

Two failures at `tests/e2e/app.spec.ts:1181` (390px and 1280px) expect complete
card preview text at line 1196, but the current app intentionally mounts a
bounded excerpt. Both failures were reproduced on untouched baseline
`1e314be` in a separate detached worktree using the same installed dependencies
(existing dependency versions were unchanged), with:

```sh
npm exec playwright test -- tests/e2e/app.spec.ts \
  --grep 'creates, edits, pins|clamps long note previews' --workers=1
```

That baseline run reported **2 failed, 1 passed**. The assertions and application
preview behavior were left unchanged.

The third failure, `app.spec.ts:6`, is an intermittent strict-selector failure
at line 17: `getByRole('button', { name: 'Pin note' }).locator('svg')` matches
both editor and autosaved board pin buttons. The same test failed on the task
branch in a focused rerun. Repeating it on untouched baseline with
`--grep 'creates, edits, pins' --repeat-each=5 --workers=1` produced **2 failed,
3 passed**, reproducing the identical strict-selector error. This test was also
left unchanged. It passed in the final complete run, illustrating the baseline
intermittency rather than a guaranteed failure.

## Sources

- [Oxlint type-aware usage and TypeScript compatibility](https://oxc.rs/docs/guide/usage/linter/type-aware)
- [tsrs announcement and backend selection](https://oxc.rs/blog/2026-11-17-faster-type-aware-linting-with-tsrs)
- [Backend whole-project versus linted-file diagnostics](https://github.com/oxc-project/tsrs/blob/main/tools/tsgolint/README.md#type-checking-in-the-lint-run)
