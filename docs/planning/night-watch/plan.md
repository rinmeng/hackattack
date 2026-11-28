# Afterlife Night Watch

**Status:** Draft
**Issue:** None yet
**Owner:** rin
**Last updated:** 2026-11-28

## Goal

Turn old laptops and phones into camera-free sensors, using passive audio features plus inaudible-tone sonar. They learn each room's normal night-time pattern and flag activity in rooms that are normally empty. No audio leaves the device, and everything runs on the local network. Full brief: [prompt.md](prompt.md).

## Scope

- In: sensor page, `nw_*` tables plus an in-memory fallback, ingest/stream/events/arrival/rebuild/export routes, detection library, dashboard tabs, evaluation tools, simulator.
- Out: audio recording or storage, third-party services, analytics, user-agent-only capability checks, new dependencies, edits to existing files beyond the allowed list.

## Areas affected

- [ ] Database: one migration `night_watch` with 8 `nw_` tables, RLS enabled, no anon policies
- [ ] Server: `app/api/night-watch/*` route handlers, `lib/night-watch/` store and detection
- [ ] UI: `/night-watch` dashboard, `/night-watch/sensor`, `components/night-watch/*`
- [ ] Auth: none (sensors use a shared ingest token, and all DB access goes through `createAdminClient()`)
- [ ] Config / env vars: `NIGHT_WATCH_INGEST_TOKEN` (server only) in `.env.example`

Only these existing files may change: one `navLinks` entry in `components/Navbar.tsx`, `export * from './night-watch';` in `lib/types/index.ts`, `.env.example`, and a regenerated `lib/types/database.ts`.

## Approach

The sensor runs `setInterval` at 100 ms and computes RMS, 3 band energies, flux and a sonar Doppler motion score locally. It batches frames and POSTs them every 500 ms. Ingest aggregates them into 1 s rows and scores them against median/MAD baselines per device and hour of week. It then fuses passive and motion signals with hard rules and context into log/notify/escalate events. The dashboard reads through server code and gets live updates over SSE. A store interface hides whether data lives in Supabase or in memory.

## Data model

Migration: `supabase/migrations/<timestamp>_night_watch.sql` (not yet created). The 8 tables are `nw_devices`, `nw_readings` (PK `device_id, ts`, index on `ts`), `nw_baselines`, `nw_events`, `nw_rules`, `nw_context`, `nw_labels` and `nw_walk_tests`, with columns as listed in [prompt.md](prompt.md). RLS is enabled on every table with no policies, and access is server-only through the admin client.

## Plan

Each phase is one or more small commits on `feature/afterlife-night-watch`.

1. [ ] **Sensor page:** `app/night-watch/sensor/page.tsx`, `components/night-watch/SensorClient.tsx`, `lib/night-watch/audio/{features,sonar}.ts`, `lib/night-watch/constants.ts`
2. [ ] **Data and ingest:** `supabase/migrations/*_night_watch.sql`, regenerated `lib/types/database.ts`, `lib/types/night-watch.ts`, `lib/night-watch/store/{index,supabase,memory}.ts`, `app/api/night-watch/{ingest,stream,events/[id],arrival,baselines/rebuild,export}/route.ts`, `.env.example`
3. [ ] **Detection:** `lib/night-watch/{baseline,score,fusion,context,drift}.ts`
4. [ ] **Dashboard:** `app/night-watch/page.tsx`, `components/night-watch/{LiveTab,AnomaliesTab,PatternsTab,DevicesTab,HealthTab,InMemoryBanner}.tsx`, Navbar link
5. [ ] **Evaluation:** `components/night-watch/EvaluationTab.tsx` plus `lib/night-watch/eval/{roc,confusion,poisoning}.ts`
6. [ ] **Simulator:** `scripts/night-watch/simulate.mjs`

## Decisions

- 2026-11-28: Admin client for all `nw_*` access, because sensors and the local demo aren't signed-in users.
- 2026-11-28: In-memory store behind the same interface when Supabase isn't configured.

## Open questions

- Should a GitHub issue be opened to track this?
- Should the orchestrator skill be used? (Not started without an explicit yes.)

## Done when

- [ ] `pnpm format`, `pnpm check`, `pnpm build` pass; `pnpm db:types:check` passes
- [ ] With Supabase, `node scripts/night-watch/simulate.mjs --days 3` fills tables and every tab shows real charts
- [ ] Without Supabase, the app builds and runs on the in-memory store with a banner
- [ ] Sensor works in Chrome on MacBook (sonar + passive) and degrades to passive in Safari with a reason shown
- [ ] Entrance-first arrival in an arrival window is downgraded; interior-first activity is upgraded
- [ ] Poisoning test: naive baseline misses night 4, safe baseline flags it
- [ ] `git diff --stat main...HEAD` shows only new files plus the allowed edits
