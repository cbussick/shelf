# Shelf

A small, private, self-hosted notes app for text, images, and audio. It is designed for one owner and works across desktop, tablet, and phone.

## Stack

- React, TypeScript, Vite, StyleX, and TanStack Query
- Express and TypeScript
- SQLite for notes, sessions, and attachment metadata
- Filesystem storage for image and audio bytes
- Zod parsing at environment, HTTP, browser-storage, and API boundaries
- IndexedDB and a service worker for local-first editing and offline startup
- Docker Compose for deployment

## What it supports

- Create, edit, search, pin, color, and permanently delete notes
- Rich-text note bodies backed by Markdown, including nested lists and clickable task checkboxes
- Up to six JPG, PNG, WebP, or GIF images per note
- Audio uploads up to 100 MB each, with no fixed audio count limit per note
- Microphone recording with preview, keep/discard, and a 30-minute limit
- Audio playback on note cards and an audio list alongside images in the editor
- Local-first saving with an honest sync status
- Offline startup after the first successful visit
- Offline note creation and editing; queued changes sync while Shelf is open and connected
- Conflict protection that preserves the local edit as a conflict copy
- Installable PWA on supported browsers and operating systems
- Android share-sheet target for screenshots and other JPG, PNG, WebP, or GIF images
- One owner password with revocable, server-side sessions

The app deliberately has no labels, archive, reminders, trash, sharing, or multi-user administration. Checklists are Markdown task lists within ordinary notes.

## Run locally

Requirements: Node.js 24+ and npm.

```bash
npm install
npm run dev
```

Open `http://localhost:4273`. The first visit asks you to create the owner password. Development data is written to `./data`.

Useful checks:

```bash
npm run typecheck
npm run knip
npm run knip:production
npm test
npm run build
npm run audit
```

Both Knip modes check unused code and dependencies. See [the audit notes](docs/knip-audit.md)
for runtime roots, retained APIs, and verification limitations.

## Deploy with Docker Compose and Tailscale Serve

Build and start the application:

```bash
docker compose up -d --build
```

Compose publishes Shelf only on the VPS loopback interface at `127.0.0.1:3000`. It is not exposed on the VPS's public interfaces.

Expose it privately to your Tailnet with HTTPS:

```bash
tailscale serve --bg localhost:3000
```

Use the `https://…ts.net` URL reported by Tailscale. HTTPS is required for installation, service-worker functionality, and microphone recording (localhost is allowed for development). Do not use Tailscale Funnel unless you intentionally want public internet access.

The first visit creates the only owner account. There are no default credentials.

## Persistent data and backups

The `shelf-data` Docker volume contains:

```text
/data/shelf.sqlite
/data/shelf.sqlite-wal
/data/shelf.sqlite-shm
/data/images/
/data/audio/
```

Back up the database, image directory, and audio directory together. `/data/uploads/` holds temporary request files, not saved attachments; it is cleared on startup. The safest simple procedure is:

```bash
mkdir -p backups
docker compose stop shelf
docker run --rm -v shelf-data:/data:ro -v "$PWD/backups:/backup" \
  alpine tar czf "/backup/shelf-$(date +%F-%H%M%S).tar.gz" -C /data .
docker compose start shelf
```

Test restoring backups periodically. Browser storage is a convenience for offline work, not a backup.

### One-time migration from jot

Do this once before starting this release against an existing deployment. The live installation used Compose project `sticky-notes-app`, service `jot`, and volume `jot-data`. **Do not start the new service with an empty volume**: it would prompt to set up a new owner. Unsynced edits and incoming share drafts in browsers are not migrated; open the old app on each device and wait for **Synced** first if they matter. Devices must sign in again after the cookie rename.

```bash
# On the server, confirm the source exists before Docker can create an empty one.
docker volume inspect jot-data
# Stop the old container to checkpoint SQLite and free port 3000.
docker stop sticky-notes-app-jot-1
mkdir -p "$HOME/backups/shelf"
docker run --rm -v jot-data:/data:ro -v "$HOME/backups/shelf:/backup" \
  alpine tar czf "/backup/pre-migration-$(date -u +%Y%m%dT%H%M%SZ).tar.gz" -C /data .

# Copy the old volume, preserving file ownership. Rename the database and any
# SQLite sidecars together. The old volume and stopped container are rollback points.
docker volume create shelf-data
docker run --rm -v jot-data:/old:ro -v shelf-data:/new alpine sh -ec '
  test -s /old/jot.sqlite
  cp -a /old/. /new/
  for path in /new/jot.sqlite*; do
    [ -e "$path" ] || continue
    mv "$path" "/new/shelf.sqlite${path#/new/jot.sqlite}"
  done
  test -s /new/shelf.sqlite
'

docker compose up -d --build
# Confirm `docker compose ps` is healthy and that your notes and images load.
# Once verified, remove the stopped old container; retain jot-data for rollback.
docker rm sticky-notes-app-jot-1
```

The new Compose project, service, and volume are all named `shelf`. The PWA keeps the same URL and scope; installed copies still receive update prompts. If the cutover fails, stop `shelf` (`docker compose stop shelf`) and restart the old container (`docker start sticky-notes-app-jot-1`) before removing it.

## Updates

```bash
git pull
docker compose up -d --build
```

The PWA downloads frontend updates in the background and offers a **Refresh app** button when one is ready. Finish editing before refreshing; updates never force a reload mid-note. If an older installed version does not show the prompt, open `/share-target` in the browser (GET is a read-only page load). This URL bypasses the old worker's cached navigation and loads the latest page; you can then use **Refresh app** if offered. Close and reopen the installed app afterwards. Do not clear browser site data to update the app: that data may include unsynced notes.

Shelf keeps its page light and uses a dark green installed-app manifest theme. Android can cache installed-app metadata independently of frontend updates; see [Chrome's manifest-update guidance](https://web.dev/articles/manifest-updates#updates_on_chrome_for_android). Avoid uninstalling or clearing app data when there may be unsynced notes.

## Share screenshots from Android

On an Android phone or tablet, install Shelf from Chrome while connected to its HTTPS URL. In your screenshots or photos app, tap **Share → Shelf.** The image opens in a new note: add text or more images, then close the note to save it. Closing an empty draft without images does not create a note. Shares received offline can be saved on the device and will sync when Shelf is open and connected again. If the app was installed before this feature was deployed, you may need to reinstall it for Android to register the new share target.

This requires a browser that supports Web Share Target (such as Chrome on Android). iOS/iPadOS PWAs cannot currently appear in the system share sheet; use **Add an image** in Shelf instead.

## Add audio

Use the waveform **Add audio** button in the bottom toolbar or an open note. Choose **Upload audio file** or **Record with microphone**. Files may be MP3, M4A, WAV, Ogg/Opus, audio-only WebM, FLAC, or AAC, up to 100 MB each. There is no fixed number of audio attachments per note; the six-image limit is unchanged. Uploaded originals are preserved, with no conversion or transcription. Browser playback depends on the file's codec; use **Download** if your browser cannot play it.

For microphone capture, allow the browser's microphone permission, then start, stop, preview, and choose **Add to note** to attach the recording or **Discard** to discard it. Close the note to save attachments on the device and queue synchronization. Recording stops at 30 minutes or the file-size limit. Keep Shelf in the foreground: switching apps, locking the device, or losing the microphone can interrupt capture. If Shelf detects that it has left the foreground, it stops capture and offers the recorded portion for review. A closed or killed browser may lose an unkept recording.

One player appears on each note card; notes with several recordings offer a count that opens the full list. Playback never starts automatically, and starting another player pauses the previous one. Audio added on a device remains available there offline after sync, subject to browser storage availability. Audio from other devices is streamed when played, not automatically downloaded or kept offline. The Android share target remains image-only; use the file picker for audio on any device.

## Sync behavior

Conflict copies include the newest local edit and any available attachments. If another device has already deleted an attachment that was never downloaded here, its bytes cannot be recovered: Shelf reports this, preserves the remaining edit, and records the missing filename in the copy's body when there is room. This does not block other notes from syncing.

Drag a note by its top-left handle to reorder it within Pinned or Other notes. The handle also supports arrow keys. Order is saved locally first and synced across devices; moving a note does not change its edit date. Newly created notes appear first. When searching, only visible notes can be used as drop targets.

Edits are committed to IndexedDB first and sent to the server immediately when possible. The header distinguishes **Saved on device**, **Syncing…**, **Synced**, and failure/offline states. Open the sync status to see the latest error message and HTTP status, when available. Error details remain available during retries and clear when the server connection recovers and sync completes successfully.

Mobile operating systems can suspend web apps after they are backgrounded. An edit made offline may therefore remain only on its original device until Shelf is opened again with connectivity. Incoming shares are temporary on-device drafts (not notes) until saved, and expire after 24 hours.

## Icon licenses

UI icons use explicitly imported components from `lucide-react`. Lucide's ISC license and the MIT notice for Feather-derived icons are preserved verbatim from the installed package in [public/THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt). The notices ship with the app at `/THIRD_PARTY_NOTICES.txt` and are precached for offline access. When upgrading Lucide, update that file from the package's `LICENSE` (the browser test checks they match). Shelf's custom brand mark is unchanged.

## Security notes

- Keep the app restricted to the Tailnet.
- Authentication remains enabled as defense in depth.
- Passwords use Argon2id; raw session tokens are never stored in SQLite.
- Cookies are HTTP-only and SameSite Strict; production cookies are Secure behind HTTPS.
- Images are limited by count, bytes, decoded dimensions, and detected file contents. Audio is streamed to private temporary files, limited to 100 MB per file, and checked for an actual audio stream before being stored. Playback and downloads require authentication.
- API mutations reject cross-site browser requests.
- SQLite queries are parameterized and API inputs are parsed with Zod.
