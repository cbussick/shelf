# Shelf — product and design decisions

## Product boundary

Shelf is a single-owner, self-hosted home for text and image notes. It intentionally excludes checklists, drawings, labels, archive, reminders, sharing, and a persistent trash folder.

## Visual direction

- Canvas `#F7F8FA`; ink `#263630`; evergreen `#285B48`; butter `#F8EBAD`; mint `#DBEBE1`; lilac `#EAE4F3`; peach `#F6DFD2`; blue `#D9E8F8`; orange `#F8D2A8`; rose `#F3DCE5`.
- Manrope throughout.
- Four masonry-style columns on desktop, three on tablet, and two on phones.
- Pinned notes form a separate section above other notes. Empty sections disappear.
- Images retain their proportions. Color remains a lightweight visual preference rather than a taxonomy.
- Dates are plain text. The interface avoids decorative navigation, metrics, and feature advertising.

## Responsive behavior

- Desktop and tablet use a capture bar and modal editor.
- Phones use a fixed bottom capture dock and full-screen editor.
- Unpinned card controls appear on desktop hover/focus and remain visible on touch-oriented layouts.
- Textareas have fixed responsive dimensions and scroll internally.

## Persistence and sync

The browser commits edits to IndexedDB before attempting the network. A durable outbox coalesces pending changes by note. The Express server is authoritative after synchronization and stores notes in SQLite.

Each note has a monotonically increasing version. Mutations include the version the editor started from. If another device has changed the note, Shelf retains the server version and creates a separate local conflict copy rather than silently overwriting content.

The interface reports local, syncing, synced, offline, and failure states separately. It never claims an edit is synced before receiving server confirmation.

## PWA behavior

The manifest provides installation metadata. The service worker precaches the application shell and caches successfully retrieved note images. Notes and pending image blobs live in IndexedDB.

The app retries synchronization on saves, reconnection, foregrounding, explicit requests, and a short foreground polling interval. It does not promise background execution after a mobile OS suspends it.

## Deployment boundary

The production unit is one Docker container plus one persistent volume. Tailscale Serve terminates HTTPS and proxies to a loopback-only port. No separate reverse proxy, database container, Redis instance, queue, or background worker is required.
