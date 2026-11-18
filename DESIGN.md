# Shelf — product and design decisions

## Product boundary

Shelf is a single-owner, self-hosted home for text, image, and audio notes. It supports Markdown task lists within note bodies, not a separate checklist note type. It intentionally excludes drawings, labels, archive, reminders, sharing, and a persistent trash folder.

## Visual direction

- Canvas `#F7F8FA`; ink `#263630`; evergreen `#285B48`; butter `#F8EBAD`; mint `#DBEBE1`; lilac `#EAE4F3`; peach `#F6DFD2`; blue `#D9E8F8`; orange `#F8D2A8`; rose `#F3DCE5`.
- Manrope throughout. UI icons use Lucide React components with a shared size/stroke treatment; the custom Shelf brand mark is unchanged. Lucide/Feather notices ship with the app.
- Four masonry-style columns on desktop, three on tablet, and two on phones.
- Pinned notes form a separate section above other notes. Empty sections disappear.
- Images retain their proportions. The image preview offers clockwise and counterclockwise quarter-turns; orientation saves with the note and syncs without rewriting the original image bytes. Color remains a lightweight visual preference rather than a taxonomy.
- Images and audio share an attachment area, with an image gallery followed by a scrollable audio list. Cards show one compact player and a count for additional audio files.
- A waveform Add audio action sits beside image capture in the bottom toolbar and inside the editor. It offers upload or microphone recording; capture is explicitly previewed and kept/discarded.
- Dates are plain text. The interface avoids decorative navigation, metrics, and feature advertising.
- Initial startup uses the folded-note SVG with a gentle lift/tilt and left-to-right shimmer across “Opening Shelf…”. Reduced motion keeps it static. There is no minimum splash time or exit animation, and background sync never reopens it. Offline startup opens downloaded notes when available, otherwise shows an explanation and retry; reconnect retries automatically. Header branding remains static.

## Responsive behavior

- Desktop and tablet use a capture bar and modal editor.
- Phones use a fixed bottom capture dock and full-screen editor.
- Unpinned card controls appear on desktop hover/focus and remain visible on touch-oriented layouts.
- Note bodies use a bounded, internally scrolling rich-text surface. A stationary padded focus frame surrounds the clipping viewport so partially visible text cannot intersect the focus ring. The formatting controls wrap on phones; Tab moves focus normally, and list nesting uses buttons or Ctrl/Cmd+[ and Ctrl/Cmd+].

## Note bodies

Milkdown provides one directly editable, formatted body, with CommonMark/GFM input shortcuts, headings, emphasis, links, lists, native task checkboxes, quotes, code and undo/redo. There is no persistent Read/Edit mode or text highlighting. Prepared notes can briefly show matching read-only content while their editor starts; the transition is automatic unless the user is selecting text. In that case a temporary **Edit text** action transfers supported text, node, and whole-document selections without interrupting reading. Unsupported mixed block/text ranges stay selected in the preview until the user explicitly clears them to edit; the handoff must never silently shrink a selected range. Visible cards are prepared opportunistically, with a bounded session-local cache of parsed document data, never shared undo history. Shelf also keeps at most one fully initialized, closed text-note dialog ready: idle preparation prioritizes a nearby longer text note and the last opened/saved note. An unchanged reading session reuses its complete DOM and editor, not just parsed Markdown, and resets history, selection and scroll when reopened. Edited/control-interacted sessions, changed note/attachment metadata, another selected note and sign-out invalidate or replace that instance. Media-note dialogs are not retained. Unprepared notes show an honest loading state. The body remains a Markdown string; cards display non-interactive text excerpts with task state.

Editing, including ticking tasks, checkpoints to IndexedDB after a 500 ms pause, with a 2.5-second maximum scheduling wait during continuous typing. One ordered local writer drains newer snapshots without disabling the editor or remounting its rich-text surface. Close/Escape drains local persistence before closing, not server sync. Hidden/pagehide flushes are best-effort safeguards; completed foreground checkpoints provide the protection against tab termination. Merely opening a note does not rewrite its source. Unused empty drafts are discarded, but clearing a previously saved note never deletes it: deletion is explicit and fences off pending writes. After editing, Markdown serialization can normalize spacing, bullets and delimiters; byte-for-byte preservation of edited source is not promised. Body whitespace is no longer globally trimmed. The serialized body retains the 20,000-character limit.

Markdown images are shown as placeholders without loading remote resources. Use Shelf attachments for images. Raw HTML is not executed, and links are sanitized. If editor initialization fails, the body falls back to Markdown text editing. All editor assets are bundled and precached for offline startup.

This is a prototype for evaluation: automated Chromium/mobile-viewport coverage is not a substitute for real iOS/Android keyboard, IME, or screen-reader testing. Arbitrary Markdown extensions and exact source round-tripping are not supported guarantees.

## Persistence and sync

The browser commits edits to IndexedDB before attempting the network. A durable outbox coalesces pending changes by note. The Express server is authoritative after synchronization and stores notes in SQLite.

Each note has a monotonically increasing version. Mutations include the version the editor started from. If another device has changed the note, Shelf retains the server version and creates a separate local conflict copy rather than silently overwriting content.

The editor footer reports one quiet status: Saving…, Syncing…, then Saved only after the server confirms the latest committed edit. It uses Saved on this device · Offline when a locally committed edit awaits connectivity, or Saved on this device · Sync failed with Retry for a failed upload. Local persistence failure is Changes not saved with a persistent explanation and Retry; it keeps the draft in memory. Status text and icon are vertically centered. On phones, the status, Retry and Close share a row below attachment tools. A failed upload also shows that note’s specific server explanation and HTTP status above the footer, as plain text in a bounded scrolling area. Going offline retains the explanation as the last sync attempt, without offering a pointless offline Retry. Error messages are bounded to 4,000 characters while preserving the HTTP status. Routine saves do not produce snackbars or repeated screen-reader announcements; meaningful conflicts/deletions still do.

The overview marks only pending note saves: Waiting to sync or Sync failed, with no badge on confirmed notes. Its header counts all unsynced notes, including those outside the current search or pinned section. Pending deletions and board reordering remain part of overall sync work, not the unsynced-note count. Per-note errors belong to the queued mutation, survive reload, and cannot be attached to a newer edit by an older failed request. Acknowledgement removes the badge and updates the count before other queued uploads finish. Each card keeps a compact status slot in its bottom padding (20 px on desktop, 18 px on phones); the indicator is positioned within that slot, so appearing or disappearing status text cannot resize the card or shift the masonry below it. Synced cards have no indicator, only the reserved padding. Global status stops advertising Synced during local writes, not just during uploads.

A confirmed expired session hides/inerts the workspace, closes its top-layer dialogs, and requires sign-in without unmounting the editor or clearing pending changes. Confirmed expiry remains latched through subsequent network failures until successful authentication. Local checkpoints can finish behind the lock; sync resumes after authentication. Microphone capture stops for review on locking, and an unkept recording or preview remains mounted and recoverable after sign-in. Keep the page open if the latest text could not be committed locally. This does not change the existing offline-entry policy or promise detecting server revocation while disconnected.

## PWA behavior

The manifest provides installation metadata. The service worker precaches the application shell and caches successfully retrieved note images. Notes and pending image/audio blobs live in IndexedDB. Audio added on this device is retained locally after acknowledgement; audio from other devices is streamed only on demand. There is no automatic audio download or audio service-worker cache.

Audio uploads have a 100 MB per-file limit and no fixed per-note count limit. The server streams multipart uploads to private per-request directories, validates audio metadata/content, and checks the note version again at commit. Stable attachment IDs reconcile editors opened during an upload. Uploaded files are not transcoded or transcribed. Microphone recording chooses a browser-supported compressed format, stops at 30 minutes or the byte limit, and releases its microphone when stopped/discarded. Capture is stopped for review when the app leaves the foreground; background recording is not promised.

The app retries synchronization on saves, reconnection, foregrounding, explicit requests, and a short foreground polling interval. It does not promise background execution after a mobile OS suspends it.

## Deployment boundary

The production unit is one Docker container plus one persistent volume. Tailscale Serve terminates HTTPS and proxies to a loopback-only port. No separate reverse proxy, database container, Redis instance, queue, or background worker is required.
