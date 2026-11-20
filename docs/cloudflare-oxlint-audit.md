# Cloudflare preset defaults: implementation and local validation report

## Current status: lint-clean; full test suite still has baseline failures

PR #94 now evaluates **stock `@cloudflare/oxlint-config` defaults**, superseding
the curated-policy recommendation at commit `603703d`. Mechanical changes were
explicitly authorized. Every migration-added global/file rule exclusion and
relaxed option has been removed. `oxlint.config.ts` contains the preset plus
stronger pre-existing Shelf coverage, not a collection of convenience disables.

The user subsequently authorized the React lifecycle redesign **locally**.
All 45 previously exposed React diagnostics are resolved without new suppressions.
Root lint passes with the actual defaults, stronger PR93 checks and unused-disable
reporting. This supersedes the partial report at `31216c9`.

**Recommendation:** default compliance is now implemented, including the larger
state-ownership work. That work was materially more involved than mechanical
style compliance. The full suite is still **not green**: two unchanged preview
assertions fail on both the migration and freshly installed original main. The
latest repeat also hit a mobile title-entry failure reproduced on original main
in 2/10 serial repetitions; its root cause is not claimed fixed.
Do not represent those failures as fixed or treat local completion as permission
to integrate.

The continuation is local-only: **no pushes, PR updates/comments/reviews, merges,
deployments or main edits**. PR94 remains untouched by this continuation.
`chore/cloudflare-oxlint` and `.worktrees/cloudflare-oxlint` remain intact;
primary main stays separate at `8560f0612cb6feb1f730d3906859dbf71a863679`.

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
  commands unchanged. Final traversal is **106 files**, versus original 97.
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
| `react/refs` | 39 | Commit-time callback publication, explicit workspace/editor lifecycle state, admitted draft/file identities and subscribed checkpoint snapshots remove all render-time ref access. |
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
| `react/set-state-in-effect` | 6 | Derived metadata/state transitions, event-owned editor resets and real durable-storage I/O completions replace effect-driven cascades; no artificial scheduling. |
| `quality/no-unsafe-dictionary-type` | 6 | Concrete log shapes and explicit viewport reflection; privacy tests preserve every extra log property. |
| `eqeqeq` | 6 | Stock strict equality, explicitly preserving both null and undefined cases for task attributes. |
| `unicorn/consistent-function-scoping` | 6 | Pure helpers hoisted; two browser-serialization helpers have exact line exceptions. |
| `react/rules-of-hooks` | 5 | Playwright positional fixture callback renamed `provide`; no hook exclusion. |
| `unicorn/numeric-separators-style` | 3 | Preset grouping applied. |
| `no-console` | 2 | Verification CLI explicitly writes the same newline-terminated stdout output. |
| `react/button-has-type` | 2 | Button types moved out of shared spread props to the two JSX sites. |
| `quality/no-unknown-returns` | 2 | Native IDB reader contract and actual Express response/void callback type. Raw metadata is parsed, not falsely asserted. |
| `react/immutability` | 2 | Only the checkpoint module owns mutations; renderers read frozen snapshots through useSyncExternalStore, never mutable controller fields. |

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

## Implemented React lifecycle redesign

- **Workspace access:** `workspace-access.ts` models gate/open/locked transitions.
  Verified offline access opens the workspace; later network failures cannot
  unmount it. Confirmed expiry locks it, and cached auth data cannot unlock it.
  Successful explicit authentication unlocks; late expiry after logout cannot
  reopen a workspace. Four unit cases cover these transition groups.
- **Editor ownership:** `editor-lifecycle.ts` owns admission, warming, closing,
  preference and parked-snapshot invalidation. Draft keys are allocated at user
  intent, not during render. Full note/attachment/blob/version identities still
  govern reuse. Reconciliation never replaces a live editor's base snapshot.
  Stale close/save/warm events cannot take ownership of a different editor.
  Five unit cases cover identity, retention, version isolation and stale events.
- **Sync entry:** editor status resets occur at open/close/delete events. The
  network lock guard is published in layout, never by a speculative render.
  Entry/re-entry first reads real durable local notes and queue state, then
  starts synchronization. A read-generation fence prevents that initial read
  from overwriting a later local commit. Network/visibility subscriptions are
  removed while locked; unlocking re-reads durable state. This intentionally replaces the former
  parallel effect-driven startup with storage-first startup, not a dummy await.
- **Checkpoint ownership:** `CheckpointWriter` publishes stable frozen status
  snapshots and subscriptions. Saved key and resulting note/version publish
  atomically. React consumes them with `useSyncExternalStore`; only the writer
  changes them. Input readers and write handlers bind after commit; native body
  reads occur during schedule/flush, not render. The 500ms debounce, 2500ms bound,
  serialized writes, latest-input loop, retry and deletion fence remain covered.
  Five additional unit cases cover immutability/subscription, native-source
  replacement, version handoff, capture failure recovery and reentrant flush.
  The existing promise-assignment fence remains for real reentrancy safety,
  not to defer React state setters past lint analysis.
- **Upload identities:** file IDs are admitted during initialization/input events,
  then rendered as immutable entries; a private WeakMap preserves same-file
  identity without retaining removed files. Session IDs are lazy scalar state.
- **Live reader safety:** the new auth regression exposed history reset on
  unlock: restarting a live ProseMirror document changes its reader baseline,
  which can return the original empty Markdown despite the edited DOM. History
  now resets only when actually reopening a pristine parked editor. Unlocking
  preserves the live reader/history and exact saved Markdown. A consumed initial
  recording intent also stays consumed after lock/unlock rather than reopening.
- **Audio ownership:** source availability is render state; refs only coalesce
  imperative loading and own native resources. A failed local-byte lookup clears
  availability and can retry restored bytes. A successfully obtained remote URL
  remains available after native HTTP failure and retries via media.load().
  Duration transitions preserve recording fallback, finite decoded measurements
  and actual metadata changes without an effect-driven setter. Two new unit
  cases and two browser cases cover these distinctions and unrelated saves.

Three new browser regressions exercise consumed recording intent plus same-DOM
reauthentication/persisted body, cached media URL retry/decoded-duration retention,
and missing/restored local audio bytes. Each passed twice serially and in the
complete run. No microtask workaround, broad exclusion or weakened assertion was
used. Arbitrary abandoned concurrent renders are not exhaustively simulated.

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
  - `src/client/components/Editor.tsx:249,255,333,352,390`: captured Element, editing HTMLElement, outside-click Node, active HTMLElement, native HTMLVideoElement arrow-key ownership.
  - `src/client/App.tsx:269,275`: native HTMLElement keyboard targets.
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

### Local completion verification

- Fresh `npm ci`, actual-default root lint with unused-disable reporting,
  existing typecheck/build, both Knip modes and both direct tsrs compilations:
  **pass**. Normal Knip retains its existing redundant-server-entry hint.
- Unit suite: **85 passed in 12 files** (69 at the prior partial tip).
- Fresh temporary client/server/test probes again detected **TS2322, TS7006,
  TS2835**, floating/misused promises including JSX, await-thenable and test
  unbound methods. They were removed; root lint returned to **zero diagnostics**.
- Complete **`npm test`** through source `a946f6f`: **85 units passed;
  245 browsers passed, 2 failed**, all 247 cases, 7.4 minutes. Both failures are
  `app.spec.ts:1186`, the unchanged 390px/1280px preview-text expectations.
  Fresh original-main archive `8560f06` with its own `npm ci` reproduces both
  failures at `app.spec.ts:1181`; a fresh `31216c9` archive also reproduces both.
  They expect full text where the documented UI mounts a bounded excerpt.
  **The full suite is not green. No assertion was relaxed.**
- Latest full repeat at `7b7cdd5`, after the clock-test correction: **85 units
  passed; 244 browsers passed, 3 failed**, all 247 cases, 7.3 minutes. Besides
  those two preview failures, `app.spec.ts:1075` at 390px could not find `Tall note 8`;
  the card had its body but an empty title. Fresh original-main repetition of
  the unchanged case (`app.spec.ts:1070`) produced **8 passes / 2 failures in 10**,
  with the same missing-title symptom. This establishes an inherited intermittent
  failure, not its exact cause. Assertions/timeouts and production code were not
  changed to hide it. Both full-run outcomes are reported, not cherry-picked.
- An earlier 34-case focused run had **33 passes / 1 unfinished-dialog failure**;
  three immediate repetitions passed. A later ten-repeat loop reproduced it
  once. Probes showed Playwright clock installation replaces the init-script
  idle stub, allowing preparation before the intended uninitialized close.
  A forced refresh/time-window reproduction failed on both `31216c9` and the
  candidate. The test now reapplies the idle stub after clock installation and
  adds two uninitialized preconditions. Original cleanup/body/version assertions
  remain. The forced reproduction passes; the complete ready-dialog file then
  passed **24/24** serial cases. All debug hooks and artificial probe waits were
  removed. This is a test-precondition correction, not a runtime cleanup fix.
- Initial new-regression runs exposed the live-reader reset described above.
  A preliminary audio assertion incorrectly treated a native HTTP failure as
  failed URL acquisition; inspecting the actual audioSource contract separated
  remote-URL retry from real local-byte acquisition failure. The final distinct
  cases verify both contracts rather than imposing a changed runtime behavior.
- Loading-preview verification passes for layout, fast completion, interruption,
  replay, reduced-motion toggle/OS preference and browser errors.
- Audit high-severity gate passes; **4 existing moderate** glob/minimatch/PWA
  findings remain. No force upgrade or unrelated production dependency change.

Two fresh isolated read-only Pi processes reviewed the **complete 96-file,
77-commit migration**, independently covering standards/spec/coverage and behavior.
Both reported **zero blockers** against base
`8560f0612cb6feb1f730d3906859dbf71a863679`, tip
`7b7cdd5505ae6a157da9dfb57b863aedcb19eeb4`. One optional naming judgement noted
that the image-upload fixture uses ReturnType of audioFile for their shared
payload shape; no standard violation or runtime defect was identified. Reviewers
ran no checks and changed no files. This evidence-only report refresh follows
that comparison; final follow-up comparison pins/results are in the local handoff.
No human approval or remote PR review is claimed. Historical reviews through
`68a76af` are not substitutes for these fresh reviews. Test-owned Window hooks
still require each test to install its hook before use.

Builds, tests and previews are serialized. Baselines use disposable archives,
not the primary checkout. Current logs are `/tmp/shelf-cf-local-*`; older phase
logs are `/tmp/shelf-cf-defaults-*`. No production application data or deployment was used.

## Diff size and lint runtime

Complete migration versus main `8560f06`: **96 files, +3,833/-1,250 lines**.
Local completion versus `31216c9`: **15 files, +841/-288 lines**.
The precise changed-file list below includes all four new lifecycle source/test files.

Mechanical style changes account for much of the breadth: the braces commit
alone touched 59 files (+447/-449 including its config change); array/import
fixes also touch many of those files. That churn is implemented, not excluded.
The full PR includes the original preset/plugin dependency lockfile addition.
The exact complete file list follows below.

### Passing lint benchmark

Two discarded warm-ups, then seven interleaved samples per setup, alternating
order, same host/Node/default threads. Command in each installation:
`./node_modules/.bin/oxlint --deny-warnings --report-unused-disable-directives`.
This measures the lint executable directly, **excluding npm startup**.

| Setup | Seven measured seconds | Median | Exit |
| --- | --- | ---: | ---: |
| Fresh original main `8560f06`, original config/backend | 0.840, 0.837, 0.928, 0.824, 0.811, 0.934, 1.118 | **0.840s** | 0 every run |
| Lint-clean stock defaults through `a946f6f` | 1.308, 1.235, 1.543, 1.308, 1.411, 1.315, 2.129 | **1.315s** | 0 every run |

The passing-default median adds **0.475s (~57%)**. Original main has its own fresh
installation and original tsrs pin; the task has its own fresh migration install.
This compares complete configurations/toolchains/source sets (**97 / 106 files**),
not an isolated backend or rule change. Browser/build/reviewer work was not running
during measurement. Shared-host load and outliers remain uncontrolled; seven warm
samples are not a formal performance study. No backend speedup is claimed.

Historical npm-inclusive medians were main 1.084s, curated `603703d` 1.721s and
partial defaults 1.599s. That last result exited 1 on 45 React findings and was
**not** a passing benchmark. Those differently scoped numbers are not directly
comparable to the new executable-only passing measurement. No tsc/build coverage
was replaced to obtain these timings.

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
src/client/editor-lifecycle.ts
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
src/client/workspace-access.ts
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
tests/unit/editor-lifecycle.test.ts
tests/unit/logging.test.ts
tests/unit/prepared-documents.test.ts
tests/unit/video.test.ts
tests/unit/workspace-access.test.ts
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
local review and handoff; **no push, PR operation, merge, deployment or main edit occurred during this continuation**.
