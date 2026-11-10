# Codebase audit

Baseline: `9730085` (video attachment support).

## Changes

- **Keep related browser-storage operations atomic.** Local reordering now reads and writes notes in one transaction. Remote merging reads pending edits/order in the transaction that applies remote notes, so another tab cannot insert an edit between the pending check and the overwrite. Deletion removes blobs from the current stored note, not an older editor snapshot, in the same transaction as the note and outbox update.
- **Remove redundant state and work.** Pending order metadata stores only its mutation token; the saved ID list was never read. Server reordering selects IDs instead of loading every note body and attachment, and uses set membership rather than repeated array scans. Image metadata inspection reads from the upload path instead of allocating a whole-file JavaScript buffer.
- **Reject invalid attachments consistently.** Duplicate retained image IDs now fail validation, like audio IDs. Images with recognized signatures but unreadable metadata return a client error and roll back staged attachments rather than reporting an internal server error.
- **Apply compatible security updates.** The lockfile updates body-parser, multer, Zod, fast-uri, ip-address, qs, and serialize-javascript without changing dependency ranges or adding dependencies.

## What was deliberately retained

Both Knip modes report no unused code or dependencies. No production feature was removed merely to reduce line count. The explicit server entry in `knip.jsonc` is necessary for production auditing despite the regular audit's redundant-entry hint; removing it makes production Knip misclassify the server and its dependencies as unused.

Existing database migrations, older-client attachment defaults, stable attachment IDs, and conflict-copy behavior remain intact. This pass avoids a wholesale rewrite of the upload route or sync engine: the concrete fixes are smaller and preserve their existing interfaces.

## Verification

- `npm run typecheck`: passed.
- `npm run knip` and `npm run knip:production`: passed (regular Knip retains the informational entry hint described above).
- `npm run test:unit`: 46 passed.
- `npx playwright test`: 163 passed, including the new storage regressions; global setup rebuilt the application.
- `npm run build`: passed with the upstream/bundle warnings noted below.
- `npm run audit`: passed its high-severity threshold; six lower-severity advisories remain.
- `npm audit --omit=dev --audit-level=low`: zero vulnerabilities.
- `git diff --check`: passed.

Regression tests cover a local edit queued during remote merging, deletion from an older editor after attachments change, duplicate retained images, malformed-image rollback, and partial server ordering. Existing tests cover reordering, offline editing, conflicts, media, and authentication.

Independent read-only reviews were produced by two isolated Pi processes:

### Standards

No actionable findings or documented-standard violations. The transaction changes keep network work outside IndexedDB transactions, and the new tests exercise the intended races.

### Spec

No actionable findings or scope creep against the request to audit, simplify, and improve. The reviewer noted that local reordering does not yet have a dedicated concurrency regression test; its normal behavior is covered by existing browser tests.

Summary: **Standards: 0 findings. Spec: 0 findings.**

## Remaining limitations

- The production dependency audit reports zero vulnerabilities. The full dependency audit still reports six low/moderate advisories in the PWA build-tool dependency chain (deepmerge, glob, minimatch and their dependants). npm proposes a breaking PWA-plugin downgrade; that was not applied automatically. There are no remaining high/critical advisories.
- The build retains its large-client-chunk warning and upstream Zod pure-annotation warnings. Splitting editor loading would require separate offline/update-path verification, not merely suppressing the warning.
- This is a targeted static, dependency, and regression-test audit, not a penetration test or a proof that every concurrency interleaving is safe.
