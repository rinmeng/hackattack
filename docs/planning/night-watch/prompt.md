You are working in the `rinmeng/hackattack` repo (Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui base-lyra on Base UI, Supabase, pnpm). Read `AGENTS.md` and `README.md` first and follow every convention in them. Build an MVP of "Afterlife Night Watch": old laptops and phones become camera-free sensors that learn each room's normal night-time pattern and flag activity in rooms that are normally empty.

This is a big, multi-area feature. Per AGENTS.md, first write a plan at `docs/planning/night-watch/plan.md` using the template in `docs/planning/README.md`, show it to me, and wait for my go-ahead. Don't start the orchestrator skill unless I say yes to it.

## Git rules (strict: this repo holds several teams' ideas)

- Before touching any file: `git checkout main && git pull origin main && git checkout -b feature/afterlife-night-watch`. If that branch already exists, check it out and pull it instead.
- ALL work and ALL commits go on `feature/afterlife-night-watch` only. Never commit to `main` or any other branch. Never merge, rebase onto, cherry-pick into or force-push any other branch.
- Ask before pushing. Push only this branch: `git push -u origin feature/afterlife-night-watch`. Never open a pull request unless I ask.
- Put everything in new files. The only changes allowed to existing files: one `navLinks` entry `{ href: '/night-watch', label: 'Night Watch' }` in `components/Navbar.tsx`; one line `export * from './night-watch';` in `lib/types/index.ts`; new variables appended to `.env.example` with comments; and `lib/types/database.ts` regenerated with `pnpm db:types` (never edited by hand). Don't touch `app/page.tsx`, `app/layout.tsx`, `app/globals.css`, `components/ui/`, `package.json` or the lockfile. Add no dependencies: use what's installed (zod, recharts via `components/ui/chart.tsx`, date-fns, lucide-react, supabase-js).
- Commit in small logical steps with Conventional Commits, scope `night-watch`, for example `feat(night-watch): add ingest api and readings table`.

## Privacy and network rules

- Never record, store or transmit audio. Sensor devices compute features locally and send only numbers. The sensor page shows exactly what it sends, live.
- Everything runs on the user's own network. No third-party services, no analytics, no external requests.

## Background facts (rely on these)

- The sensor technique revives Microsoft Research's 2012 SoundWave: play an inaudible tone and read motion from the Doppler shift of its echo. Doppler shift = 2 * v * f0 / c, with c = 343 m/s. A moving hand or body spreads energy into bins beside the tone's peak.
- Chrome on a MacBook can do sonar if mic processing is off (`echoCancellation`, `noiseSuppression` and `autoGainControl` all false). Safari, and every iOS browser, filters out high frequencies, so iPhones get passive listening only. Detect this at runtime; don't hardcode by user agent alone.
- MacBook mics are hardware-disconnected when the lid is closed. Chrome doesn't run requestAnimationFrame in background tabs and throttles timers, so the sensor page must stay in the foreground: process audio on a `setInterval` (not requestAnimationFrame) and request a Screen Wake Lock.
- Phones need HTTPS for mic access. The app runs with `pnpm dev --experimental-https -H 0.0.0.0` and phones open `https://<laptop-ip>:3000/night-watch/sensor`.

## Part 1: sensor page (`/night-watch/sensor`)

- A client page any device opens. Fields: device name, room name, role (entrance or interior). Persist them in localStorage (try/catch) along with a generated device id.
- Start button (unlocks audio): create an AudioContext, get the mic with processing off, connect an AnalyserNode (`fftSize` 2048 for passive features, `smoothingTimeConstant` 0).
- Passive features every 100 ms: RMS level in dB, energy in 3 bands (50 to 300 Hz, 300 to 2,000 Hz, 2,000 to 8,000 Hz) in dB, and spectral flux (sum of positive bin changes between frames, normalized).
- Sonar capability check at start: play a tone, sweep 18,000 to 20,500 Hz in 250 Hz steps, and keep the best tone with peak SNR >= 20 dB. If none qualifies, run passive only and say why on screen. A "Passive only (pets)" switch turns the tone off.
- Sonar motion score every 100 ms: find the tone's peak, scan outward on each side while amplitude is above 10% of the peak (with SoundWave's second-peak rule at 30%), subtract the bandwidth measured during a 3 s still calibration, and report the total shifted bins as `motion` (0 when passive only).
- Batch frames and POST every 500 ms to `/api/night-watch/ingest` with header `x-night-watch-token`. Retry with backoff and buffer up to 60 s offline.
- Show: status, mode (sonar + passive or passive only), the exact JSON being sent, sample rate, frames sent, last error. Request a Screen Wake Lock and show whether it's held. Show tips: keep plugged in, keep the lid open, Auto-Lock Never on iPhone.

## Part 2: data (Supabase)

- One migration created with `pnpm exec supabase migration new night_watch`. Tables, all prefixed `nw_`, each with `enable row level security` in the same migration:
  - `nw_devices` (id, name, room, role, capabilities, last_seen_at, created_at)
  - `nw_readings` (device_id, ts, rms_mean, rms_peak, band_low, band_mid, band_high, flux, motion, mode, simulated), primary key (device_id, ts), index on ts. One row per device per second.
  - `nw_baselines` (device_id, feature, hour_of_week 0 to 167, median, mad, n, updated_at)
  - `nw_events` (id, device_id, ts, tier log|notify|escalate, z_passive, z_motion, rule, sensors_agreed, status pending|confirmed_me|denied|escalated|auto_logged, resolved_at)
  - `nw_rules` (id, room, days, start_minute, end_minute, action notify|escalate, enabled)
  - `nw_context` (id, kind arrival|late, starts_at, ends_at)
  - `nw_labels` (id, room, starts_at, ends_at, note): the ground-truth entry log
  - `nw_walk_tests` (id, device_id, sensor passive|sonar|fused, distance_m, detected, ts)
- RLS: no policies for anonymous users. All reads and writes go through server code with `createAdminClient()`, because sensor devices and the local demo aren't signed-in users. Say so in a comment at each call site, as AGENTS.md requires. Never import the admin client into client components.
- Run `pnpm exec supabase migration up`, then `pnpm db:types`, and commit the regenerated `lib/types/database.ts` with the migration. Use the generated `Tables<'nw_readings'>` and similar helpers instead of hand-written row types.
- When Supabase isn't configured (`isSupabaseConfigured`), fall back to an in-memory store behind the same interface, so `pnpm build` and a no-database demo still work. Show a banner when in-memory mode is active.
- Env: `NIGHT_WATCH_INGEST_TOKEN` (server only, never `NEXT_PUBLIC_`), documented in `.env.example`.

## Part 3: API routes (`app/api/night-watch/`)

- `ingest` (POST): check the token, validate with zod, upsert the device, aggregate 100 ms frames into 1 s rows (mean and peak RMS, mean bands, max flux, max motion), insert in batches, then run scoring on the new seconds. Accept historical timestamps and a `simulated` flag so the simulator can backfill.
- `stream` (GET): Server-Sent Events for the dashboard (new readings summary, new events, device health).
- `events/[id]` (PATCH): confirm ("this was me"), deny, or resolve.
- `arrival` (POST, token): marks the next 15 minutes as resident arriving. Designed for an iOS Shortcuts "When I arrive home" automation, so document the exact request in the UI.
- `baselines/rebuild` (POST): rebuilds baselines from history.
- `export` (GET): CSV of readings and events for a date range.

## Part 4: detection (`lib/night-watch/`, pure TypeScript where possible)

- Baselines per device, feature and hour of week, using median and MAD. Score: z = (x - median) / (1.4826 * MAD), with a MAD floor so silent slots don't divide by zero. Passive z = max of the z scores for rms_peak, band_mid and flux. Motion z from motion.
- A slot is "dead" if its median activity is below the device's 25th percentile across all slots.
- Cold start: until a device has 3 nights of data, use device-wide quantiles plus hard rules only, and show "Learning: N of 3 nights".
- Safe learning:
  1. Rebuild baselines only from confirmed-normal data: exclude every second within 5 minutes of an event that isn't `confirmed_me` or `auto_logged`.
  2. Incremental updates are clipped: m_new = m + clip(alpha * (x - m), -delta, delta), with small defaults in `constants.ts`.
  3. Hard rules in `nw_rules` always apply; learning can add suspicion but never suppress a rule.
  4. Drift check: if a slot's last 7 days differ from its baseline by more than a set margin, surface "Your routine changed here. Accept as new normal?" Only an explicit accept updates it.
- Fusion and tiers: sound only in a busy slot = log; sound in a dead slot = notify; motion in a dead slot = notify; sound + motion in a dead slot, or 2 or more devices agreeing within 10 s = notify, then escalate after 5 minutes without an answer; a matching hard rule = at least notify.
- Context: during an arrival window, downgrade by one tier when the entrance device fires first. Interior activity with no entrance activity in the previous 60 s is upgraded by one tier.
- Every event stores the reason: rule, z scores, sensors that agreed, context applied.

## Part 5: dashboard (`/night-watch`)

- Server Component shell with tabs, client components only where needed. Use `<Text>`, `useToast()`, `EmptyState`, shadcn components and charts from `components/ui/chart.tsx`. Never `asChild`.
- **Live:** a card per device (room, mode, current level, motion, last seen, health), sorted with active ones first.
- **Anomalies:** a timeline of events with tier, explanation, and "Was this you?" Yes / No buttons. Pending notify events trigger a browser notification (permission requested from a click), a toast and a short Web Audio beep; escalations are louder and repeat.
- **Patterns:** a device-by-hour-of-week heatmap of baseline activity, with anomalies overlaid, and a learning-progress indicator.
- **Evaluation:** detection rate vs distance per sensor (from `nw_walk_tests`, with a form to record trials); a confusion matrix and precision and recall from `nw_labels` vs events (with a form to add labels); a ROC curve from sweeping the z threshold with the chosen operating point marked; a fusion comparison (passive only, sonar only, both); a poisoning test (button that injects 3 simulated nights of 3 am activity into a copy of the baseline and compares a naive mean-based baseline against the safe one on a 4th night); alerts per week before and after confirmations and context.
- **Devices and rules:** edit device rooms and roles; create hard rules; the arrival URL and Shortcuts instructions; a "coming home late" button.
- **Health:** sample rate, dropped batches, uptime per device; storage mode (Supabase or in-memory).

## Part 6: simulator (`scripts/night-watch/simulate.mjs`)

- Node ESM, built-in modules only. Posts realistic synthetic data to the ingest route for 4 devices (entrance, living room, kitchen, storage) over N days (default 3): daytime activity, quiet nights, HVAC cycles, the odd late arrival through the entrance, and a matching `nw_labels` entry log. Flags: `--days`, `--base-url`, `--token`, `--inject-poisoning` (3 nights of 3 am storage-room activity), `--speed`. Marks everything `simulated: true`.

## Code quality

- Strict TypeScript, no `any`, no `as` casts to silence errors. Constants in `lib/night-watch/constants.ts`, each commented.
- No `window`, `navigator`, `AudioContext` or `localStorage` access at module level or during render.
- Clean up audio, timers, wake lock and EventSource on unmount.

## Acceptance checks

Run `pnpm format`, `pnpm check` and `pnpm build` and fix every failure. If you added the migration, run `pnpm db:types` and make sure `pnpm db:types:check` passes. Never claim a check passed without running it. Then verify:

1. With Supabase running, `node scripts/night-watch/simulate.mjs --days 3` fills the tables, and every dashboard tab shows real charts from that data.
2. Without Supabase, the app builds and runs on the in-memory store with a banner.
3. The sensor page works on a MacBook in Chrome (sonar + passive) and degrades to passive only in Safari, explaining why.
4. A late arrival through the entrance during an arrival window is downgraded; interior-first activity is upgraded.
5. The poisoning test shows the naive baseline missing night 4 while the safe baseline flags it.
6. `git diff --stat main...HEAD` shows only new files plus the allowed edits.

## When you're done

Report: files added, check results, exact run steps (Supabase, env token, HTTPS dev server, phone certificate trust, simulator), a tuning guide, and the three most likely real-world failure points. Ask before pushing. Never open a PR unless I ask.
