# Afterlife Sonar

**Status:** MVP built, awaiting hardware testing
**Issue:** None yet
**Owner:** Rin Meng
**Last updated:** 2026-11-27

## Goal

A `/sonar` page turns a MacBook's built-in speakers and mic into an ultrasonic Doppler sonar: wave left and a LEFT button fires, wave right and RIGHT fires. No camera, no install, no extra hardware. It gives Microsoft Research's 2012 SoundWave technique an afterlife as a link that works on any laptop. Background, prior art and the physics are in [research.md](research.md).

## Scope

- In: Start/Stop/Calibrate controls and a status badge; frequency sweep plus 3 s stillness calibration; stereo two-tone LEFT/RIGHT detection with a push/pull fallback mode; noise gating (guard band, proximity, debounce, continuous-motion block, cooldown, typing pause, tab hidden); LEFT/RIGHT buttons that also respond to the arrow keys; live spectrum and velocity canvases; collapsible debug and settings panels, with settings saved to localStorage.
- Out: learned gestures (DTW), presence lock, chirp ranging, a browser extension, real apps on top (slides, recipe scrolling). Add these only once LEFT and RIGHT work reliably.

## Areas affected

- [ ] Database: none
- [ ] Server: none. `app/sonar/page.tsx` is a Server Component shell only
- [ ] UI: new `app/sonar/page.tsx`, `components/sonar/*`, `hooks/use-sonar.ts`; one line in `components/Navbar.tsx` (`{ href: '/sonar', label: 'Sonar' }`)
- [ ] Auth: none. `/sonar` stays public
- [ ] Config / env vars: none
- [ ] Types and libs: new `lib/types/sonar.ts` (re-exported from `lib/types/index.ts`, one line), new `lib/sonar/*`

## Approach

Everything runs in the browser on the Web Audio API, with no dependencies added and no external requests.

1. **Audio engine** (`lib/sonar/audio-engine.ts`): a 48 kHz `AudioContext` (the actual rate is read back), two sine oscillators split across left and right with a `ChannelMergerNode`, and a mic stream with echo cancellation, noise suppression and auto gain all off, feeding an `AnalyserNode` (fftSize 4096, smoothing 0).
2. **DSP** (`lib/sonar/dsp.ts`, pure functions): SoundWave's bandwidth scan per tone (10% threshold, 30% second-peak rule) measured against a calibrated baseline, plus a sideband-energy z-score for proximity.
3. **Calibrator** (`lib/sonar/calibrator.ts`): sweeps 17 to 21 kHz to pick tone L and tone R (at least 1.2 kHz apart, SNR ≥ 25 dB), then captures stillness statistics, with slow drift correction afterwards.
4. **Gesture detector** (`lib/sonar/gesture-detector.ts`): gating layers, then a state machine. Mode A compares burst onsets on the two tones (L first = RIGHT). Mode B uses the signed push/pull shift. Emits `left`, `right`, `motion` and `status` events.
5. **React** (`hooks/use-sonar.ts`, `components/sonar/*`): the per-frame loop stays in refs and draws canvases directly. React state gets only status, counters and a debug snapshot at about 10 Hz. `'use client'` is limited to `SonarApp.tsx` and its children. The UI uses `<Text>`, `useToast()` and shadcn components (Button, Card, Badge, Slider, Switch, Select, Tabs, Collapsible), with `render` instead of `asChild`.

The full spec, with every constant and default, is the one-shot prompt at the end of [research.md](research.md#one-shot-mvp-prompt-for-claude). Build from that prompt.

## Data model

None. Settings live in the browser's localStorage only.

## Plan

All commits go on `feature/afterlife-sonar` and ship as one PR, since the page is self-contained in new files. Each step is a commit that passes `pnpm check` on its own.

1. [ ] Hardware check: show the spectrum view on every teammate's laptop and pick the demo laptop (hour 0 to 1)
2. [x] Stereo test: does a left-to-right wave reliably hit tone L before tone R? Choose Mode A or Mode B as the default (hour 1 to 3)
3. [x] `feat(sonar): add audio engine and calibration` (types, constants, dsp, audio engine, calibrator)
4. [x] `feat(sonar): add gesture detector` (gating, state machine, events)
5. [x] `feat(sonar): add sonar page ui` (hook, components, page, Navbar link)
6. [ ] Tune the noise layers with the dancing test (hour 8 to 12)
7. [ ] Stretch: one real app on top, such as slide control or recipe scrolling (hour 12 to 18)
8. [ ] Polish, rehearse the demo script in [research.md](research.md#demo-script-about-2-minutes), and record a backup video (hour 18 to 24)
9. [ ] Open the PR (#PR)

## Decisions

- 2026-11-27: Chrome on a MacBook with built-in speakers and mic is the only supported setup. Safari filters high frequencies (WebKit bug 192932), and Firefox historically ignored `echoCancellation: false`.
- 2026-11-27: Detection uses hand-written rules, not machine learning. Debounce, cooldown and gating thresholds come from SoundWave.
- 2026-11-27: The sweep glides the oscillators (phase-continuous, click-free) instead of a 50 ms gain dip per step, since a dip wouldn't fit an 80 ms step. It also runs the analyser at fftSize 2048, so each 80 ms step clears the previous candidate (a 4096 window is 85 ms).
- 2026-11-27: The continuous-motion block tolerates 200 ms gaps in a tone's motion, because Doppler crosses zero each time a waving hand reverses.
- 2026-11-27: Form labels use the shadcn `Label`, because `Text` doesn't accept `htmlFor`.
- 2026-11-28: Mode B (push/pull) is the default. In testing on the demo MacBook, tone L crossed its threshold first on almost every wave whichever way the hand moved (16 RIGHT, 2 LEFT, 9 ambiguous), so Mode A's onset order measured tone sensitivity, not hand position. Push/pull gave clean triggers (shifts of +4 to +15 bins for pushes, -3 to -14 for pulls).
- 2026-11-28: After a trigger, the opposite direction is locked out for 1200 ms (`returnLockoutMs`) so the hand's return stroke doesn't fire. Cooldown is 900 ms and the continuous-motion limit 4000 ms, both raised after testing.
- 2026-11-28: Tried and reverted a "reversal gap" rule for push/pull. One- or two-frame sign flickers inside a single gesture tripped it, so it threw away most real gestures.
- 2026-11-27: Only new files, plus one line each in `components/Navbar.tsx` and `lib/types/index.ts`, so the work never conflicts with other teams' branches.

## Open questions

- Can Mode A be rescued for real left/right swipes? Ideas not yet built: measure each tone against its own stillness noise instead of its peak (tone R's loud direct signal raises its bar), time each tone's peak disturbance instead of its first threshold crossing, and stop auto-pick choosing tones above about 20.5 kHz (it always picks 21 kHz, where the echo is weakest).
- In push/pull mode, a fast approach to get into position reads as a push and fires RIGHT. The workaround is technique: bring the hand in slowly, hold still, then push or pull.
- Should there be a GitHub issue for this work, to link from the PR?

## Done when

- [ ] After Start and Calibrate in Chrome on a MacBook, both tone peaks show in the spectrum panels and most adults can't hear the tones
- [ ] Holding still for 10 s fires nothing
- [ ] A left-to-right wave about 20 cm above the keyboard fires RIGHT and a right-to-left wave fires LEFT (or the reverse with Invert on)
- [ ] Clapping, jingling keys and typing fire nothing
- [ ] A person moving 2 m behind the laptop fires nothing, and 5 s of continuous waving shows "Too much motion"
- [ ] Stop silences the tones with no click, switching tabs pauses detection, and leaving `/sonar` releases the mic
- [x] `pnpm format`, `pnpm check` and `pnpm build` pass
