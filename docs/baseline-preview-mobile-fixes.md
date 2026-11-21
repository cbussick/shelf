# Baseline preview and mobile title fixes

Implemented at `3361e9a`, integrated as patch-equivalent `6929fe2` on main.
Original task base: `302e22f`. Delivery reconciliation with `89495b9` preserves
all three changed files' baseline-fix content; the separate touch-pin test update
is retained. No save, offline or authentication ownership was changed.

## Diagnosis and regression

The two 390px/1280px preview assertions expected the complete body in card DOM.
README documents a 512-character excerpt. Assertions now require the exact
511-character body prefix plus ellipsis, retain title/body two/four-line layout
limits, and reload before opening to verify complete saved title and body.
Both obsolete assertions failed before correction and passed afterwards.

The preserved mobile failure trace showed an empty title immediately after
Title.fill, with `Tall note 8` inserted into the body instead. The next body fill
replaced it, explaining the eventual title-less card without save-time data loss.
Deferred editor reveal autofocus ignored all focusin events as user interaction.
A focused form field now counts as intent before its first input event, preventing
body autofocus from redirecting the first keystroke.

The new clock-controlled browser regression focuses Title before the real deferred
editor mount, releases initialization, requires retained focus, then types and
checks title/body persistence after reload. It failed at retained focus on unchanged
current baseline, then passed with the fix. The original mobile scenario initially
passed 31 serial baseline repetitions: these passes alone were not treated as proof
of resolution. No timeouts, retries, skips or tolerances were weakened.

## Validation and review

On the original reviewed fix tree: fresh npm ci; lint, typecheck, build, normal and
production Knip, and high-severity audit gate passed. Knip retained its existing
redundant-entry hint; audit retained four moderate findings. All 85 unit tests and
248 browser tests passed across a 175-case run interrupted by the tool deadline
and a validated 73-case continuation. This was not an uninterrupted green npm test
exit. An initially malformed continuation list accidentally repeated 122 passing
cases before correction; it is not counted as additional coverage. Original mobile
scenario and deterministic regression each passed five subsequent repetitions.
Two fresh independent read-only local Pi reviews reported no actionable findings.

Reconciliation introduces no runtime changes relative to fetched main. Existing
passed checks are reused; bounded delivery smoke covers the deterministic title
regression, both preview widths, both create-control widths and current touch pins.
Real mobile keyboard/IME behavior remains outside these desktop-browser guarantees.
No causal claim or unrelated fix is made for historical selector/cursor flakes.

Disposable task installation, build/test output, traces, review scratch and logs
are removed after successful delivery. Historical migration evidence owned by
other tasks, shared caches and unrelated work are not cleanup targets.
