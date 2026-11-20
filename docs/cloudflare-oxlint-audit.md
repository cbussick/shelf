# Cloudflare Oxlint preset migration

## Recommendation

**Worth adopting as a curated common base, not as an unmodified policy.** The
preset adds explicit correctness, React hooks, focused-test, import and unsafe
boundary checks. It found a real dialog-cleanup issue with a small regression
fix. Its defaults also produced considerable noise in this established codebase:
1,003 diagnostics across 35 newly failing rules, including 562 brace/array-style
findings. Blind compliance would have meant unrelated rewrites of the editor,
SQLite/IDB adapters and browser fault-injection tests.

Five purely stylistic rules remain off project-wide. Other exceptions are
file-scoped, module-specific options, or explained line suppressions. This is
not a complete safety audit of every assertion or `any` boundary; excluded files
can still acquire new instances of their excluded rules. A future adapter audit
could reduce these exceptions, but should not be disguised as lint migration.
The preset also adds JavaScript plugins and their dependency/maintenance cost.
It provides no measured backend speedup and does not replace either tsc check.

## Baseline, package compatibility and configuration

Started from clean, updated `main` **8560f06** (merged PR93), in dedicated
`.worktrees/cloudflare-oxlint`, branch `chore/cloudflare-oxlint`. The primary
checkout and unrelated worktrees were not changed. No GLOSSARY-MAP.md or
GLOSSARY.md exists. Read AGENTS.md, CLAUDE.md, the development workflow, README,
Knip/Oxlint audits, and the official preset README and complete migration skill.

Validated on Node **24.22.1**, npm **11.19.1**, Linux x64:

| Package | Before | After |
| --- | --- | --- |
| `@cloudflare/oxlint-config` | absent | **0.1.0**, exact pin |
| `@nkzw/oxlint-config` | absent | **3.0.0**, preset's exact dependency |
| `oxlint` | **1.94.0** | **1.94.0**, unchanged exact pin |
| `tsrs` | **7.1.0-beta.tsrs3** | **0.25.0-ts7.1.0-beta**, exact pin |
| `typescript` | **5.9.3** | **5.9.3**, unchanged |

Verified npm metadata, installed manifests, lockfile and `npm ls`, not just
semver ordering. Preset 0.1.0 peers are `oxlint: ^1.94.0` and
`tsrs: >=0.25.0-ts7.1.0-beta`; its Node range is `^22.18.0 || >=24.0.0`.
The old tsrs version's unusual numbering is not evidence of compatibility.
Installed the README's **exact** tsrs release, without force, overrides or legacy
peer resolution. `tsrs --version` reports TypeScript 7.1.0-beta, tsrs
0.25.0-ts7.1.0-beta, upstream compiler commit **3e9236361fa9** (the same compiler
commit reported by PR93's backend). Actual lint, probes and direct compiler
runs validate runtime compatibility. Fresh `npm ci` and `npm ls` pass with no
invalid peer tree. The lockfile adds 79 installed packages (including plugin
peers); no unrelated production dependency upgrade was requested.

`oxlint.config.ts` replaces `.oxlintrc.json`, spreading the preset at the root
so environments and plugin configuration are preserved. Inherited rule and
override fields are spread before Shelf's settings. The existing lint script
still fails warnings and unused disable directives. There is no existing CI
workflow to modify.

### Retained PR93 coverage

- Root `options.typeAware: true` **and** `options.typeCheck: true`, including
  editor/config consumers; these are not merely CLI flags.
- Strict floating-promise/misused-promise checks, including void callbacks and
  JSX attributes. No React async-handler blanket exception. Strict
  await-thenable options retained rather than inherited mixed-array relaxation.
- The 24 explicit correctness rules absent from the preset are listed in the
  config, including no-base-to-string, restrict-template-expressions,
  no-unnecessary-await, and the Oxc/unicorn checks.
- Fifteen original syntax checks that the preset disables for TypeScript are
  explicitly restored after inherited overrides. Unbound-method remains on in
  tests, preserving their explained fault-injection line suppressions.
- Original ignore patterns; no application/test files excluded from traversal.
- `src/server/tsconfig.json` discovery shim, NodeNext settings, both existing tsc
  commands, TypeScript version and Vite/server build scripts remain unchanged.
- Existing empty Playwright fixture, unbound prototype-method and live DOM
  attribute snapshot suppressions remain intact and lint still checks their use.
- Knip now discovers tsrs through preset peer dependencies: removed the formerly
  necessary `ignoreDependencies: ["tsrs"]` exception. Both modes remain enabled.

Temporary client, server and test probes failed lint with floating promises and
TS2322 invalid assignments. Client/test probes also triggered await-thenable and
misused async void callbacks; client JSX did too. Client/server implicit-any
parameters produced TS7006. The server extensionless import produced **TS2835**,
and null-to-string assignment failed. A second probe with a matching `.test.ts`
filename also verified floating/misused promises, await-thenable, invalid assignment
and **unbound-method**, despite the preset's test relaxations. All probes were
removed; clean lint passed.

## Staged migration and complete rule inventory

The first commit adopts dependencies/config with every newly failing rule
temporarily disabled. It passes lint. Each of the following **35 commits**
evaluates one rule: fixes/enables it, narrows its options, or replaces the
temporary disable with a documented exception. Lint passed for each decision.
All commits stay separate for one migration PR; do not merge/deploy without
fresh authorization.

Counts below are diagnostics in the initial preset trial (98 traversed files,
including the new config), **not distinct bugs**. TypeScript test relaxations
inherited from Cloudflare remain except Shelf's stricter unbound-method check.
Exact exception globs and rationale live beside each rule in `oxlint.config.ts`.

| Rule | Findings | Decision and reason |
| --- | ---: | --- |
| `curly` | 445 | Off: existing compact guards/loops; avoid brace-only migration. Even multiline-only mode required 11 unrelated changes. |
| `typescript/array-type` | 117 | Off: allow both `T[]` and `Array<T>`, no annotation rewrite. |
| `typescript/no-unsafe-type-assertion` | 85 | Only existing SQLite/Multer, DOM, IDB and test adapter files exempt; keep schema/runtime validation rather than claim trusted bytes through invented types. |
| `import/consistent-type-specifier-style` | 44 | Off: explicit inline `type` in mixed imports is already readable and erased correctly. |
| `typescript/no-non-null-assertion` | 39 | Only existing editor/schema/cache/storage invariant modules exempt; config uses `?? []`. Do not silently skip required work with optional chaining. |
| `react/refs` | 39 | Five imperative editor/recorder/auth components exempt; preserve checkpoint/latest-callback protocols. Not React-Compiler optimized. |
| `typescript/no-unnecessary-type-assertion` | 33 | Existing schema and selected browser invariant assertions retained; inferred test programs do not model all nullability. |
| `typescript/no-unsafe-call` | 27 | Eight test files inspecting untyped API/IDB payloads exempt; app code checked. |
| `quality/no-chained-type-assertions` | 25 | Worker DOM-lib bridge and eight browser fault-injection files exempt; other source checked. |
| `import/no-namespace` | 14 | Enabled, only `@stylexjs/stylex` module exempt (compiler-recognized namespace convention). |
| `@nkzw/no-instanceof` | 13 | Existing DOM/File and trusted error identity sites exempt by file; duck typing would weaken correct runtime guards. |
| `typescript/no-unsafe-assignment` | 11 | IDB/ProseMirror/Express adapter modules exempt; IDB values are validated after retrieval, not falsely declared trusted on read. |
| `typescript/no-unsafe-return` | 11 | ProseMirror's any-returning serializer and four raw-payload test files exempt. |
| `quality/no-known-value-widening` | 10 | Four modules exempt: intentional open lookup dictionaries, log metadata and stable explicit return unions. |
| `unicorn/catch-error-name` | 10 | Off: `caught` deliberately distinguishes exception from UI error state. |
| `quality/no-conditional-empty-object-spread` | 8 | Four metadata/browser-option modules exempt: conditional omission is intentional, not a behavioral problem. |
| `typescript/consistent-type-imports` | 7 | Enabled, `disallowTypeAnnotations: false` for browser `import()` type references; type-only imports still enforced. |
| `no-promise-executor-return` | 7 | Enabled with default options; seven callback wrappers now use block executors, retaining callback settlement and side effects. |
| `quality/no-unsafe-dictionary-type` | 6 | Sanitized log dictionaries and readonly viewport fault-injection files exempt; unknown is intentional at these boundaries. |
| `eqeqeq` | 6 | Enabled except `null: 'ignore'`: `== null` deliberately covers null and undefined task attributes; other equality remains strict. |
| `react/set-state-in-effect` | 6 | Three external audio/dialog/auth/sync lifecycle modules exempt; no reordering of tested lifecycle work. |
| `unicorn/consistent-function-scoping` | 6 | Five browser-serialization/memo/test-helper files exempt; hoisting can break evaluate() serialization or locality. |
| `react/rules-of-hooks` | 5 | Enabled except two Playwright fixture files where callback `use()` is not React.use. |
| `typescript/no-unsafe-member-access` | 4 | Enabled; three explained line suppressions for Multer payload field, string-guarded Express route and exact worker control token (route emits two diagnostics). |
| `typescript/use-unknown-in-catch-callback-variable` | 4 | Enabled; four promise catch parameters explicitly `unknown`, retaining safeError()/rethrow behavior. |
| `unicorn/numeric-separators-style` | 3 | Off: grouping sample-rate/byte constants is not a correctness check. |
| `typescript/no-unsafe-argument` | 3 | Enabled; line suppressions for Workbox injected manifest, ProseMirror-owned toJSON() and installed link-schema href. |
| `react/exhaustive-deps` | 2 | Enabled; cleanup captures the mounted dialog instead of reading a ref React clears on unmount. New browser regression fails without fix. |
| `typescript/no-import-type-side-effects` | 2 | Enabled; two all-type Playwright imports changed to `import type`. Mixed inline type imports remain supported. |
| `no-console` | 2 | Enabled except standalone loading-verification CLI's result output. |
| `react/immutability` | 2 | Editor's mutable CheckpointWriter external controller exempt, not a mutation of React state. |
| `react/button-has-type` | 2 | NoteBoard exempt: both flagged buttons already spread `type: 'button' as const`. No redundant prop or behavior change. |
| `quality/no-unknown-returns` | 2 | IDB unknown-input and Express ignored-return adapter contracts retained in two files. |
| `unicorn/prefer-number-properties` | 2 | Enabled; two browser assertions use equivalent `Number.parseFloat`. Assertions unchanged. |
| `@nkzw/require-use-effect-arguments` | 1 | Enabled; one explained line exception: document drag listeners intentionally rebind each commit with current closures. |

All other inherited rules stay enabled. Some unsafe-any rules were already
relaxed for tests by the preset; those are not claimed as newly enforced test
coverage. This migration does not change runtime validation, SQL, uploads,
promise rejection handling, note serialization, or application layout policy.

### Genuine small fix: effect-owned dialog cleanup

`AudioRecorder` and image preview cleanup read `dialog.current` after React could
clear it on unmount, leaving the detached node's `open` attribute set. Capture
the mounted element inside the effect, then close that owned element in cleanup.
The recorder's media refs deliberately remain live, so cleanup still stops the
latest recording/stream rather than an obsolete initial snapshot.

New `tests/e2e/dialog-cleanup.spec.ts` retains the dialog node, closes the recorder,
asserts unmount, then checks the node is no longer open. It passed with the fix.
Temporarily restoring the original recorder cleanup made it fail at that exact
last assertion (`expected false, received true`); the fix was restored. This
regression is included in the rule's commit. No timeout or assertion weakened.

## Validation

Baseline (before changing application/test code):

- Fresh `npm ci`, original lint/typecheck and all **61 unit tests** passed.
- Full original browser run: **237 passed, 3 failed**, 8.1 minutes. Preview-text
  assertions failed at both 390px/1280px; a Chromium 320px mobile-editor test
  inserted `!` inside rather than at the end of the expected line.
- Serial focused baseline rerun of create/edit/pin and mobile editor cases,
  `--repeat-each=3 --workers=1`: **11 passed, 1 failed**. Failure is the known
  strict-selector collision between editor and board pin buttons. All nine
  mobile cases passed in that rerun. These are fresh baseline observations,
  not assumptions carried forward from the earlier audit.

Migration validation:

- Fresh **`npm ci`**: passed with new lockfile; npm peer tree valid.
- **Lint, typecheck, both Knip modes, 61 unit tests**: passed. Normal Knip retains
  its existing redundant-server-entry hint, not an unused dependency finding.
- Both direct **`tsrs --noEmit -p`** commands passed for client and server configs.
- Temporary type-aware/NodeNext safety probes: failed as expected, removed;
  clean lint passed again.
- Browser regression red/green: verified as described above.
- Complete final **`npm test`**: **61 unit tests passed; 239 browser tests passed,
  2 failed**, 7.6 minutes for browsers. Both failures are the same original
  `tests/e2e/app.spec.ts:1181` 390px/1280px preview assertions at line 1196:
  they expect the full text while the documented UI mounts a bounded excerpt.
  These assertions and the preview policy are unchanged. This is **not a green
  full suite**. Baseline mobile cursor-placement and pin-selector flakes passed
  in this run; their disappearance does not prove they are fixed.
- **`npm run build`** and **`node docs/previews/loading/verify.mjs`**: passed after
  the full browser run, without overlapping artifact writers.
- Final lint/typecheck/both Knip modes and **`git diff --check`**: passed.
  Final lint traversal is 99 files (original 97 plus config and regression test).
- Two isolated read-only Pi reviewers completed Standards and Spec reviews of
  `8560f06...703654e`: no blocking findings on either axis. Standards noted only
  pre-existing duplicated clipboard conversion code, deliberately not refactored.
  Reviewers did not rerun checks. Final evidence-only report updates follow review.
- Audit high-severity gate passed; **4 existing moderate** glob/minimatch/
  workbox/PWA-chain findings remain. No force fix or unrelated upgrade.

Browser runs are serialized: no overlapping Playwright processes, preview
verification or builds use the same artifacts. Tests use their normal isolated
local servers/data, not a live deployment. Baseline/final logs are retained in
`/tmp/shelf-cf-*.log` in the implementation environment; these are not shipped.

## Added lint cost

Seven alternating pairs of **`npm run lint`**, one discarded warm-up per setup,
wall-clock seconds including npm startup, same Node/npm/host and default threads:

| Setup | Seven measured runs (s) | Median |
| --- | --- | ---: |
| Original main config/source + Oxlint 1.94.0 + tsrs 7.1.0-beta.tsrs3 | 1.227, 1.223, 1.290, 1.151, 1.185, 1.156, 1.331 | **1.223 s** |
| Migrated config/source + Oxlint 1.94.0 + tsrs 0.25.0-ts7.1.0-beta | 1.881, 2.226, 1.799, 1.732, 1.717, 1.812, 1.919 | **1.812 s** |

Median added cost: **0.589 s (~48%)**. This measures the complete migration,
including the extra config/test files and JavaScript plugins, **not an isolated
backend or individual-rule benchmark**. Original source/config came from a
`git archive 8560f06` temporary snapshot; original lint tools were installed
separately with their exact pins. Other unchanged dependencies were symlinked
from the task installation. Both complete lint commands passed. Observed child
process paths verified original tsrs really ran from the separate installation,
rather than accidentally discovering the task's newer backend. Snapshot/tool
scratch directories were removed afterwards, not retained as extra worktrees.

Measurements ran serially after all browser/build/review work finished; ordering
alternated to reduce warm-cache/order bias. Other tenants still share this host,
so these are indicative warm-run costs, not an isolated performance guarantee.
No debug timing instrumentation was enabled. There is **no backend speedup
claim**; tsc/build remain necessary and unchanged. The added sub-second median
cost is reasonable for the retained additional checks; maintainers should also
weigh the 79 added installed packages and explicit exception maintenance.

## Exact changed files

- Configuration/dependencies: delete `.oxlintrc.json`; add `oxlint.config.ts`;
  update `package.json`, `package-lock.json`, `knip.jsonc`.
- Documentation: `README.md`, `docs/oxlint-audit.md`; add this
  `docs/cloudflare-oxlint-audit.md`.
- Catch typing: `src/client/components/AudioPlayer.tsx`, `src/server/app.ts`,
  `src/server/note-uploads.ts` (the latter two also have boundary/wrapper changes).
- Dialog cleanup: `src/client/components/AudioRecorder.tsx`,
  `src/client/components/Editor.tsx`; add `tests/e2e/dialog-cleanup.spec.ts`.
- Explained line suppressions: `src/client/components/NoteBoard.tsx`,
  `src/client/components/RichTextEditor.tsx`, `src/client/rich-text.ts`,
  `src/client/sw.ts`, `src/server/logging.ts`, and the `app.ts` noted above.
- Mechanical callback/import/Number-helper fixes: `docs/previews/loading/verify.mjs`,
  `tests/fixtures/isolated-test.ts`, `tests/e2e/app.spec.ts`,
  `tests/e2e/note-opening.spec.ts`, `tests/e2e/note-context-color.spec.ts`,
  `tests/e2e/note-save-recovery.spec.ts`, and `note-uploads.ts` noted above.

No `tsconfig`, build script, production dependency version, deployment, test
expectation or existing safety-regression assertion changed. The task branch
and worktree are retained for review. This report is a recommendation, **not
merge/deployment authorization**.

## Sources

- [Official README](https://github.com/cloudflare/oxlint-config)
- [Full migration skill](https://github.com/cloudflare/oxlint-config/blob/main/skills/migrate-oxlint-config/SKILL.md)
- Installed `@cloudflare/oxlint-config@0.1.0` and `@nkzw/oxlint-config@3.0.0`
  source/manifests, npm registry metadata, installed tsrs version output and
  Shelf's fresh runtime checks.
- [Original Oxlint audit](oxlint-audit.md) (historical PR93 setup).
