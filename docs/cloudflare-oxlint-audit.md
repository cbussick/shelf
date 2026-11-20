# Cloudflare preset defaults: implementation and decision report

## Current status: draft, partial, not lint-clean

PR #94 now evaluates **stock `@cloudflare/oxlint-config` defaults**, superseding
the curated-policy recommendation at commit `603703d`. Mechanical changes were
explicitly authorized. Every migration-added global/file rule exclusion and
relaxed option has been removed. `oxlint.config.ts` contains the preset plus
stronger pre-existing Shelf coverage, not a collection of convenience disables.

**Root lint genuinely fails on 45 remaining React diagnostics:** 37 `react/refs`,
6 `react/set-state-in-effect`, and 2 `react/immutability`, in `App.tsx`, `Editor.tsx`
and `AudioPlayer.tsx`. These are **not suppressed** or described as false
positives. The PR is a draft pending a decision on behavior-sensitive lifecycle
redesign. Passing runtime tests do not make those patterns compliant.

**Recommendation:** the mechanical and boundary defaults are implementable and
useful; keep that work. Do **not** claim complete default compliance or merge
this PR yet. Decide whether to authorize the auth/editor/checkpoint/audio state
redesign described below. Do not bypass the rules with microtasks, hide mutable
state behind methods solely to evade analysis, or weaken save/auth behavior.

No merge, main push or deployment is authorized. The clean dedicated branch
`chore/cloudflare-oxlint` and `.worktrees/cloudflare-oxlint` remain for review.
The primary `main` checkout remains separate and unchanged.

## Versions, compatibility and retained stronger checks

Node **24.22.1**, npm **11.19.1**, Linux x64:

| Package | Original main | Migration |
| --- | --- | --- |
| `@cloudflare/oxlint-config` | absent | **0.1.0**, exact |
| `@nkzw/oxlint-config` | absent | **3.0.0**, inherited exact |
| `oxlint` | **1.94.0** | **1.94.0**, unchanged |
| `tsrs` | **7.1.0-beta.tsrs3** | **0.25.0-ts7.1.0-beta**, exact |
| `typescript` | **5.9.3** | **5.9.3**, unchanged |

Registry and installed manifests require Oxlint `^1.94.0` and tsrs
`>=0.25.0-ts7.1.0-beta`. The preset's Node range is `^22.18.0 || >=24.0.0`.
The README's exact tsrs release was installed without force/legacy-peer flags;
compatibility was not guessed from unusual version ordering. `npm ls` has a
valid peer tree. `tsrs --version` reports compiler commit **3e9236361fa9**, the
same upstream compiler commit as the original backend. Lint probes, both direct
tsrs compilations and a fresh npm installation validate actual runtime operation.
The dependency changes add **79 installed packages**, including JavaScript-plugin
peers; no unrelated production dependency version changed.

`.oxlintrc.json` is replaced by root-spread `oxlint.config.ts`, preserving preset
environments, plugins, options and overrides. The existing lint script still
denies warnings and reports unused disable directives. There is no existing CI
workflow to extend.

These deviations from stock are **stronger existing coverage**, not exceptions:

- Root `typeAware: true` and **`typeCheck: true`**, including config/editor consumers.
- Strict promise/JSX-void callback checks and strict await-thenable options; no
  inherited relaxation for mixed promise arrays or async JSX handlers.
- Twenty-four original explicit correctness rules absent from the preset,
  including no-base-to-string, restrict-template-expressions, no-unnecessary-await
  and the Oxc/unicorn checks listed in the config.
- Fifteen original syntax checks restored after the preset disables them for
  TypeScript. Test `unbound-method` safety is also restored after inherited test
  overrides. Other stock test/JavaScript relaxations remain stock behavior.
- Original ignore patterns, `src/server/tsconfig.json` discovery shim, NodeNext
  settings, both existing tsc checks, TypeScript version and Vite/server build
  commands unchanged. Final traversal is **102 files**, versus original 97.
- Pre-existing PR93 narrow suppressions retained (listed separately below).

Knip now discovers tsrs through preset peers, so its former dependency-ignore
exception was removed. Both modes remain enabled.

## What implementing the defaults actually entailed

The first phase committed passing adoption, then 35 per-rule decisions. The
user subsequently requested real default compliance. The continuation preserves
that history and adds focused commits implementing the previously excluded
rules; it does not rewrite history or defend the earlier exclusions.

Re-enabling stock rules against `603703d` produced **975 diagnostics across 27
rules**, after the first phase's genuine fixes. The original first trial had
1,003 findings across 35 rules. Counts are diagnostics, not distinct bugs.

| Stock rule | Continuation findings | Implemented result |
| --- | ---: | --- |
| `curly` | 446 | Default braces applied, including nested loops/guards. |
| `typescript/array-type` | 117 | Default `Array<T>` notation applied. |
| `typescript/no-unsafe-type-assertion` | 85 | Driver/query contracts, raw-value parsing, DOM generics/guards and declared test-owned browser hooks replace casts; only three precise native typing exceptions remain. |
| `import/consistent-type-specifier-style` | 42 | Top-level type-only declarations replace mixed inline specifiers. |
| `react/refs` | 39 | Two latest-callback writes moved to layout commit; **37 remain exposed** for redesign. |
| `typescript/no-non-null-assertion` | 37 | Capture stable values, narrow filters, check required DOM/cache invariants; no blanket exception or silent optional chaining of required work. |
| `typescript/no-unnecessary-type-assertion` | 33 | Provably redundant assertions removed. |
| `typescript/no-unsafe-call` | 27 | Test wire schemas derive from shared contracts before method calls; required-note lookup fails explicitly if absent. |
| `quality/no-chained-type-assertions` | 25 | Test-owned Window declarations and a correctly declared worker entry replace double casts. |
| `import/no-namespace` | 14 | Supported named StyleX imports; actual Vite build verifies compiler support. No StyleX exemption. |
| `@nkzw/no-instanceof` | 13 | File exclusions removed; actual named Error constructors comply with stock policy. Only 15 necessary DOM/File identity guards retain explained line exceptions. |
| `typescript/no-unsafe-assignment` | 11 | Raw IDB values remain `unknown` until parsed; Express route/ProseMirror values narrowed. No invented claim that raw note bytes are validated. |
| `typescript/no-unsafe-return` | 11 | Shared wire parsing, typed geometry and validated serialized editor trees. |
| `unicorn/catch-error-name` | 10 | Preset catch names applied. |
| `quality/no-known-value-widening` | 10 | Concrete lookup and log contracts, stable named view types; maps prevent inherited-key MIME lookup. |
| `quality/no-conditional-empty-object-spread` | 8 | Optional payload/log fields assigned explicitly, retaining omission rather than replacing it with present-undefined fields. |
| `typescript/consistent-type-imports` | 7 | Stock import() annotation policy; erased named imports and explicit test API shape. |
| `react/set-state-in-effect` | 6 | **All six remain exposed**, not hidden behind asynchronous scheduling. |
| `quality/no-unsafe-dictionary-type` | 6 | Concrete log shapes and explicit viewport reflection; privacy tests preserve every extra log property. |
| `eqeqeq` | 6 | Stock strict equality, explicitly preserving both null and undefined cases for task attributes. |
| `unicorn/consistent-function-scoping` | 6 | Pure helpers hoisted; two browser-serialization helpers have exact line exceptions. |
| `react/rules-of-hooks` | 5 | Playwright positional fixture callback renamed `provide`; no hook exclusion. |
| `unicorn/numeric-separators-style` | 3 | Preset grouping applied. |
| `no-console` | 2 | Verification CLI explicitly writes the same newline-terminated stdout output. |
| `react/button-has-type` | 2 | Button types moved out of shared spread props to the two JSX sites. |
| `quality/no-unknown-returns` | 2 | Native IDB reader contract and actual Express response/void callback type. Raw metadata is parsed, not falsely asserted. |
| `react/immutability` | 2 | **Both remain exposed** on the mutable checkpoint controller. |

Other first-phase fixes remain: real dialog cleanup with red/green regression,
unknown promise-catch parameters, true type-only imports, explicit callback
executor blocks and Number helpers in browser assertions.

### Semantic work and regression coverage

- **MIME lookup:** object dictionaries could accept inherited keys such as
  `constructor` as filename extensions. Concrete maps retain valid MIME aliases,
  extension fallback and declared-MIME precedence. Four new unit cases cover
  those behaviors and inherited-key rejection. Running those cases against the
  original main implementation produced the expected **2 failures / 2 passes**;
  the fixed implementation passes all four.
- **Editor serialization:** ProseMirror's `toJSON()` returns `any`. A recursive
  schema validates the prepared-tree boundary and JSON attributes instead of
  casting them. Unit cases preserve nested attributes and reject malformed
  children/non-JSON attributes. This adds runtime validation; browser tests must
  confirm existing Markdown/schema flows remain valid.
- **IDB metadata:** note/outbox/blob/meta stores declare raw values `unknown`.
  Pending-order and editor-redirect records are parsed before use. The existing
  share database uses its own application-owned driver schema rather than casts.
  A new browser regression injects malformed redirect metadata and requires the
  attempted write to reject **without losing the saved checkpoint or queue**.
- **DOM ownership:** actual event guards replace unsafe EventTarget casts;
  typed native query/constructor contracts avoid narrowing assertions. Existing
  runtime identity checks are retained, not replaced with structural impostors.
- **Commit-time callbacks:** recorder suspension and rich-editor latest callbacks
  are published in layout effects, not mutated by speculative renders. Initial
  refs are initialized normally. Layout timing precedes passive editor creation
  and browser paint. A new browser case delays microphone acquisition across a
  committed session lock, then verifies tracks stop and recording cannot start.
- **Drag listeners:** React 19.2 `useEffectEvent` gives document listeners current
  handlers without a missing dependency array or stale closure. This replaces
  the previous per-render-effect exception. A new browser case refreshes notes
  during an active drag, replacing onReorder, then verifies the committed order
  includes the new remote note. A stale callback would omit that ID.

No test expectation or timeout was weakened. Test wire-response schemas are
loose at response/note/image/audio levels, retain unexpected fields for equality
assertions, and require the wire's audio/rotation fields instead of supplying
application defaults. Two additional unit regressions prove this evidence is not
silently normalized away. The log parser is also loose so privacy checks still
inspect unexpected fields rather than silently stripping secrets.

## Decision required: remaining React lifecycle work

These are not style findings or proven false positives. There are 45 diagnostics,
often multiple labels on the same expression, so they do not represent 45 bugs.

| Area | Why straightforward rule-silencing is unsafe | Proposed next work |
| --- | --- | --- |
| `src/client/App.tsx` | `workspaceOpened.current` controls auth/offline mounting and confirmed-expiry locking during render. Draft identities increment a ref inside useMemo. Effects reset editor sync/parked-editor state and initiate synchronization. Simply moving work to a passive effect or microtask changes mounting/version/status ordering. | Explicit auth/workspace and editor-session state transitions; allocate draft identity when opening a session, not during render; define synchronization/subscription ownership and keep offline cached access and 401 lock semantics. |
| `src/client/components/Editor.tsx` | Render reads session/committed-note refs and a mutable CheckpointWriter; current code publishes latest callbacks during render and directly mutates the controller/subscription properties. Those values determine dirty state, checkpoint version, save retry and retained-dialog reuse. | Immutable controller snapshots and an external-store subscription (for example useSyncExternalStore), with explicit committed-note/session identity ownership. Preserve immediate local saves, exact version handoff and interruption/close guarantees. Do not merely hide field mutations inside methods to fool analysis. |
| `src/client/components/AudioPlayer.tsx` | Render reads promise-ref availability for seeking; an effect updates duration from upload/server metadata while native playback also updates duration. | Own source availability and provided/measured duration as render state while preserving coalesced concurrent loads, object-URL cleanup and metadata/decoded-duration precedence. Test those transitions rather than defer the setter artificially. |

The parent pane was notified without `--wait` and asked whether to authorize this
redesign phase. Pending that decision, the rules stay **enabled and failing**;
there is no permanent or temporary blanket React exclusion left in the config.
This report must not be represented as a completed lint-clean migration.

## Every remaining exception

All migration-added exceptions are **one source line**, never a whole file or
rule-wide override. File names below identify exact guarded operations; adjacent
source comments carry the rationale. Current locations are recorded after the
mechanical fixes (line numbers can move with future review).

### New exceptions: 20 directives

- **15 `@nkzw/no-instanceof` guards.** Native DOM/File identity must be checked
  before calling class-specific APIs; inputs are from the same document/worker
  realm, not cross-realm objects. Replacing these guards with casts would weaken
  safety. Server error guards need no exception: actual named MulterError imports
  and a properly named private NoteConflictError comply with stock Error policy.
  Node verified that the named MulterError is exactly the previous constructor;
  typecheck/build, 69 units and nine focused browser cases passed afterwards.
  - `src/client/components/AddAudio.tsx:19`: document pointer target Node.
  - `src/client/components/NoteContextMenu.tsx:78,97`: pointer/keyboard targets Node.
  - `src/client/components/RichTextEditor.tsx:148,328`: Node containment and Element.closest.
  - `src/client/components/Editor.tsx:241,247,325,344,382`: captured Element, editing HTMLElement, outside-click Node, active HTMLElement, native HTMLVideoElement arrow-key ownership.
  - `src/client/App.tsx:266,272`: native HTMLElement keyboard targets.
  - `src/client/sw.ts:45`: reject FormData strings before File MIME/size checks.
  - `tests/e2e/audio-error-layout.spec.ts:41`: retain the native audio/error assertion.
  - `tests/e2e/note-autosave.spec.ts:23`: native active-element blur guard.
- **3 `typescript/no-unsafe-type-assertion` native typing gaps.**
  - `src/client/components/NoteBoard.tsx:68`: native cloneNode preserves the
    HTMLElement class, but lib.dom returns Node and exposes no generic clone
    overload. The source card comes from a typed HTML-card query.
  - `tests/e2e/local-store-autosave.spec.ts:285` and
    `tests/e2e/note-save-recovery.spec.ts:87`: transparent async bitmap wrappers
    forward every argument unchanged. Parameters<T> exposes only the last
    native overload, so TypeScript cannot prove preservation of both overloads.
    The original stronger forwarding type is retained rather than narrowing the API.
- **2 `unicorn/consistent-function-scoping` serialization boundaries.**
  `tests/e2e/local-store-autosave.spec.ts:90,310`: countBlobs/uploadBlobKeys are
  invoked repeatedly inside the callback Playwright serializes to the browser.
  Hoisting into Node's module scope would leave the browser functions undefined;
  they cannot close over Node helpers. Other pure helpers were actually hoisted.

### Pre-existing PR93 exceptions: 11 directives

These retain stronger old coverage; none is a new convenience exemption:

- `tests/fixtures/isolated-test.ts`: Playwright's required empty destructuring
  pattern for fixture dependency discovery (`no-empty-pattern`, one line).
- `src/client/rich-text.ts`: snapshot the live NamedNodeMap before removing DOM
  attributes (`unicorn/no-useless-spread`, one line).
- Nine saved native prototype-method references in fault-injection tests
  (`typescript/unbound-method`): `async-callbacks`, `local-store-atomicity`,
  `note-autosave`, `note-context-color` (two), `note-save-recovery` (three), and
  `sync-errors`. They are intentionally later restored/called with the receiver.

## Validation and baseline

### Baseline actually observed in this task

Original clean main **8560f06**: fresh installation, original lint/typecheck and
61 unit tests passed. Full browsers: **237 passed, 3 failed** (8.1 minutes):
two preview-text assertions plus the Chromium 320px cursor-placement case.
Serial focused baseline, repeated three times with one worker: **11 passed,
1 failed**; this reproduced the pin-selector collision, while all nine mobile
cases passed. Those are observed flakes, not fixed bugs.

First-phase `603703d` complete run: **61 unit passed; 239 browser passed, 2
failed**, both original 390px/1280px preview assertions. This is historical
baseline evidence, **not** a claim that the revised defaults pass browsers.

### Revised defaults verification

- Fresh `npm ci`: passed; dependency versions/peer tree verified again.
- `npm run lint`: **FAILS, exactly 45 exposed React diagnostics** above. No other
  rules, compiler errors or unused-disable diagnostics remain at this point.
- Existing `npm run typecheck`, build, both Knip modes: passed. Normal Knip keeps
  the existing redundant-server-entry hint.
- Both direct `tsrs --noEmit -p` commands: passed.
- Final unit suite: **69 passed in 10 files**, including six new boundary/MIME
  cases and two test-wire-evidence regressions.
- Temporary client/server/.test.ts probes detected TS2322 invalid assignments,
  TS7006 implicit any, NodeNext **TS2835**, floating/misused promises, JSX void
  callbacks, await-thenable and test unbound methods. Probes were removed; the
  root diagnostic set returned to exactly the 45 known React findings.
- Latest complete **`npm test`**: **69 unit tests passed; 242 browser tests
  passed, 2 failed** (7.3 minutes for browsers, all 244 cases completed). Both
  failures are the same baseline preview expectations, now
  `tests/e2e/app.spec.ts:1186` (390px/1280px). Assertions still expect complete
  text where the documented overview mounts a bounded excerpt. They were not
  weakened. **The full suite is not green.** This supersedes the earlier revised
  run with 240 passes / 2 failures before the two extra lifecycle cases existed.
- Additional serial one-worker lifecycle run, each case repeated three times:
  **6 passed**. This verifies changed drag callbacks during refresh and microphone
  permission resolving after a committed lock. Both cases also pass in the
  latest full run, as does the malformed-redirect checkpoint regression.
- Loading-preview verification passed after the browser runs, including layout,
  interruption, reduced motion and no browser errors. Final typecheck, both Knip
  modes, 69 unit tests and `git diff --check` passed again.
- Two isolated read-only Pi reviewers examined the revised source through
  `d46a047`: no confirmed introduced bugs or documented-standard violations.
  Standards identified missing targeted lifecycle regression coverage; the two
  cases above were added and repeated successfully. They do not simulate every
  abandoned concurrent render; that remains part of the explicit redesign gate.
  Standards also noted that test-owned Window declarations assume individual
  tests install their hooks before use. This is not runtime initialization or a
  production guarantee; review found no introduced use-before-install.
  Supplemental isolated review of `0d72cb4` found no confirmed bugs and verified
  the tests meaningfully cover those committed transitions. A separate review of
  `dbc4054` confirmed preservation of raw wire-equality evidence; future shared
  schema evolution may require corresponding fixture updates. The final mechanical
  Error-constructor cleanup followed the full run; isolated review of `68a76af`
  found no issues. Real Node identity, 69 unit passes, typecheck/build and nine
  focused conflict/audio/lifecycle browser passes verify that final cleanup.
  Reviewers did not rerun checks, and no human approval or merge is claimed.
- Audit high-severity gate passed; the same **4 moderate** glob/minimatch/PWA
  chain findings remain. No forced audit fix or unrelated dependency upgrade.

Browser runs, preview verification and builds are serialized, using normal
isolated local test servers/data, not a deployment. Diagnostic logs are under
`/tmp/shelf-cf-defaults-*.log` in the implementation environment.

## Diff size and lint runtime

Revised direction versus `603703d`: **87 files, +1,848/-1,374 lines**. Complete PR versus main `8560f06`: **92 files, +3,144/-1,114 lines**.

Mechanical style changes account for much of the breadth: the braces commit
alone touched 59 files (+447/-449 including its config change); array/import
fixes also touch many of those files. That churn is implemented, not excluded.
The full PR includes the original preset/plugin dependency lockfile addition.
The exact complete file list follows below.

Seven interleaved warm **`npm run lint`** samples per setup, one discarded warm-up
each, including npm startup, same Node/npm/shared host/default threads:

| Setup | Seven measured seconds | Median | Exit |
| --- | --- | ---: | ---: |
| Original main `8560f06`, original config/backend | 1.018, 1.211, 1.156, 1.073, 1.084, 1.259, 0.996 | **1.084s** | 0 |
| Prior curated `603703d` | 1.627, 2.010, 1.721, 1.572, 1.869, 1.725, 1.676 | **1.721s** | 0 |
| Implemented stock defaults | 1.578, 2.153, 1.698, 1.617, 1.599, 1.451, 1.573 | **1.599s** | **1** |

Stock-default median adds **0.515s (~48%)** versus original main. The 0.122s
curated/default difference is within shared-host noise, not evidence of a
speedup. Defaults still report the 45 React errors: this is **not a passing
benchmark** or a final lint-clean runtime prediction.

Sources/configs were separate `git archive` snapshots with unchanged dependencies
symlinked from the task installation. Original Oxlint/tsrs were separately
installed at their exact pins; observed native child paths verified the original
backend really ran from that installation, not the task's newer tsrs. Original
and curated lint commands passed; default exit 1 was checked on every sample.
The added unit regression used for the original-MIME red check was removed from
that snapshot before timing, preserving the original file set.

Runs were serial after browser/build/reviewer activity finished, with ordering
varied to reduce warm-cache/order bias. No debug timing instrumentation. Other
host tenants remain uncontrolled. This measures total configurations/toolchains
and their source sets (97 / 99 / 102 files), **not** an isolated backend switch or
individual rule. Scratch snapshots/installations were removed afterwards. There
is **no backend speedup claim**, and no tsc/build check was replaced.

## Exact changed files (complete PR versus main)

.oxlintrc.json is deleted; the config, report and new test/helper files are added.
Other listed paths are modified. No tsconfig or deployment file changed.

```text
.oxlintrc.json
README.md
docs/cloudflare-oxlint-audit.md
docs/oxlint-audit.md
docs/previews/loading/verify.mjs
knip.jsonc
oxlint.config.ts
package-lock.json
package.json
src/client/App.tsx
src/client/api.ts
src/client/app.stylex.ts
src/client/audio.ts
src/client/checkpoint-writer.ts
src/client/components/AddAudio.tsx
src/client/components/AudioPlayer.tsx
src/client/components/AudioRecorder.tsx
src/client/components/Auth.tsx
src/client/components/Editor.tsx
src/client/components/ImageMosaic.tsx
src/client/components/LinkedText.tsx
src/client/components/LoadingBrand.tsx
src/client/components/NoteBoard.tsx
src/client/components/NoteContextMenu.tsx
src/client/components/NoteReading.tsx
src/client/components/Photo.tsx
src/client/components/RichTextEditor.tsx
src/client/components/link-parts.ts
src/client/incoming-share.ts
src/client/local-store.ts
src/client/main.tsx
src/client/note-excerpt.ts
src/client/note-preparation.ts
src/client/note-scheduling.ts
src/client/prepared-documents.ts
src/client/rich-text.ts
src/client/sw.ts
src/client/visual-media.ts
src/server/app.ts
src/server/audio-files.ts
src/server/auth.ts
src/server/database.ts
src/server/index.ts
src/server/logging.ts
src/server/note-uploads.ts
src/server/video-files.ts
src/shared/contracts.ts
tests/e2e/app.spec.ts
tests/e2e/async-callbacks.spec.ts
tests/e2e/audio-conflicts.spec.ts
tests/e2e/audio-error-layout.spec.ts
tests/e2e/audio.spec.ts
tests/e2e/autosave-conflicts.spec.ts
tests/e2e/board-previews.spec.ts
tests/e2e/default-lifecycle.spec.ts
tests/e2e/diagnostics-cleanup.spec.ts
tests/e2e/dialog-cleanup.spec.ts
tests/e2e/drag-stuck.spec.ts
tests/e2e/editor-colors.spec.ts
tests/e2e/editor-focus-frame.spec.ts
tests/e2e/editor-spellcheck.spec.ts
tests/e2e/empty-notes.spec.ts
tests/e2e/image-rotation.spec.ts
tests/e2e/loading.spec.ts
tests/e2e/local-store-atomicity.spec.ts
tests/e2e/local-store-autosave.spec.ts
tests/e2e/lucide-icons.spec.ts
tests/e2e/mobile-editor-keyboard.spec.ts
tests/e2e/note-autosave.spec.ts
tests/e2e/note-context-color.spec.ts
tests/e2e/note-opening.spec.ts
tests/e2e/note-save-recovery.spec.ts
tests/e2e/ready-note-dialog.spec.ts
tests/e2e/rich-text-safety.spec.ts
tests/e2e/rich-text.spec.ts
tests/e2e/sync-delete-race.spec.ts
tests/e2e/sync-errors.spec.ts
tests/e2e/sync-indicators.spec.ts
tests/e2e/sync-layout.spec.ts
tests/e2e/sync-text-race.spec.ts
tests/e2e/video.spec.ts
tests/fixtures/audio-ui.ts
tests/fixtures/audio.ts
tests/fixtures/isolated-test.ts
tests/fixtures/note-responses.ts
tests/unit/api.test.ts
tests/unit/audio.test.ts
tests/unit/checkpoint-writer.test.ts
tests/unit/database.test.ts
tests/unit/logging.test.ts
tests/unit/prepared-documents.test.ts
tests/unit/video.test.ts
```

## Sources and delivery

- [Official preset README](https://github.com/cloudflare/oxlint-config)
- [Complete migration guidance](https://github.com/cloudflare/oxlint-config/blob/main/skills/migrate-oxlint-config/SKILL.md)
- Installed 0.1.0 preset / 3.0.0 nkzw source, manifests and npm metadata.
- [Original PR93 setup](oxlint-audit.md), retained as historical evidence.
- [Draft PR #94](https://github.com/cbussick/shelf/pull/94).

Repository workflow and official guidance were reread before the continuation.
No GLOSSARY-MAP.md or GLOSSARY.md is present. Existing worktrees/edits were
inspected and preserved. The task branch/worktree remain intact for the requested
redesign decision and review; **no merge, deployment or main push occurred**.
