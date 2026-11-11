# Fast note opening: investigation and recommendation

Research date: 2026-11-11. Application baseline: `6a78b96`. This is a research/design deliverable, **not a shipped fix**. Temporary local prototypes were removed. Production SQLite was opened read-only; the reported note was used in memory against an isolated test server. No note text, credentials, database copies, or production identifiers are included here.

## Recommendation

Keep Milkdown/ProseMirror. First remove repeat Markdown parsing with a bounded, source-validated **document-data cache**, then separate initial presentation from editor construction at a real browser rendering boundary. Retain fresh editing state per opening initially. Do not start with a pooled live editor, an editor-engine migration, or a mandatory Reading/Edit mode.

An immediate formatted read-only preview is useful **only if its content is already prepared cheaply and the handoff is safe**. It is not automatically the best first patch. Parsing Markdown synchronously to make a preview, then parsing it again for editing, risks reproducing the same delay with extra work. A loading shell can acknowledge the tap sooner, but must not be reported as an opened/readable note.

Proposed sequence:

1. Cache prepared document data; prove unchanged repeat openings skip Markdown parsing without sharing history, callbacks, or selection.
2. Give the dialog an initial rendering opportunity before heavy initialization, with cancellation and safe close/save handling.
3. If first-time readability remains slow on the actual phone, add bounded preparation of likely-next documents and a formatted preview derived from the **same prepared representation**. Measure this before making every opening go through a second renderer.
4. If cold parsing still produces long blocking intervals, investigate a worker for pure syntax parsing. Moving DOM editing into a worker is not an option.

This recommendation combines the measured Shelf bottleneck with primary-source editor/browser guidance below. It does not assume other products use the same UI transition.

## What was measured

### Method

- Fresh production build from the baseline, using its lockfile (`npm ci`, `npm run build`). Milkdown core/kit 7.23.0, React 19.3.0, Playwright 1.63.0 as resolved in this installation.
- Isolated server/database, authenticated browser context, mocked note-list response containing only the reported note and a short paragraph control. No calls or saves to the live application.
- Chromium, touch/mobile viewport 393 × 873 CSS pixels, device scale factor 2.75, CDP CPU throttling rate 4.
- The reported document contained 2,380 source characters, 50 list items, 25 list nodes, and maximum list depth five. Size alone understated its structural complexity.
- Native `performance.mark()` probes, rather than timing Playwright locator completion: captured card click, editor configuration/create return, `showModal()` start/end, parser start/end, list normalization, editor creation promise completion, and the first rAF callback scheduled by the captured click.
- Sequence per variant: short control, affected document, affected document, short control, affected document, short control, affected document, short control. Each opening was closed before the next. Three repeat samples per affected-note variant; no statistical confidence or p95 is claimed.
- Separate parser-detail run wrapped the installed remark processor's `parse` and `runSync`, plus the Milkdown parser. No CPU profiler was active in these timing runs.

**Endpoint limitations:** “first frame” below means the first animation-frame callback, a rendering-opportunity proxy, **not proof that pixels were presented**. “Editor ready” means the Milkdown `create()` promise completed, not a tested first keystroke. Click capture excludes any delay before event dispatch. The isolated two-note board excludes full-production-board costs, attachments, and the actual phone's OS/browser behavior. These are mechanism experiments, not a complete reproduction of an exact one-second device trace.

Earlier conversation measurements used Playwright wait completion and, initially, an outdated local build. Prefer the fresh-build, in-page stage measurements here; the earlier numbers should not be treated as a precise current-build benchmark.

### Baseline and one-variable experiments

| Variant | First affected open: frame / ready | Repeat affected opens: median frame / ready | Repeat Markdown parser called? |
| --- | --- | --- | --- |
| Baseline | 259.8 / 192.2 ms | 221.1 / 189.3 ms | Yes |
| Parsed-document JSON cache | 336.9 / 284.6 ms | 138.8 / 92.1 ms | No |
| Same cache + defer creation across two rAF callbacks | 66.8 / 322.0 ms | 75.9 / 116.7 ms | No |

These are separate runs on shared infrastructure. The first-open variation is substantial; do not interpret it as a cache-induced regression or claim an exact percentage improvement from three samples. The directly verified mechanisms are stronger evidence: cache hits bypassed the Markdown parser, and the scheduling prototype allowed the first callback before initialization.

Baseline affected-document opening markers:

| Trial | Parse duration | Normalization duration | Editor ready after click | First frame after click |
| --- | --- | --- | --- | --- |
| First | 82.9 ms | 0.7 ms | 192.2 ms | 259.8 ms |
| Repeat 1 | 121.2 ms | 3.5 ms | 281.1 ms | 314.4 ms |
| Repeat 2 | 60.6 ms | 1.0 ms | 114.4 ms | 148.9 ms |
| Repeat 3 | 61.2 ms | 1.6 ms | 189.3 ms | 221.1 ms |

The baseline feedback check failed on all four affected openings: `first-frame > editor-ready`. This captures the relevant architectural symptom: editor initialization finishes before the initial rendering opportunity. In the deferred-creation experiment, all four affected openings had `first-frame < init-resumed` instead.

In the separate parser-detail run, the affected document's syntax parsing took 31.4–67.2 ms; total Markdown-to-document parsing took 48.4–96.1 ms. Remark transforms and construction of ProseMirror nodes added further work. The control's later warm total parser calls took 0.2–7.5 ms. This supports a content-dependent parsing cost; it does not establish a universal nesting threshold or rule out other production costs.

### Prototype boundaries

The cache experiment stored `initialDoc.toJSON()` keyed by exact Markdown source and supplied `{ type: 'json', value }` to `defaultValueCtx` on subsequent openings. It still created a new editor/state/view. The temporary cache was unbounded and had no security-lifecycle tests: **not production-ready**.

The scheduling experiment changed only creation scheduling relative to that cache variant: the call to `editor.create()` happened in the second rAF callback. This supplied a prior rendering opportunity; it neither made construction interruptible nor provided a formatted preview. It was a diagnostic ordering experiment, not the proposed final scheduling helper. Cancellation, hidden-document behavior, focus, and errors need design/tests before shipping.

## Why Shelf behaves this way

Relevant application code:

- `src/client/App.tsx`: note-card open callbacks set editor state; `<Editor>` is conditionally mounted. Opening a note therefore mounts a fresh editing subtree.
- `src/client/components/RichTextEditor.tsx`: the mount effect creates `createNoteEditor(...)`, immediately calls `editor.create()`, and destroys it on cleanup. No prepared-document cache exists. `read()` deliberately falls back to the original Markdown while mounting.
- `src/client/components/Editor.tsx`: a parent effect calls `showModal()`. Showing a dialog and actually painting it are different events; editor initialization can still occupy the main thread before a frame.
- `src/client/rich-text.ts`: each instance configures the commonmark/GFM/history/clipboard stack. `defaultValueCtx` receives source Markdown. Plugin closures capture that opening's source, callbacks, and initial document. List normalization happens during state construction.
- Installed `@milkdown/core/src/internal-plugin/editor-state.ts`: string default values invoke the parser; JSON defaults use `Node.fromJSON(schema, value)`. A JSON cache therefore has a supported load path without a server format change.
- Installed `@milkdown/core/src/internal-plugin/parser.ts` and `@milkdown/transformer/src/parser/state.ts`: parser creation uses the remark processor and schema; parsing synchronously runs `remark.parse`, `remark.runSync`, and construction of the ProseMirror document.

The narrow conclusion is **repeated main-thread document parsing plus editor/view setup before first render**, not “the production database is slow.” Tests supplied note data locally and still exhibited the blocked rendering opportunity. They do not exclude network, full-board rendering, or device scheduling as additional production contributors.

Configuration construction was small on warm openings in these runs. Normalization was also small. This is why a document-data cache is a better first intervention than rewriting lifecycle management to pool a live editor. View/DOM creation remains work even on a cache hit.

## What established apps and editor engines actually document

External research was also performed by an independent research agent, which inspected primary documentation and source. Recommendations below distinguish documented mechanisms from Shelf-specific proposals. Moving documentation/source may describe newer APIs than the installed Milkdown version; this is not a library-switch implementation guide.

### Notion: non-blocking acceleration and tail-latency checks

Notion reports 20% faster browser page navigation from worker-backed WASM SQLite caching. Crucially, synchronously downloading/processing the cache library initially **slowed app startup**. It moved that loading off the critical path. Some slow devices also read local storage more slowly than the API, so it raced cache and network requests. [N1]

Transfer to Shelf: do not make startup or low-end devices worse by prewarming everything. Distinguish cold startup from warm note navigation and examine tail latency, not just averages. Notion's article is about data access; it does **not** document an automatic static-preview-to-editor opening swap. Shelf already has local data storage, so importing Notion's SQLite architecture is not the indicated fix.

### Google Docs: rendering architecture, not evidence for a preview swap

Google's official 2021 announcement describes migrating document rendering from HTML to canvas for performance and cross-platform consistency, with compatibility/accessibility consequences. It does not establish how present-day document opening is scheduled, whether editor instances are pooled, or whether a static preview is replaced after loading. [G1]

Transfer: renderer choices matter, but a canvas rewrite is disproportionate to Shelf's observed parsing/setup cost.

### ProseMirror / Tiptap: data, state, and view have different lifetimes

ProseMirror documents persistent document values, fresh `EditorState` creation when loading a new document, and `EditorView.updateState(...)`. Reconfiguring plugins preserves compatible state fields; it is not a general reset of note history and selection. [P1][P2]

Tiptap recommends isolating its editor from unrelated React rerenders and narrowing toolbar subscriptions. Its guide also warns that React node views mount synchronously and can be expensive in quantity. Shelf's custom list-item node views are plain DOM, not React node views, so this warning is context rather than proof of Shelf's bottleneck. [T1]

The inspected Tiptap implementation distinguishes an editor object from its live view: `element: null` postpones real view creation; `unmount()` destroys the ProseMirror view; remounting creates another view. Reusing an editor object is therefore not necessarily reusing DOM. `setContent` replaces content through a transaction rather than constructing fully fresh per-document state. [T2][T3][T4]

Transfer: cache immutable document data first. A live-view reuse experiment may later be worthwhile, but whole-document rendering and correct state reset remain necessary.

### Lexical (Meta): immutable state, controlled reconciliation

Lexical documents a source-of-truth editor state containing document and selection, with JSON serialization of the document but not runtime keys/selection. Restoring requires compatible registered node types. Its updates reconcile to DOM in batches; a synchronous update callback returning is not the same as completed DOM reconciliation. Listeners that schedule further updates can create waterfalls. [L1][L2]

Transfer: separate document snapshots from UI/session state and measure the actual committed edit. These mechanisms do not demonstrate that switching Shelf to Lexical would be faster.

### CKEditor 5: profile structural work and cache repeated computations

CKEditor's first-party performance investigation found document structure/tag/attribute counts important, with tests including deeply nested lists. It describes substantial improvements from caching repeated child-position calculations and model/view mappings, with explicit invalidation and memory tradeoffs. Its tests measured its own initialization promises and workloads, not a comparative editor benchmark. [C1][C2]

Transfer: avoid repeated conversion/work before adding a second rendering system. The article's discussion of content streaming/internal-model persistence is future exploration, not evidence that those were already shipping features.

### Obsidian / CodeMirror: useful contrast, different editing model

Obsidian's developer docs identify CodeMirror 6 and distinguish editor extensions from Reading-view Markdown post-processing. CodeMirror documents rendering the viewport plus a margin, with limitations on coordinates for offscreen content. [O1][O2]

Transfer: viewport rendering is a real architectural technique, but arbitrarily removing offscreen ProseMirror rich-text DOM would require selection, layout, and accessibility work. Obsidian's “Live Preview” is not evidence for an opening-time read-only placeholder that automatically swaps into an editor.

## Concrete implementation plan

### 1. A small prepared-document module

Introduce an internal module that owns document-data caching, not a global live-editor pool. Its conceptual entry contains:

- Exact source Markdown and a schema/configuration generation.
- Plain serialized ProseMirror document data, not an `EditorState`, `EditorView`, DOM subtree, callback closure, or undo stack.
- Optionally a safe, controlled read-only representation, added only when required by the readability experiment.

On a valid cache hit, pass JSON through Milkdown's supported default-value path. On a miss, parse normally and populate the cache once initialization succeeds. Keep original Markdown authoritative: untouched open/close must return the original source, not serialize the cached document back into rewritten Markdown.

Bound retention by entries **and approximate bytes**; choose limits from representative note distributions rather than this one document. Validate exact source on every lookup. Any edited/synced body or incompatible schema/configuration must miss. Same-version offline local edits must also miss, so server version alone is insufficient. Clear private prepared content on sign-out and other account/security resets. No new server storage format is required for this first step.

A cache populated by opening a note improves repeats but **does not solve the first-ever opening of an uncached note**. Be explicit about that limit.

### 2. Initial presentation and cancellable initialization

Connect/show the named dialog with correct title, controls, and available content before starting expensive work. Use an explicit rendering-aware scheduling boundary, not `await Promise.resolve()`, a microtask, or an assumption that `useEffect` means “after paint.” Browser guidance recommends yielding to a future task and warns that rAF runs before repaint. A single heavy rAF callback can block its own upcoming frame. [B1][B2]

Design one helper that owns cancellation, fallback scheduling, visibility changes, and error propagation. User-requested initialization must not wait indefinitely for idle time. Check ownership before starting and again before attaching/completing. Cancel queued work on close; destroy already-started stale instances without updating an unmounted component. Preserve the current StrictMode-safe per-effect host behavior.

Do not autofocus an existing note or steal focus after the user has chosen a control during loading. Closing before readiness must preserve the source and any title/color/attachment changes. Deferred initialization must not become a data-loss path.

### 3. Readable content: prepared preview when justified

If the first-read target is still missed on the actual phone, prepare likely-next documents **before the tap**, with bounded work and priority escalation when actually opened. Do not parse the entire notes collection eagerly or put an unbounded synchronous parser in an idle callback and call it background processing. Idle callbacks are cooperative, can be postponed, and do not preempt a long function. [B3]

Use the same prepared document to derive the preview and initialize editing. Do not add a second full Markdown parse to the opening path. Reuse formatting/layout rules where possible, but treat exact layout equivalence as something to test. Prefer controlled nodes/text over injecting arbitrary Markdown-generated HTML. Existing protections for inert inline resources, pasted HTML, and safe links must apply to the preview too.

For an uncached/unprepared note, show an honest lightweight loading shell promptly and initialize at user-visible priority. Count time until the content itself is visible; a shell is not the final readability solution. Worker-backed preparation is the next candidate if this cold path remains materially blocking.

If using an automatic preview handoff:

- Keep one stable scroll container; preserve a logical block/text anchor plus intra-block offset, not just a potentially invalid pixel offset.
- Never replace the preview during active drag selection, long-press selection, or composition. If interactions defer the handoff, expose an explicit path to editing rather than silently discarding intent.
- A tap before readiness must have defined behavior; do not drop it or synthesize a native tap replay. Establish a tested logical-position mapping if that tap should position a caret.
- Do not expose duplicate preview/editor trees to assistive technology. Announce loading/editing status without calling a read-only surface an editable textbox. Retain modal focus containment and close/focus restoration. [A1]
- Keep preview, prepared data, editor session, and save destination tied to the same source/revision and opening request.

An already-prepared note should become directly editable when fast enough; there is no reason to impose a visible read-only phase on every opening. A genuinely separate Reading/Edit product mode would be a different UX decision, not a performance patch.

### 4. Only escalate after measuring

**Live editor reuse:** ProseMirror supports retaining a view with new state, but Shelf's existing closures capture the original source and callbacks. Calling a content-replacement helper alone would not safely retarget `read()`, change/limit/selection callbacks, history, pending work, and save ownership. Refactor a clear document-session boundary and test fresh state before pooling. Configuration cost alone did not justify this complexity in the current measurements.

**Worker parsing:** the syntax subphase is a plausible CPU-only candidate. Prove that the exact remark configuration/transformers can run off-thread, preserve schema semantics, and avoid a second full parse on the main thread. Milkdown 7.23's current parser API accepts a string; worker AST injection is not a trivial option toggle. Include worker startup, transfer, reconstruction, bundle, and memory costs. The editable DOM, layout, focus, and selection remain on the main thread. [B4]

**Library migration / virtualization / persistent schema JSON:** no current measurement justifies these larger projects. A session-local cache avoids a database migration and long-term document-format compatibility obligations.

## Verification and release gates

Proposed targets, not achieved guarantees: visible acknowledgment around 100 ms on a representative phone; readable content and first successful edit tracked independently, with an initial goal of staying below 200 ms for common warm cases. Establish distributions on real devices before selecting final thresholds. Google's good-INP guidance is 200 ms at the 75th percentile, but that metric is not the same as completion of an asynchronous document opening. [M1]

Required tests before an implementation ships:

1. Cache hit skips parsing; body/schema changes miss; cache is bounded and clears on sign-out. Untouched source stays byte-for-byte unchanged.
2. Correct initial frame ordering with deliberately delayed initialization. Separately verify actual readable content and first committed keystroke, not just lifecycle callbacks.
3. Immediate close; title edit then close before readiness; A → close → B; initialization failure/fallback; sync update during preparation; React StrictMode cancellation.
4. No cross-note undo/redo, callback, selection, disabled-state, or autosave leakage.
5. If preview is added: scrolling, word taps, links, long-press/drag selection, keyboard input, paste, IME, screen-reader semantics, and no unexpected focus/scroll jump.
6. Existing rich-text safety, formatting, source-preservation, note modal, mobile keyboard, and save-recovery suites remain green in Chromium and WebKit where supported.
7. Fresh-build traces for cold/warm and repeated openings, full representative note board, short/structured/near-limit notes, both real target phone and desktop. Record input delay, first readable paint, editor-ready stage, first successful/visible edit, longest main-thread task, retained memory, median and tails.

The research prototypes establish useful mechanisms, but not these release gates. No production fix has been deployed by this investigation.

## Delivery verification

- All temporary source probes/cache/scheduling changes removed; `git diff --exit-code -- src` passed.
- `npm run typecheck` passed on the restored source.
- `npm run test:unit` passed: 6 files, 46 tests.
- Production-build experiments completed successfully for each variant. No full E2E-suite or actual-phone verification is claimed.
- Deliverable is this document only; the original performance behavior is not fixed by a documentation change.

## Primary sources

- [N1] Notion engineering, browser caching and startup/tail regressions: https://www.notion.com/blog/how-we-sped-up-notion-in-the-browser-with-wasm-sqlite
- [G1] Google Workspace, canvas-rendering announcement (2021): https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html
- [P1] ProseMirror reference, state/view/plugin lifecycles: https://prosemirror.net/docs/ref/
- [P2] ProseMirror guide, document/state/schema model: https://prosemirror.net/docs/guide/
- [T1] Tiptap integration and node-view performance: https://tiptap.dev/docs/guides/performance
- [T2] Tiptap editor instance/mount API: https://tiptap.dev/docs/editor/api/editor
- [T3] Tiptap source inspected by the research agent, pinned path commit: https://github.com/ueberdosis/tiptap/blob/253b2a1d8f76ad0c65bc0a448325dbcce22d0049/packages/core/src/Editor.ts
- [T4] Tiptap content replacement (moving main): https://github.com/ueberdosis/tiptap/blob/main/packages/core/src/commands/setContent.ts
- [L1] Lexical state/JSON/reconciliation: https://lexical.dev/docs/concepts/editor-state
- [L2] Lexical listeners and waterfall updates: https://lexical.dev/docs/concepts/listeners
- [C1] CKEditor 5 structural workloads and initialization measurements: https://ckeditor.com/blog/how-we-made-our-rich-text-editor-load-faster-part-1/
- [C2] CKEditor 5 caching mechanisms and invalidation: https://ckeditor.com/blog/how-we-made-our-rich-text-editor-load-faster-part-2/
- [O1] Obsidian official developer docs source, editor extensions: https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Editor/Editor%20extensions.md
- [O2] CodeMirror system guide, viewport/layout: https://codemirror.net/docs/guide/#viewport
- [B1] Browser scheduling and long tasks: https://web.dev/articles/optimize-long-tasks
- [B2] rAF callbacks run before repaint: https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- [B3] Cooperative idle scheduling draft: https://www.w3.org/TR/requestidlecallback/
- [B4] WHATWG worker capabilities/lifecycle: https://html.spec.whatwg.org/multipage/workers.html
- [A1] WAI modal dialog pattern and focus guidance: https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/
- [M1] INP endpoints and thresholds: https://web.dev/articles/inp
