# Loading motion concept — preview only

**Direction:** a little note catching a little air. Use Shelf’s existing folded-note
mark rather than introducing a new feather identity. The artwork is already real
SVG in `public/assets/favicon.svg`; the header currently reconstructs it in CSS
(`Brand` in `src/client/components/Auth.tsx`). This preview copies the SVG geometry
exactly, splitting the two ink strokes solely to animate their opacity separately.
If approved, consolidate the artwork in one shared component instead of keeping
independent inline copies.

Open `index.html` through a local HTTP server; `?clean` hides the preview controls.
`preview.gif` is a browser-rendered, looping motion sample, not the full-screen
layout. Run from the task worktree:

```sh
python3 -m http.server 4178
# http://localhost:4178/docs/previews/loading/index.html
node docs/previews/loading/verify.mjs
# To regenerate preview.gif as well:
node docs/previews/loading/verify.mjs --render
```

## Motion

Purpose: **state indication** during occasional cold startup, not decoration during
ordinary note interactions. CSS only; no new runtime dependency.

- 3.2-second seamless loop, starting movement immediately.
- Whole note rises 4.4 CSS pixels at the displayed 88-pixel size and tilts from
  −3° to +3°, then returns. Geometry, fold and silhouette stay intact.
- Ink opacity breathes from 1 to 0.55; second line trails by 160 ms.
- Movement and opacity use `cubic-bezier(0.77, 0, 0.175, 1)`.
- Animate only transform/opacity. The long duration is a quiet repeating loading
  indicator, not a delayed UI entrance or exit.
- The visible “Opening Shelf…” text stays in place. A soft highlight sweeps left
  to right across the letters using a translated SVG gradient clipped to the text,
  linearly over 2.56 seconds, then rests offscreen for 0.64 seconds. The base text
  remains readable throughout; no skeleton bar replaces the loading message.
- “Opening Shelf…” also remains available to screen readers as one text label;
  the visual SVG copy is decorative.
- OS reduced-motion preference, or the preview toggle, leaves both the mark and
  loading text completely static.
- No spinner, fake percentage, growing dots, or full-screen zoom/fly-away exit.

Feel-check: watch the live preview on a phone, including fast completion. The GIF
has 80 ms frame intervals; the live CSS preview is the smoothness reference.

## Fernblick findings

Read from `/root/cb-coding/herdr-fernblick`:

- `src/app/App.tsx`: connection errors and pending-but-paused/offline requests get
  explanatory states **before** the initial-pending loading branch. Background
  fetching does not bring the splash back.
- `src/shared/ui/LoadingBrand.tsx` and `.module.css`: shared loading artwork and a
  3.2-second label opacity pulse.
- `src/shared/ui/ScoutLogo.module.css`: immediate first pupil movement, then an
  8-second glance/rest loop; reduced motion disables animation.
- `design/branding/README.md`: **no minimum splash timer**. Loading ends as soon as
  the initial dashboard request settles. Header branding stays static.

Adopt those lifecycle rules, not the mascot motion. Shelf currently shows
`Loading` during the auth query’s `isPending` branch in `src/client/App.tsx`.
React Query can be pending *and paused* when offline, so pending alone must not
mean an endlessly animated splash. On implementation, explicitly handle paused
startup and retain local-note access, authentication and error recovery. Do not
expand the splash to cover background note synchronization. No artificial delay,
no waiting for a loop to finish; remove it immediately on readiness or failure.
The standalone preview’s timers only simulate request durations.

## Scope and verification

No application code, installed icons, service worker, or dependencies changed.
This is an approval artifact, not an integrated loading component.

`verify.mjs` checks mobile/desktop overflow, active animations, left-to-right
shimmer direction, accessible loading text, 250 ms simulated completion, immediate
interruption, replay, both reduced-motion modes (including shimmer), and browser
errors. It can render the checked-in GIF from the exact preview CSS. Real-device
motion feel and the eventual app’s auth/offline lifecycle still require testing
when integrated.
