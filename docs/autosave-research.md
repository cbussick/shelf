# Autosave research for Shelf

Researched **2026-11-18** against first-party documentation and the local checkout at `4ac67c1`. Research only: no application changes or runtime product experiments. Product behavior below is **documented behavior**, not independently measured behavior. Recommendations are explicitly Shelf design judgments, not claims about competitors' internals.

## Bottom line

Save changes **while the editor remains open**, to IndexedDB first; synchronize that committed state separately. Use bounded coalescing during typing, not a trailing debounce that can postpone every save indefinitely. Flush pending local work on close and on becoming hidden, but never depend on termination events to rescue a whole editing session. Stable identity, ordered writes, attachment promotion, and deletion safety must precede enabling a timer.

**No numeric “industry-standard autosave debounce” was established by these sources.** Google's “as you type,” Microsoft's “continually,” and Joplin's “within a few seconds” do not specify a local persistence debounce. Joplin's timing describes **upload scheduling**, not IndexedDB writes. Pick and measure Shelf's local delay and maximum wait according to an explicit acceptable-loss budget and iPad performance, rather than attributing invented timings to those products.

## What established apps actually document

| First-party source | Documented behavior | Implication, not an implementation claim |
| --- | --- | --- |
| Google Docs [1] | Automatically saves online changes as users type, without a save button. With offline access enabled, changes save to the device as text is entered, then to Drive after reconnection. | Closing a document should not be the primary persistence action. Device save and cloud save are distinct. This is desktop-oriented documentation, not proof of Safari offline support. |
| OneNote [2] | Automatically and continually saves typing, editing, formatting and other work; documents exiting without manually saving. The page applies to the listed desktop versions. | Continuous protection is an established user expectation, but this native-product promise is not a browser durability guarantee. |
| OneNote for iPad/iPhone [3] | Syncs while users work and syncs pending changes when back online. Offline availability of attachments has its own Auto Sync Attachments setting. | Distinguish pending replication and offline attachment availability from text persistence. Do not assume native iPad background behavior is available to a web app. |
| Joplin developer sync spec [4] | Offline-first means data is saved locally, then uploaded/downloaded by synchronization. Uploads changed items within a few seconds to limit conflicts; periodically downloads remote changes. | Local commit should not await server success. Prompt uploads help reduce, but cannot eliminate, conflicts. |
| Joplin conflict help [5] | Concurrent changes to a note or attachment can conflict. Copies the local note to a Conflict notebook before replacing it with the remote note; offers comparison/recovery guidance. | Preserve both versions instead of silently choosing a winner. This page describes that documented recovery path, not every possible version-specific merge implementation. |

These sources establish useful UX and architecture precedents, not matching algorithms, exact debounce constants, or universal guarantees.

## Browser lifecycle and durability constraints

- **Mobile/iPad departure is not a reliable shutdown sequence.** MDN describes switching apps and later killing the browser without `beforeunload` [6]. Its visibility guidance identifies transition to `hidden` as the last reliably observable event [7]. Chrome's lifecycle guidance describes suspension/discard and warns that `pagehide`/unload may also be absent on mobile [8]. Use these as risk guidance for iPad Safari/Home Screen testing; Chrome-specific `freeze`, `resume`, and `wasDiscarded` are not portable Safari prerequisites.
- **A hidden-event flush is best effort, not a guarantee.** Initiate already-prepared local work immediately, without waiting for another timer or network request. Abrupt process death can occur before completion. MDN explicitly warns that shutdown aborts transactions and that transactions initiated at unload will not reliably complete [9]. Frequent foreground commits are the actual loss-limiting mechanism. Screen lock, app switching, memory pressure and forced termination must be tested on physical iPads.
- **Request success is not transaction completion.** Commit the note, outbox operation and newly referenced blobs atomically, and report local success only after transaction completion [9]. Prepare media metadata outside the transaction; do not keep a transaction open across unrelated asynchronous work.
- **Logical commit, physical durability and eviction resistance differ.** MDN documents `default`, `relaxed`, and `strict` durability options, with performance/power tradeoffs [10]. Evaluate supported `strict` transactions for irreplaceable unsynced notes on target browsers; do not promise power-loss-proof storage or substitute nonstandard `readwriteflush` for portable behavior. Neither option prevents site-data clearing.
- **Persistence permission is not guaranteed.** IndexedDB is best-effort by default; quota failures, storage pressure, user clearing and private-session expiration are separate risks [11]. WebKit documents Safari/iPadOS 17+ Storage API support, origin eviction, and heuristic `persist()` approval (including Home Screen use as a heuristic) [12]. Inspect the returned grant/`persisted()` result, handle rejection, and treat `estimate()` as advisory. Installation is not a backup or an unconditional persistence grant. Avoid blanket claims that all Safari data disappears after seven days; policy depends on interaction, storage mode and context.
- **Small writes and honest failure handling matter.** web.dev recommends retaining usable in-memory state if persistence fails, writing only the necessary records, and measuring structured-clone/main-thread cost [13]. Its article concerns UI state generally; for Shelf's unsynced user content, memory-only fallback must carry an explicit data-loss warning.

## Current Shelf save path and implications

Inspected [`Editor.tsx`](../src/client/components/Editor.tsx), [`App.tsx`](../src/client/App.tsx), and [`local-store.ts`](../src/client/local-store.ts).

| Current code observation | Autosave consequence |
| --- | --- |
| `Editor.requestClose()` calls `save()`; title/body/attachments otherwise live in component state. `save()` reads the rich-text handle, disables editing while saving, and closes after success. Initial snapshot remains the dirty baseline. | Do not run this function periodically: autosave must neither close nor disable the editor, and needs a last-committed-revision baseline rather than the opening snapshot. |
| Empty new drafts are discarded; closing an existing empty note calls `onDelete`. Explicit delete dialogs warn there is no trash. | Reusing this rule during typing would turn select-all/backspace into permanent deletion. Autosave and delete require separate semantics. |
| `App.save()` awaits `saveLocalNote()`, refreshes all local notes, increments pending, emits an added/updated toast and starts sync. Its `onSave` contract returns no saved identity to the editor. | Separate quiet local checkpoints from close/toast behavior. Return/adopt saved identity and attachment metadata. Avoid collection-wide refresh/toast churn on every checkpoint; derive pending from persisted operations, not save counts. |
| `App` synchronizes on startup, online, becoming visible and a visible 15-second interval; becoming hidden does not save the editor. `persist()` is requested but its outcome is not inspected. | Existing sync polling protects only committed notes, not the open in-memory draft. Add an editor persistence path on hidden and inspect storage status. |
| `saveLocalNote()` allocates a UUID when `id` is absent, and fresh attachment/blob IDs for each `newImages`/`newAudio` item. It prepares visual dimensions before opening the write transaction. | Repeatedly submitting the current new-draft/new-file arrays would duplicate notes or attachments. Asynchronous preparation can also reorder writes unless ordered above this function. |
| Local note, blobs, meta and one outbox record per note are committed together, awaiting `transaction.done`; outbox saves preserve their original expected version and replace mutation IDs. | Keep this atomic, coalescing foundation. It does not by itself order snapshots prepared before their transactions or detect two stale editors on one device. |
| Sync acknowledgements compare mutation IDs and reconcile newer local content/attachment metadata in a transaction. Remote refresh protects notes with queued operations. HTTP 409 saves preserve a conflict copy of the latest local revision, including missing-attachment warnings. | Preserve these defenses and extend tests to continuous editing. They cannot protect changes still only in the editor, nor automatically retarget an open editor after conflict recovery. |
| Database connection probing/reopening handles an invalid cached connection before writes. `App`'s sync guard is a component ref. | Retain safe reconnection; a local guard is not a cross-tab sync coordinator. Test multiple tabs, aborted writes and reconnects rather than blindly retrying destructive work. |

## Recommended Shelf contract (design judgment)

### Scheduling and editor continuity

1. Capture actual editor-document changes plus title, color, pin, rotation, attachment additions/removals into a current session snapshot. Avoid marking focus/selection changes as edits. Preserve the existing rich-text `read()` safeguard at explicit flush boundaries; validate IME/composition and fallback-editor behavior.
2. Coalesce short typing bursts with a trailing local checkpoint, **plus a maximum wait measured from the first uncommitted change**, so continuous typing still commits. Start with the smallest practical bounded delay supported by measurement; this research does not prescribe a numeric constant. Timers are scheduling targets, not deadlines when execution is suspended.
3. Make attachment acceptance and completed recording retention prompt checkpoint boundaries. Do not wait for text typing or server upload to persist a newly kept file. Never imply an in-progress recording is protected unless recorded chunks are themselves durably checkpointed; that is separate work.
4. Close/Escape/backdrop must drain local persistence through the close-time revision before unmounting, not wait for network sync. A hidden transition should request the same idempotent flush without closing the editor; `pagehide` can supplement it. Only attach `beforeunload` while genuinely uncommitted local work exists, as an optional warning [6], not as a save implementation.

### Serialization, identity and attachments

- Give each editor session a stable token and each new note a stable ID **before its first write**. Keep that ID through retries/checkpoints. Do not change the React editor key to the full updated note snapshot on each save: retain cursor, undo, composition and mounted rich-text state.
- Use one ordered local writer per session/note, including media preparation: one in-flight snapshot, one replaceable latest pending snapshot. Keep revision counters; acknowledge only the revision actually committed, and immediately drain newer pending work. An older completion must never mark newer text saved, clear its error, close a different session, or overwrite newer data. Do not mutate live input to match a stale save result.
- Allocate stable per-addition attachment IDs, persist bytes once, and promote committed new attachments into retained references. Reconcile promotions by ID/revision so files added or removed during a write are not dropped or resurrected. Retrying the same addition must not allocate another blob. Filename/size/lastModified is not a safe unique identity; global content hashing is optional, not necessary for this deduplication goal.
- Preserve atomic note/outbox/blob ownership and current acknowledgement reconciliation. Reclaim bytes only when no committed owner or in-flight recovery needs them. Do not re-read dimensions or rewrite unchanged media on each text checkpoint.
- Serializing one editor does not resolve other tabs. Use transactional local revision checks and an explicit coordination/notification strategy for competing writers and sync workers; server `expectedVersion` alone does not detect two local stale snapshots overwriting one queued note.

### Sync and conflicts

Local success means the revision reached IndexedDB, not the server. Queue/coalesce network work separately and serialize sync; avoid a tight repeat-upload loop during typing, particularly with large media. Keep version checks and “preserve both” recovery. A timeout after server acceptance is an ambiguous outcome: verify stable attachment-ID/retry behavior rather than assuming a client mutation ID is server-side idempotency.

When conflict recovery replaces an original with the remote version and creates a local copy, explicitly reconcile the **open session**: pause and surface recovery or move it to the preserved copy with its latest revision. Otherwise the next autosave can write stale editor content back onto the original. Also test remote deletion, delete-vs-edit and cross-tab races. Autosave reduces the unsaved window; it does not make the app collaborative or conflict-free.

### Status, errors and deletion safety

- Distinguish `Unsaved changes` / `Saving on device…` / `Saved on device` from `Syncing…` / `Synced` / `Sync needs attention`. Show local status in the editor even if the global server status is green. Only claim saved for the current committed revision; pending sync alone must not trigger an unsaved-local warning.
- Keep editing responsive during checkpoints. Use a quiet, accessible status rather than repeated toasts/live announcements. Persist local-save errors visibly with retry and copy/export options; preserve text/files in memory, explain quota vs unavailable database vs network/auth failure, and do not suggest reload as a safe recovery for memory-only content. Network failure should not downgrade a successful local save into “not saved.”
- Retain the existing close-failure protection, but redefine “close without saving” accurately: it discards only **uncommitted latest changes**, not earlier autosaved revisions. Ordinary Close is no longer a rollback of the whole session. Guard sign-out/clear-local-data while uncommitted edits exist, not just while the outbox is pending.
- A never-used empty draft should not create a board item/outbox operation. A previously nonempty note becoming empty must **not** become a delete, including on backgrounding. Persist its recoverable empty state or a separate draft; require explicit confirmed deletion (preferably with undo/trash as future safety work). Include attachments in emptiness checks and test editor serialization of visually empty content. Decide explicitly whether metadata-only drafts deserve creation.
- Explicit deletion must cancel/drain pending saves and permanently fence off that session's future writes before queuing the tombstone. Test deleting a new autosaved note while its first upload is in flight; preserve the existing version-zero deletion protection. Do not let a late timer recreate a deleted note.

## Verification priorities before implementation ships

- Continuous typing without pauses; close and hidden flushes; edit while a slow write completes; old success/error arriving after a new session opens.
- Reload/reopen offline after a confirmed local commit; failed/aborted transaction preserves the previous committed state and newest in-memory draft.
- Stable new-note identity; repeated retries do not duplicate files; add/remove/rotate attachments during save/upload; recording kept before backgrounding.
- Select-all/delete/undo, whitespace-only and attachment-only drafts; explicit delete with pending local write/upload; no resurrection.
- Existing sync text/image/audio race and conflict tests, extended to an editor that stays open; multiple tabs and two offline devices; remote delete and conflict-copy session handling.
- Real iPad Safari **and** Home Screen: switch apps, lock, force termination, low-memory reload, offline resume and storage pressure. Browser automation/WebKit desktop alone cannot establish iPad termination guarantees. Measure input latency, serialization cost, commit latency, write rate and largest-media costs before choosing timing constants.

## Verified sources

All URLs below were fetched and inspected on the research date (not merely taken from search snippets).

1. Google Docs Editors Help, **Create, view, or download a file — Save a file**: https://support.google.com/docs/answer/49114
2. Microsoft Support, **Save notes and notebooks**: https://support.microsoft.com/en-us/office/save-notes-in-microsoft-onenote-2c88d33b-64fe-47e4-bb1a-10b3044b5c4a
3. Microsoft Support, **Work offline in Microsoft OneNote for iPad or iPhone**: https://support.microsoft.com/en-us/onenote/work-offline-in-microsoft-onenote-for-ipad-or-iphone
4. Joplin, **Joplin synchronisation**: https://joplinapp.org/help/dev/spec/sync/
5. Joplin, **What is a conflict?**: https://joplinapp.org/help/apps/conflict/
6. MDN, **Window: beforeunload event**, usage notes: https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event#usage_notes
7. MDN, **Document: visibilitychange event**, usage notes: https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event#usage_notes
8. Chrome for Developers, **Page Lifecycle API**, state guidance and legacy events: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
9. MDN, **Using IndexedDB**, transactions and shutdown warning: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB#warning_about_browser_shutdown
10. MDN, **IDBDatabase: transaction()**, durability options: https://developer.mozilla.org/en-US/docs/Web/API/IDBDatabase/transaction#parameters
11. MDN, **Storage quotas and eviction criteria**: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
12. WebKit, **Updates to Storage Policy** (2023-08-10; Safari/iPadOS 17+ policy scope): https://webkit.org/blog/14403/updates-to-storage-policy/
13. web.dev, **Best Practices for Persisting Application State with IndexedDB**: https://web.dev/articles/indexeddb-best-practices-app-state
