# Afterlife Hackathon: Laptop Sonar Research + MVP Prompt

> Copied from the Claude Doc [Afterlife Hackathon: Laptop Sonar Research + MVP Prompt](https://claude.ai/artifact/QBgVdKb2GWcTnVrziDLHW7) (rev 10, 2026-11-27). The doc is the working copy; update this file if the doc changes. The plan built from it is in [plan.md](plan.md).

2026-11-27 · Rin Meng

## TL;DR

It's feasible: a working MVP in Chrome on a MacBook is roughly a one-day build. The technique was proven in a 2012 Microsoft Research paper (SoundWave), it was tested on MacBook Pros, and an open-source browser version already exists.

- **What it is:** play an inaudible tone (about 18 to 20 kHz) through the speakers, listen with the mic, and read hand motion from the Doppler shift in the echo. No camera, no extra hardware.
- **Biggest risk is novelty, not physics.** Ultrasound presence detection has existed since 2009, and Lenovo ships ultrasound "lock on leave" on some laptops. Judges may know this.
- **The angle that fits Afterlife:** SoundWave was a 2012 research idea that never reached normal people. We resurrect it as a web page that works on any laptop, with no install, plus real apps built on top.
- **Hard technical constraints:** Chrome only (Safari filters high frequencies, Firefox historically ignored the flag that keeps the tone), laptop speakers and mic only (no AirPods or headphones), and motion only (a person sitting still is invisible).
- **Demo winner:** a teammate dances behind you while you gesture, and only your hand triggers it.

## Prior art

The core idea is well proven; what's missing is a polished, everyday product that runs on any laptop from a link. That gap is our project.

| Project                                                                                                                                              | Year         | What it showed                                                                                                                                                               | Relevance to us                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Elliptic Labs / Lenovo lock on leave](<https://download.lenovo.com/manual/p16v_g2/ug/html_en/en/Lock_on_leave_function_(for_selected_models).html>) | Shipping now | Ultrasound presence detection that locks the laptop when you leave, on selected Lenovo models ([background](https://www.engineering.com/is-your-laptop-watching-your-back/)) | Proves it's real. Also our main "isn't this done?" objection: it's vendor-locked to specific hardware                                                                        |
| [Intel Wi-Fi Doppler presence](https://arxiv.org/html/2603.10845v1)                                                                                  | 2026         | Same lock-on-leave goal using the laptop's Wi-Fi card instead of sound                                                                                                       | Shows the industry still treats presence sensing as unsolved                                                                                                                 |
| [Multiwave (UCF)](https://www.eecs.ucf.edu/~jjl/pubs/multiwave_gi2017_final.pdf)                                                                     | 2017         | Doppler gestures in multiple dimensions with extra speakers and ML                                                                                                           | A richer gesture set needs more hardware than a laptop has                                                                                                                   |
| [FingerIO (UW)](https://fingerio.cs.washington.edu)                                                                                                  | 2016         | Active sonar on a phone tracks a finger in 2D to about 8 mm using OFDM signals                                                                                               | Ceiling of what's possible; too complex for a hackathon                                                                                                                      |
| [doppler.js (Daniel Rapp)](https://github.com/danielrapp/doppler.js)                                                                                 | 2015         | Browser version of SoundWave: 20 kHz tone, mic FFT, page-scroll demo. MIT license                                                                                            | Our starting reference. Simple bandwidth scan, no second-peak handling, no gesture logic ([Hackaday](https://hackaday.com/2015/03/13/doppler-gesture-sensing-in-javascript)) |
| [SoundWave (Microsoft Research + UW)](https://modernmobile.cs.washington.edu/docs/soundwave.pdf)                                                     | 2012         | Laptop speaker + mic sense in-air gestures; 86 to 100% gesture accuracy across 11 computers including two MacBook Pros                                                       | The algorithm we're building. Its numbers are in the next section                                                                                                            |
| [Tarzia et al. sonar presence](https://users.cs.northwestern.edu/~pdinda/Papers/ubicomp09.pdf)                                                       | 2009         | Ultrasonic echoes from a laptop detect whether a user is present, tested with 20 volunteers                                                                                  | Presence detection predates gestures by three years                                                                                                                          |

How to frame it to judges: "This was solved in a 2012 paper and then forgotten. Only one laptop maker ships a version, locked to its own hardware. We gave the idea an afterlife: one link, any laptop, real everyday uses."

## How it works

A moving hand shifts the pitch of the echo by tens of hertz, and an FFT of the mic signal makes that shift visible as energy spreading out beside the tone's peak.

**The physics.** The echo travels out and back, so the shift is doubled:

```latex
\Delta f = \frac{2 v f_0}{c}, \qquad c \approx 343 \text{ m/s}
```

At f0 = 20 kHz, a normal wave (0.5 m/s) shifts about 58 Hz, and a fast flick (3 m/s) about 350 Hz. Positive shift means toward the laptop, negative means away.

**Frequency resolution.** Each FFT bin is:

```latex
\Delta f_{\text{bin}} = \frac{f_s}{N}
```

| Setting                       | Bin width | Window length | Slowest detectable hand (at 20 kHz) |
| ----------------------------- | --------- | ------------- | ----------------------------------- |
| SoundWave: 44.1 kHz, N = 2048 | 21.5 Hz   | 46 ms         | 18.5 cm/s                           |
| Ours, fast: 48 kHz, N = 2048  | 23.4 Hz   | 43 ms         | about 20 cm/s                       |
| Ours, fine: 48 kHz, N = 4096  | 11.7 Hz   | 85 ms         | about 10 cm/s                       |

Start with N = 4096 for finer motion; drop to 2048 if gestures feel laggy.

**What SoundWave measured** ([paper](https://modernmobile.cs.washington.edu/docs/soundwave.pdf)):

- A still tone occupies about 80 Hz (1 to 3 bins each side). A "motion event" is a spread of 4 or more bins.
- Each side of the peak is scanned outward until amplitude drops below 10% of the peak. Because it's relative, it adapts to volume.
- Fast motion can split off a second peak. If one appears with at least 30% of the tone's energy, the scan continues from it. doppler.js skips this step.
- The fastest hand they saw was 3.9 m/s; they bounded at 6 m/s, which is about 33 bins each side. So only a small window around the tone ever matters.
- A 500 ms automatic frequency sweep picks the best tone per device, usually 18 to 19 kHz.
- Range is roughly 1 m, controlled by speaker volume.

**The pipeline, per animation frame:**

1. Oscillator plays the tone through the laptop speakers.
2. Mic stream (processing off) feeds an AnalyserNode.
3. Read the spectrum in dB, convert to linear, look only at the window around f0.
4. Measure left and right bandwidth (10% rule, second-peak check) after subtracting a calibrated baseline.
5. Turn bandwidth into a signed velocity and an amplitude (proximity) per frame.
6. Gate it (noise, proximity, continuous motion), then feed a gesture state machine.
7. Fire app actions: scroll, next slide, pause, lock.

## Browser and hardware constraints

Build and demo in Chrome on a MacBook, using its built-in speakers and mic. Every other combination adds risk.

| Constraint      | What to do                                                                      | Why                                                                                                                                                                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser         | Chrome (or another Chromium browser)                                            | Safari filters out high frequencies even with echoCancellation off ([WebKit bug 192932](https://bugs.webkit.org/show_bug.cgi?id=192932)). doppler.js doesn't work in Firefox, which didn't honor echoCancellation: false ([doppler.js](https://github.com/danielrapp/doppler.js)) |
| Mic processing  | getUserMedia with echoCancellation, noiseSuppression, autoGainControl all false | Chrome's echo cancellation removes the speaker's own sound, which is exactly our signal. Turning all three off gives a flat response in Chrome ([measurement](https://cat-in-136.github.io/2020/10/gum-frequency-characteristic-depending-on-audio-parameters.html))              |
| macOS mic mode  | Set Mic Mode to Standard or Wide Spectrum, never Voice Isolation                | Voice Isolation uses ML to remove background sound ([Apple](https://support.apple.com/guide/mac-help/mchle82b42f0)) and may erase the tone                                                                                                                                        |
| Audio output    | Built-in speakers, volume around 70 to 100%                                     | AirPods, Bluetooth and headphones send the tone away from the mic. Volume sets the range                                                                                                                                                                                          |
| Sample rate     | Request AudioContext at 48 kHz, read the actual rate back                       | Keeps 20 kHz under the 24 kHz limit. Never hardcode the bin math                                                                                                                                                                                                                  |
| FFT             | AnalyserNode, fftSize 4096, smoothingTimeConstant 0                             | fftSize goes up to 32768 ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize)). The default smoothing (0.8) blurs fast gestures                                                                                                                          |
| Autoplay policy | Start audio from a button click                                                 | Browsers block audio that starts without a user gesture                                                                                                                                                                                                                           |
| Secure context  | Serve over localhost or HTTPS                                                   | getUserMedia doesn't work from a file:// page                                                                                                                                                                                                                                     |
| Device variance | Run a frequency sweep at startup (17 to 21 kHz)                                 | Some laptops filter above 18 kHz ([SoundWave](https://modernmobile.cs.washington.edu/docs/soundwave.pdf)). Test every teammate's machine on day one                                                                                                                               |
| Hearing         | Prefer 19 to 20 kHz                                                             | Kids, some young adults and pets can hear 18 kHz                                                                                                                                                                                                                                  |
| Typing          | Pause detection while keys are pressed                                          | Laptop mics sit next to the keyboard. SoundWave disabled sensing during typing                                                                                                                                                                                                    |

Open question: Apple doesn't publish the MacBook mic's response above 20 kHz. SoundWave worked on 2012 MacBook Pros, but test yours with the spectrum view before writing any gesture code.

## Baseline, left vs right, and rejecting noise

A single tone and a single mic only measure motion toward or away from the laptop, so a left vs right wave needs two tones, one per speaker. Baselines and noise rejection are rules, not machine learning.

### Left vs right needs stereo

A hand swiping sideways approaches and then recedes whichever way it goes, so with one tone "left" and "right" look the same. The fix uses the MacBook's left and right speakers:

- Play tone L (for example 18.5 kHz) only on the left speaker and tone R (20 kHz) only on the right, using a ChannelMergerNode.
- A hand moving left to right disturbs tone L first and tone R a moment later. The order of the two motion bursts gives the direction.
- Keep the tones at least 1 kHz apart. Each needs about ±400 Hz of room, so their windows never overlap.
- This is the riskiest assumption in the project. Test it in hour one. Fallback: map push toward = right (next) and pull away = left (back), which a single tone handles reliably.

### Setting the baseline (calibration)

1. **Frequency sweep (about 0.5 s):** step from 17 to 21 kHz and keep the highest tones that give a strong, clean peak. SoundWave required the peak to be at least 3 dB above the next-highest peak.
2. **Stillness capture (2 to 3 s):** ask the user to keep still. For every bin in each tone's window, record the mean and standard deviation of the linear magnitude. Desk, walls and the user's body all end up in here.
3. **Per frame:** subtract the mean and divide by the standard deviation (a z-score). A bin counts as moved when it's more than about 3 standard deviations above its baseline.
4. **Drift:** when nothing has moved for a few seconds, slowly blend new frames into the baseline (a moving average). Re-run calibration on demand.

### Learning a user's own gestures (optional upgrade)

You don't need samples for the MVP: hand-written rules handle a wave. But you can let users teach gestures:

- **Record:** the user performs a gesture 5 times. Each take is a roughly 1 s sequence of per-frame features, such as velocity and energy for tone L and tone R.
- **Also record "nothing":** 10 seconds of normal fidgeting and typing, as a reject class.
- **Classify:** compare a new motion to every template with dynamic time warping (DTW), which tolerates the same gesture being done faster or slower. Pick the nearest template, and reject if it's too far away or closer to "nothing".
- Few-shot, runs in the browser, no training step. Good stretch goal, not day one.

### Rejecting noise and incidental motion

Layer these, cheapest first:

| Layer                   | Rule                                                                                   | Stops                                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Band window             | Only analyse ±400 Hz around each tone                                                  | Voices, music, fans (almost all below 15 kHz)                                                                              |
| Relative threshold      | Bandwidth measured at 10% of the tone's own peak                                       | Volume changes; music playback didn't hurt SoundWave                                                                       |
| Guard band              | Energy rising at 16 to 17 kHz at the same moment = broadband noise, skip the frame     | Claps, keys jingling, crinkling bags                                                                                       |
| Proximity               | Require a minimum echo strength (echoes weaken roughly with distance to the 4th power) | People moving across the room                                                                                              |
| Debounce                | Require 4 or more consecutive motion frames                                            | Random spikes. SoundWave saw 2.5 to 6 false events a minute; requiring 4 frames (about 185 ms) removed every false gesture |
| Continuous-motion block | Motion lasting more than 2 to 3 s suspends triggers                                    | Dancing, walking around                                                                                                    |
| Cooldown                | 600 to 800 ms after each trigger                                                       | Double fires                                                                                                               |
| Typing pause            | Ignore 500 ms after any keydown                                                        | Keyboard noise next to the mic                                                                                             |
| Arming (stretch)        | Hold the hand still near the laptop for about 1 s before a gesture counts              | Everything else, at the cost of one extra step                                                                             |

## MVP scope, build plan and demo

The MVP is one web page: wave left and a LEFT button lights up and fires, wave right and RIGHT fires. Everything else is a stretch goal.

### In the MVP

- Start button (unlocks audio and the mic) and a status line: listening, calibrating, armed, cooldown.
- Calibration: frequency sweep, then 3 s of stillness.
- Two big on-screen buttons, LEFT and RIGHT, that flash and count up when triggered (also callable with the arrow keys, so the app logic can be tested without sonar).
- A live spectrum view of each tone's window, plus a velocity trace. This is the debug tool and the most impressive thing on stage.
- A tuning panel: thresholds, debounce frames, cooldown, tone frequencies, and a mode switch between stereo order (left/right) and push/pull fallback.

### Not in the MVP

Learned gestures (DTW), presence lock, chirp ranging, the browser extension, real apps (slides, recipes). Add them only after LEFT and RIGHT work reliably.

### Build plan (assuming a 24-hour hackathon)

1. **Hour 0 to 1:** run the spectrum view on every teammate's laptop. Confirm the tone peaks show up and smear when you wave. Pick the demo laptop.
2. **Hour 1 to 3:** test stereo. Does a left-to-right wave reliably hit tone L before tone R? Decide: stereo mode or push/pull fallback.
3. **Hour 3 to 8:** calibration, bandwidth scan, debounce, and the LEFT/RIGHT buttons.
4. **Hour 8 to 12:** noise layers (guard band, proximity, continuous-motion block, typing pause). Tune with the dancing test.
5. **Hour 12 to 18:** one real app on top, such as slide control or hands-free recipe scrolling.
6. **Hour 18 to 24:** polish the visuals, rehearse the demo, record a backup video in case the venue is too loud.

### Demo script (about 2 minutes)

1. "Every laptop has a sonar it's never used." Show the inaudible tone's peak on screen.
2. Wave, and the peak visibly smears. Explain Doppler in one sentence.
3. Wave left and right; the buttons fire.
4. A teammate dances behind you. Nothing fires until you gesture.
5. Close on the Afterlife line: a 2012 research idea that never shipped to everyone, now a link that works on any laptop.

## One-shot MVP prompt for Claude

Run this in Claude Code from a fresh clone of `rinmeng/hackattack`. It keeps every commit on `feature/afterlife-sonar`, follows the repo's AGENTS.md conventions, builds the page at `/sonar` in new files only, and asks before pushing.

```markdown
You are working in the `rinmeng/hackattack` repo (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui base-lyra on Base UI, pnpm). Read `AGENTS.md` first and follow every convention in it. Build a working MVP of "Afterlife Sonar": a page that turns a MacBook's built-in speakers and microphone into an ultrasonic Doppler sonar. Waving a hand to the LEFT fires a LEFT button and waving to the RIGHT fires a RIGHT button.

## Git rules (strict: this repo holds several teams' ideas)

- Before touching any file: `git checkout main && git pull origin main && git checkout -b feature/afterlife-sonar`. If that branch already exists, check it out and pull it instead.
- ALL work and ALL commits go on `feature/afterlife-sonar` only. Never commit to `main` or any other branch. Never merge, rebase onto, cherry-pick into or force-push any other branch.
- Do not open a pull request unless I ask. When pushing, push only this branch: `git push -u origin feature/afterlife-sonar`.
- Keep the change self-contained so it never conflicts with other ideas: put everything in new files. Only two existing files may change, by one line each: add `{ href: '/sonar', label: 'Sonar' }` to `navLinks` in `components/Navbar.tsx`, and add `export * from './sonar';` to `lib/types/index.ts`. Do not touch `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/ui/`, `package.json` or the lockfile. Add no dependencies: everything here is the Web Audio API plus what's already installed.
- Commit in small logical steps with Conventional Commits, for example `feat(sonar): add audio engine and calibration`, `feat(sonar): add gesture detector`, `feat(sonar): add sonar page ui`.

## File layout

- `lib/types/sonar.ts`: all sonar types (settings, calibration result, per-frame tone data, gesture events, status). Re-export it from the `lib/types` barrel the same way `auth` and `toast` are.
- `lib/sonar/constants.ts`: every default and constant, each commented with where it comes from.
- `lib/sonar/dsp.ts`: pure functions (dB to linear, bin math, peak find, bandwidth scan with the second-peak rule, energy ratio, z-score). No DOM, no Web Audio, so it's easy to reason about.
- `lib/sonar/audio-engine.ts`: AudioContext, stereo oscillators, mic stream, AnalyserNode, start/stop/dispose.
- `lib/sonar/calibrator.ts`: frequency sweep and stillness capture.
- `lib/sonar/gesture-detector.ts`: per-tone tracking, gating and the gesture state machine. Emits events.
- `hooks/use-sonar.ts`: a client hook that owns the engine lifecycle (create on Start, dispose on unmount) and exposes status, settings, latest frame data, counters and `on(event, fn)`.
- `components/sonar/`: `SonarControls.tsx`, `GestureButtons.tsx`, `SpectrumCanvas.tsx`, `VelocityTrace.tsx`, `SonarSettings.tsx`, `SonarDebug.tsx`.
- `app/sonar/page.tsx`: a Server Component that renders the page shell and one client component (for example `components/sonar/SonarApp.tsx` with `'use client'`). Keep `'use client'` at the smallest leaf that needs it.
- UI rules from AGENTS.md: use `<Text>` for all typography, `useToast()` for toasts, shadcn components from `components/ui/` (Button, Card, Badge, Slider, Switch, Select, Tabs, Collapsible), never `asChild` (use `render`), path alias `@/`. Must render on the server without errors: no `window`, `navigator` or `AudioContext` access at module level or during render. Touch them only inside effects and event handlers.

## Context

- This is a hackathon project ("Afterlife: give old tech a second life"). It revives Microsoft Research's 2012 SoundWave technique (Gupta et al., CHI 2012): play an inaudible tone, read hand motion from the Doppler shift of its echo.
- Target: latest Chrome on a MacBook, built-in speakers at high volume, built-in mic, at http://localhost:3000/sonar.
- Physics: shift = 2 * v * f0 / c, with c = 343 m/s. At 20 kHz a 0.5 m/s hand shifts about 58 Hz; a fast 3 m/s flick about 350 Hz. Positive shift = moving toward the laptop.
- A single mono mic only senses motion toward or away. Left vs right comes from STEREO: tone L plays only on the left speaker, tone R only on the right. A hand moving left to right disturbs tone L first, then tone R. The ORDER of the two motion bursts gives the direction.

## Audio setup (get these details exactly right)

1. Everything starts from a "Start" button click (autoplay policy). Create `new AudioContext({ sampleRate: 48000 })`, then read back `ctx.sampleRate` and derive all bin math from it. Never hardcode 48000 after that.
2. Output: two `OscillatorNode`s (sine) -> a `ChannelMergerNode(2)` (oscillator L into input 0, oscillator R into input 1) -> a master `GainNode` -> `ctx.destination`. Ramp the gain over 50 ms when starting, stopping or changing frequency, to avoid audible clicks. Default master gain 0.6, adjustable.
3. Input: `navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } })`. Show the track's `getSettings()` in the debug panel. NEVER connect the mic to the destination (feedback).
4. Mic source -> `AnalyserNode` with `fftSize = 4096` (selectable: 2048, 4096, 8192), `smoothingTimeConstant = 0`, `minDecibels = -120`, `maxDecibels = 0`.
5. Each `requestAnimationFrame`: `getFloatFrequencyData`, convert dB to linear magnitude with `10 ** (dB / 20)`. Bin width = sampleRate / fftSize. Bin index for frequency f = Math.round(f / binWidth).
6. Run the per-frame loop outside React state. Keep frame data in refs and draw canvases directly. Push only low-rate values (status, counters, a throttled debug snapshot at about 10 Hz) into React state, so the page doesn't re-render 60 times a second.

## Calibration ("Calibrate" button, also runs automatically after Start)

1. **Frequency sweep (about 2 s total):** test candidates from 17,000 to 21,000 Hz in 250 Hz steps, one at a time on BOTH speakers, about 80 ms each (discard the first 30 ms after each change). Score each candidate by peak SNR in dB: the peak magnitude (max over ±2 bins) versus the median magnitude of bins 30 to 60 bins away. Pick tone R = the highest candidate with SNR >= 25 dB, and tone L = the highest candidate at least 1,200 Hz below tone R with SNR >= 25 dB. If nothing qualifies, show a clear warning ("Your speakers or mic may filter high frequencies. Use Chrome, turn the volume up, unplug headphones and AirPods, and set macOS Mic Mode to Standard, not Voice Isolation.") and fall back to 18,500 / 20,000 Hz. Allow manual override in the settings.
2. **Stillness capture (3 s):** with both tones playing, show "Keep still...". For each tone, record the mean and standard deviation of: left bandwidth, right bandwidth, sideband energy ratio. Also record the mean and std of guard-band energy (16,000 to 16,800 Hz, or a band 1,000 Hz below tone L if that's lower).
3. **Drift:** when no motion has been detected for 3 s, blend each frame into the baseline with an exponential moving average (alpha = 0.01).

## Per-frame DSP, per tone

1. Find the peak bin p = argmax within ±2 bins of the tone's bin. Peak amplitude A.
2. **Bandwidth scan (SoundWave method):** threshold = 10% of A (configurable). Step outward to the left from p-1, and separately to the right from p+1, while the amplitude stays above the threshold, up to maxBins = ceil(400 Hz / binWidth). **Second-peak rule:** after the scan stops, look further out on that side (still within maxBins). If any bin has amplitude >= 30% of A, jump to it and continue scanning from there. Result: leftBins, rightBins.
3. Shifts relative to baseline: dL = leftBins - baseline.leftMean, dR = rightBins - baseline.rightMean.
4. Signed shift in bins: s = dR - dL (positive = toward). Velocity estimate: v = (s * binWidth) * 343 / (2 * f0), shown in m/s on the trace.
5. Sideband energy ratio: E = (sum of linear magnitude across the side bins, excluding ±1 bin of the peak) / A. Proximity z-score: zE = (E - baseline.Emean) / max(baseline.Estd, epsilon).
6. A tone is "moving" this frame if max(dL, dR) >= minShiftBins (default 3) AND zE >= minProximityZ (default 3).

## Gating (all thresholds live-adjustable in the settings panel, with these defaults)

- **Guard band:** if guard-band energy z-score > 4 this frame, it's broadband noise (clap, keys). Mark the frame "noise" and ignore it.
- **Debounce:** a motion burst for a tone starts only after 4 consecutive "moving" frames. Record the burst's onset timestamp as the time of its FIRST moving frame.
- **Continuous-motion block:** if either tone has been moving for more than 2,500 ms in a row, suppress all triggers until both tones have been still for 1,000 ms. Status shows "Too much motion".
- **Cooldown:** 700 ms after any trigger.
- **Typing pause:** ignore 500 ms after any keydown, except the arrow keys used for manual testing.
- **Tab hidden:** pause detection and mute the tones when `document.hidden`; resume on return.

## Gesture logic

- **Mode A, stereo order (default):** when bursts start on BOTH tones within a 600 ms window, compare onsets. L before R by at least 30 ms = RIGHT. R before L by at least 30 ms = LEFT. Closer than 30 ms = ambiguous, no trigger (log it). Add an "Invert direction" switch, since speaker and mic placement may flip it.
- **Mode B, push/pull fallback:** use the average signed shift s across both tones. Sustained toward (s >= minShiftBins for 6 frames) = RIGHT; sustained away = LEFT.
- Mode switch in settings. Both modes go through the same gating.
- The detector exposes `on(event, fn)` / `off(event, fn)` with events `'left'`, `'right'`, `'motion'` (per-frame data) and `'status'`. The LEFT/RIGHT buttons subscribe through `useSonar`.

## UI (/sonar)

- Uses the app's existing theme, light and dark. Page title "Afterlife Sonar" and a one-line explanation.
- Controls: Start / Stop / Calibrate buttons and a status `Badge` (idle, calibrating, keep still, listening, noise, too much motion, cooldown).
- Center: two very large buttons, LEFT and RIGHT. On trigger they flash and scale for 300 ms and a counter increments. ArrowLeft / ArrowRight trigger them too, so the app logic can be tested without sonar.
- Visualization (canvas, 60 fps, sized for devicePixelRatio, colours read from the theme's CSS variables):
  1. Two spectrum panels, one per tone, showing ±500 Hz around the tone in dB, with the baseline mean drawn as a faint line, the 10% threshold line, and the scanned bandwidth shaded. Label axes in Hz.
  2. A scrolling 5 s velocity trace with one line per tone, so the L-then-R order of a wave is visible.
- Debug panel (collapsible): actual sample rate, bin width, fftSize, tone frequencies and their SNR, mic track settings, per-tone leftBins/rightBins, dL/dR, zE, guard z-score, and a scrolling event log (triggers, ambiguous waves, noise frames, suppressions) with timestamps.
- Settings panel (collapsible), all live: master volume, tone L/R frequency, fftSize, bandwidth threshold %, second-peak %, minShiftBins, minProximityZ, debounce frames, onset gap (ms), pair window (ms), cooldown (ms), continuous-motion limit (ms), mode A/B, invert direction. Persist settings to localStorage, wrapped in try/catch.
- Friendly errors through toasts plus an inline alert: mic permission denied, getUserMedia unavailable (not localhost or HTTPS), non-Chrome browser warning (detect Safari and Firefox and explain why they won't work), sample rate below 44.1 kHz.

## Code quality

- Strict TypeScript, no `any`, no `as` casts to silence errors.
- Comment every constant with where it comes from (for example, "10% threshold from SoundWave"). No magic numbers outside `constants.ts`.
- Use typed arrays and no allocations inside the per-frame loop.
- Clean up everything on Stop and on unmount: cancel the animation frame, stop the oscillators, stop the mic tracks, close the AudioContext, remove listeners.
- No external requests of any kind.

## Acceptance checks

Run these and fix every failure before finishing: `pnpm format`, `pnpm check`, `pnpm build`. Never claim a check passed without running it. Then reason through each behaviour:

1. After Start and Calibrate on a MacBook in Chrome, both tone peaks appear in the spectrum panels and the tones are inaudible to most adults.
2. Holding still for 10 s fires nothing.
3. Waving a hand left to right about 20 cm above the keyboard fires RIGHT; right to left fires LEFT (or the reverse with Invert on).
4. Clapping, jingling keys or typing fires nothing.
5. A person moving 2 m behind the laptop fires nothing. Continuous waving for 5 s triggers the "Too much motion" block.
6. Stop silences the tones immediately with no click. Tab switching pauses everything. Navigating away from /sonar releases the mic (the browser's mic indicator turns off).

## When you're done

1. Confirm with `git status` and `git log --oneline main..HEAD` that every commit is on `feature/afterlife-sonar` and nothing outside the allowed files changed (`git diff --stat main...HEAD`).
2. Report: the files added, the check results, how to try it (`pnpm dev`, open http://localhost:3000/sonar in Chrome), a 5-step tuning guide (what to adjust if waves are missed, if there are false triggers, if left and right are swapped, if no tone peak appears, and if the stereo order is unreliable, so switch to Mode B), and the three most likely failure points on real hardware.
3. Ask before pushing. Never open a PR unless I ask.
```

## Sources

- [SoundWave: Using the Doppler Effect to Sense Gestures (Gupta et al., CHI 2012), full paper](https://modernmobile.cs.washington.edu/docs/soundwave.pdf)
- [SoundWave, Microsoft Research page](https://www.microsoft.com/en-us/research/publication/soundwave-using-doppler-effect-sense-gestures/)
- [doppler.js, browser implementation of SoundWave (GitHub)](https://github.com/danielrapp/doppler.js)
- [Hackaday: Doppler gesture sensing in JavaScript](https://hackaday.com/2015/03/13/doppler-gesture-sensing-in-javascript)
- [FingerIO: Using Active Sonar for Fine-Grained Finger Tracking (UW)](https://fingerio.cs.washington.edu)
- [Multiwave: Complex Hand Gesture Recognition Using the Doppler Effect (UCF)](https://www.eecs.ucf.edu/~jjl/pubs/multiwave_gi2017_final.pdf)
- [Tarzia et al., ultrasonic sonar presence detection (UbiComp 2009)](https://users.cs.northwestern.edu/~pdinda/Papers/ubicomp09.pdf)
- [Lenovo: lock on leave with ultrasound presence detection](<https://download.lenovo.com/manual/p16v_g2/ug/html_en/en/Lock_on_leave_function_(for_selected_models).html>)
- [Engineering.com: Elliptic Labs AI Virtual Presence Sensor](https://www.engineering.com/is-your-laptop-watching-your-back/)
- [Intel: Human Presence Detection via Wi-Fi Range-Filtered Doppler Spectrum (arXiv, 2026)](https://arxiv.org/html/2603.10845v1)
- [WebKit bug 192932: Safari can't disable high-frequency filtering](https://bugs.webkit.org/show_bug.cgi?id=192932)
- [getUserMedia frequency response by audio setting](https://cat-in-136.github.io/2020/10/gum-frequency-characteristic-depending-on-audio-parameters.html)
- [Apple: Use Mic Modes on your Mac](https://support.apple.com/guide/mac-help/mchle82b42f0)
- [MDN: AnalyserNode.fftSize](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode/fftSize)
