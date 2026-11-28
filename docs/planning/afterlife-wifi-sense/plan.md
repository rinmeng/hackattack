# Afterlife Wi-Fi Sense

**Status:** In progress
**Issue:** None yet
**Owner:** rin
**Last updated:** 2026-11-28

## Goal

A camera-free motion alarm. An old router set up as an access point sits across a room
or doorway from a MacBook. The app watches how the RSSI of the MacBook's own link to
that router fluctuates and shows CLEAR or MOTION live, with alerts during quiet hours.

## Scope

- In: a local collector (Swift CoreWLAN helper plus a Node SSE server on `127.0.0.1`), a
  mock mode, pure-TS detection (spread score, two-step calibration, hysteresis state
  machine, link-change and stale guards), and a `/wifi` page with a live chart,
  calibration, quiet hours, settings, event log and diagnostics.
- Out: CSI from OpenWrt routers (the sample interface leaves room for it), counting
  people, detecting a person sitting still, direction, any server-side storage.

## Areas affected

- [ ] Database: none
- [ ] Server: none in Next.js. The collector is a standalone script in `scripts/wifi-sense/`
- [x] UI: `app/wifi/page.tsx`, `components/wifi-sense/*`, `hooks/use-wifi-sense.ts`,
      one link in `components/Navbar.tsx`
- [ ] Auth: none
- [ ] Config / env vars: none (the collector URL is a client setting in localStorage)

## Approach

```text
CoreWLAN (rssi.swift, 20 Hz poll) ─stdout JSON─▶ collector.mjs ─SSE /stream─▶ browser
                         mock generator ─┘          │ UDP keepalive to gateway:9
                                                    └ GET /health
browser: EventSource ─▶ RingBuffer + Detector (lib/wifi-sense, no DOM)
                     ─▶ throttled snapshot (~8 Hz) ─▶ React state
                     ─▶ refs ─▶ canvas redraw on requestAnimationFrame
```

- **Score**: rolling-window (2 s) mean absolute deviation or standard deviation of RSSI,
  kept incrementally with running sums. MAD around the window mean is kept exact by
  tracking a count per integer dBm value (RSSI is whole dBm), so each sample is O(1)
  amortised plus O(number of distinct values) for MAD.
- **Calibration**: empty room gives mu and sigma of the score; outside motion gives the
  p95. T = max(mu + k·sigma, outsideFactor·p95) × sensitivity.
- **State machine**: CLEAR → MOTION after score > T for the enter hold, MOTION → CLEAR
  after score < 0.7·T for the exit hold. Holds are in milliseconds.
- **Guards**: 10 s median RSSI jump > 8 dB or transmit-rate jump > 50 %, held, means
  NEEDS_RECALIBRATION. No distinct RSSI value for 5 s means STALE.
- **Sources**: the collector has a `Source` interface (`start(onSample)`, `stop()`), so a
  CSI-over-UDP source can be added later.

## Data model

None. Calibration, settings, quiet hours and the collector URL are saved in
localStorage.

## Plan

1. [ ] Collector: Swift helper, Node SSE server, mock source
2. [ ] Detection library: types, constants, ring buffer, detector
3. [ ] `/wifi` page: hook, components, alerts, Navbar link

## Decisions

- 2026-11-28: built directly rather than with the orchestrator skill (user's choice).
- 2026-11-28: all work in new files. The only edits to existing files are one line in
  `components/Navbar.tsx` and one in `lib/types/index.ts`, so this never conflicts with
  other teams' ideas.

## Open questions

- How often CoreWLAN refreshes `rssiValue()` on a given Mac. The collector measures it
  (`distinctPerSec` in `/health`) and the UI shows it.

## Done when

- [ ] Mock mode shows MOTION during inside bursts and CLEAR otherwise once calibrated
- [ ] With the collector stopped, the page shows the start command and reconnects
- [ ] `pnpm check` and `pnpm build` pass
- [ ] `git diff --stat main...HEAD` shows only new files plus the two one-line edits
