# Shelf — product and design decisions

## Product boundary

Shelf is a single-owner, self-hosted home for text, image, and audio notes. It supports Markdown task lists within note bodies, not a separate checklist note type. It intentionally excludes drawings, labels, archive, reminders, sharing, and a persistent trash folder.

## Visual direction

- Canvas `#F7F8FA`; ink `#263630`; evergreen `#285B48`; butter `#F8EBAD`; mint `#DBEBE1`; lilac `#EAE4F3`; peach `#F6DFD2`; blue `#D9E8F8`; orange `#F8D2A8`; rose `#F3DCE5`.
- Manrope throughout.
- Four masonry-style columns on desktop, three on tablet, and two on phones.
- Pinned notes form a separate section above other notes. Empty sections disappear.
- Images retain their proportions. The image preview offers clockwise and counterclockwise quarter-turns; orientation saves with the note and syncs without rewriting the original image bytes. Color remains a lightweight visual preference rather than a taxonomy.
- Images and audio share an attachment area, with an image gallery followed by a scrollable audio list. Cards show one compact player and a count for additional audio files.
- A waveform Add audio action sits beside image capture in the bottom toolbar and inside the editor. It offers upload or microphone recording; capture is explicitly previewed and kept/discarded.
- Dates are plain text. The interface avoids decorative navigation, metrics, and feature advertising.

## Responsive behavior

- Desktop and tablet use a capture bar and modal editor.
- Phones use a fixed bottom capture dock and full-screen editor.
- Unpinned card controls appear on desktop hover/focus and remain visible on touch-oriented layouts.
- Note bodies use a bounded, internally scrolling rich-text surface. The formatting controls wrap on phones; Tab moves focus normally, and list nesting uses buttons or Ctrl/Cmd+[ and Ctrl/Cmd+].

## Note bodies

Milkdown provides one directly editable, formatted body, with CommonMark/GFM input shortcuts, headings, emphasis, links, lists, native task checkboxes, quotes, code and undo/redo. There is no separate Read/Edit switch or text highlighting. The body remains a Markdown string; cards display non-interactive text excerpts with task state.

Closing a note saves on this device, as before; neither typing nor ticking a task is advertised as an autosave. Merely opening a note does not rewrite its source. After editing, Markdown serialization can normalize spacing, bullets and delimiters; byte-for-byte preservation of edited source is not promised. Body whitespace is no longer globally trimmed. The serialized body retains the 20,000-character limit.

Markdown images are shown as placeholders without loading remote resources. Use Shelf attachments for images. Raw HTML is not executed, and links are sanitized. If editor initialization fails, the body falls back to Markdown text editing. All editor assets are bundled and precached for offline startup.

This is a prototype for evaluation: automated Chromium/mobile-viewport coverage is not a substitute for real iOS/Android keyboard, IME, or screen-reader testing. Arbitrary Markdown extensions and exact source round-tripping are not supported guarantees.

## Persistence and sync

The browser commits edits to IndexedDB before attempting the network. A durable outbox coalesces pending changes by note. The Express server is authoritative after synchronization and stores notes in SQLite.

Each note has a monotonically increasing version. Mutations include the version the editor started from. If another device has changed the note, Shelf retains the server version and creates a separate local conflict copy rather than silently overwriting content.

The interface reports local, syncing, synced, offline, and failure states separately. It never claims an edit is synced before receiving server confirmation.

## PWA behavior

The manifest provides installation metadata. The service worker precaches the application shell and caches successfully retrieved note images. Notes and pending image/audio blobs live in IndexedDB. Audio added on this device is retained locally after acknowledgement; audio from other devices is streamed only on demand. There is no automatic audio download or audio service-worker cache.

Audio uploads have a 100 MB per-file limit and no fixed per-note count limit. The server streams multipart uploads to private per-request directories, validates audio metadata/content, and checks the note version again at commit. Stable attachment IDs reconcile editors opened during an upload. Uploaded files are not transcoded or transcribed. Microphone recording chooses a browser-supported compressed format, stops at 30 minutes or the byte limit, and releases its microphone when stopped/discarded. Capture is stopped for review when the app leaves the foreground; background recording is not promised.

The app retries synchronization on saves, reconnection, foregrounding, explicit requests, and a short foreground polling interval. It does not promise background execution after a mobile OS suspends it.

## Deployment boundary

The production unit is one Docker container plus one persistent volume. Tailscale Serve terminates HTTPS and proxies to a loopback-only port. No separate reverse proxy, database container, Redis instance, queue, or background worker is required.
