// Afterlife Wi-Fi Sense: local collector.
//
// Reads the RSSI of this Mac's own Wi-Fi link and streams it to the /wifi page.
//
//   node scripts/wifi-sense/collector.mjs          real data from CoreWLAN (macOS)
//   node scripts/wifi-sense/collector.mjs --mock   synthetic data, any OS
//
// Flags:
//   --port <n>              HTTP port on 127.0.0.1 (default 4317)
//   --origin <url>          the one origin allowed by CORS (default http://localhost:3000)
//   --mock                  synthetic samples instead of CoreWLAN
//   --keepalive udp|off     tiny UDP datagram to the default gateway, ~10/s (default udp)
//   --interval-ms <n>       how often to read the link (default 50)
//
// Endpoints (127.0.0.1 only):
//   GET  /stream            Server-Sent Events: `sample` and `status` events
//   GET  /health            JSON summary, rates measured over the last 5 s
//   POST /mock/scene?name=  mock mode only: auto | quiet | inside | outside | shift | drop
//
// Network rules: it listens only on 127.0.0.1. The only traffic it sends is the
// keepalive: one byte to UDP port 9 (discard) of your own default gateway, and only if
// that gateway has a private address. No scanning, no probing, no sniffing, no
// monitor mode, no internet. It never reads the SSID or BSSID.

import { spawn, spawnSync } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync, statSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------------
// Types. Every source (CoreWLAN today, CSI over UDP from OpenWrt routers later)
// produces the same Sample shape and implements the same Source interface.
// ---------------------------------------------------------------------------------

/**
 * @typedef {object} LinkSample
 * @property {number} t       ms since epoch
 * @property {number} rssi    dBm, integer
 * @property {number} noise   dBm, integer
 * @property {number} txRate  Mbps
 * @property {string} iface   interface name, e.g. en0
 */

/**
 * @typedef {object} ErrorSample
 * @property {number} t
 * @property {'not_connected'} error
 */

/** @typedef {LinkSample | ErrorSample} Sample */

/** @typedef {'corewlan' | 'mock'} SourceName */

/**
 * @typedef {object} Source
 * @property {SourceName} name
 * @property {(onSample: (sample: Sample) => void, onStatus: (message: string) => void) => void} start
 * @property {() => void} stop
 * @property {((scene: string) => boolean) | undefined} [setScene]  mock only
 */

/**
 * @typedef {object} Options
 * @property {number} port
 * @property {string} origin
 * @property {boolean} mock
 * @property {'udp' | 'off'} keepalive
 * @property {number} intervalMs
 */

// ---------------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------------

const DEFAULT_PORT = 4317;
const DEFAULT_ORIGIN = 'http://localhost:3000';
// 20 Hz: faster than CoreWLAN seems to refresh, so we never miss an update.
const DEFAULT_INTERVAL_MS = 50;
const MIN_INTERVAL_MS = 5;
// SSE comment every 15 s so proxies and the browser keep the stream open.
const HEARTBEAT_MS = 15_000;
// Rates in /health are measured over this window.
const STATS_WINDOW_MS = 5_000;
// ~10 datagrams a second keeps the radio busy enough that RSSI keeps refreshing.
const KEEPALIVE_MS = 100;
// UDP discard port: the gateway drops it (or replies ICMP unreachable). Harmless.
const KEEPALIVE_PORT = 9;
// Re-read the default gateway now and then, so switching networks follows along.
const GATEWAY_REFRESH_MS = 30_000;
// If the Swift helper dies, restart it after this long.
const HELPER_RESTART_MS = 1_000;
const HELPER_BIN_NAME = 'afterlife-wifi-sense-rssi';

// Mock signal model. Values are dBm.
const MOCK_BASE_RSSI = -55;
// macOS seems to refresh RSSI roughly every 100-300 ms; the mock holds each value this long.
const MOCK_REFRESH_MS = 150;
// Quiet-room jitter (std dev before rounding). Rounding to whole dBm makes it look real.
const MOCK_QUIET_SIGMA = 0.4;
const MOCK_INSIDE_SIGMA_MIN = 2;
const MOCK_INSIDE_SIGMA_MAX = 4;
// Someone in the hallway disturbs the link much less than someone crossing it.
const MOCK_OUTSIDE_SIGMA_MIN = 0.7;
const MOCK_OUTSIDE_SIGMA_MAX = 1.1;
const MOCK_BURST_MIN_MS = 3_000;
const MOCK_BURST_MAX_MS = 10_000;
const MOCK_GAP_MIN_MS = 15_000;
const MOCK_GAP_MAX_MS = 40_000;
// Share of random bursts that are inside the room (the rest are outside).
const MOCK_INSIDE_SHARE = 0.6;
// The `shift` scene moves the baseline this far, like moving the laptop or router.
const MOCK_SHIFT_DB = 12;
// The `drop` scene reports not_connected for this long.
const MOCK_DROP_MS = 8_000;
const MOCK_NOISE = -92;
const MOCK_TX_RATE = 866.7;
const MOCK_IFACE = 'mock0';

const HELP = `Usage: node scripts/wifi-sense/collector.mjs [--mock] [--port ${DEFAULT_PORT}]
  [--origin ${DEFAULT_ORIGIN}] [--keepalive udp|off] [--interval-ms ${DEFAULT_INTERVAL_MS}]`;

// ---------------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------------

/**
 * @param {string[]} argv
 * @returns {Options}
 */
function parseArgs(argv) {
  /** @type {Options} */
  const opts = {
    port: DEFAULT_PORT,
    origin: DEFAULT_ORIGIN,
    mock: false,
    keepalive: 'udp',
    intervalMs: DEFAULT_INTERVAL_MS,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) fail(`${arg} needs a value.\n${HELP}`);
      return value;
    };
    if (arg === '--mock') opts.mock = true;
    else if (arg === '--port') opts.port = toInt(next(), arg, 1);
    else if (arg === '--origin') opts.origin = next();
    else if (arg === '--interval-ms')
      opts.intervalMs = toInt(next(), arg, MIN_INTERVAL_MS);
    else if (arg === '--keepalive') {
      const value = next();
      if (value !== 'udp' && value !== 'off') fail(`--keepalive must be udp or off.`);
      opts.keepalive = value;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else fail(`Unknown flag ${arg}.\n${HELP}`);
  }
  return opts;
}

/**
 * @param {string} value
 * @param {string} flag
 * @param {number} min
 */
function toInt(value, flag, min) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min) fail(`${flag} must be an integer >= ${min}.`);
  return n;
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`[wifi-sense] ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------------
// CoreWLAN source (macOS): compile rssi.swift once, spawn it, parse its JSON lines
// ---------------------------------------------------------------------------------

/** @returns {string} path to the compiled helper */
function compileHelper() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = path.join(here, 'rssi.swift');
  const bin = path.join(os.tmpdir(), HELPER_BIN_NAME);
  if (existsSync(bin) && statSync(bin).mtimeMs >= statSync(src).mtimeMs) return bin;

  console.log('[wifi-sense] Compiling the CoreWLAN helper (first run only)...');
  const result = spawnSync('swiftc', ['-O', src, '-o', bin], { stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    fail(
      'Could not compile scripts/wifi-sense/rssi.swift with swiftc.\n' +
        '  Install the Xcode Command Line Tools:  xcode-select --install\n' +
        '  Or run without a Mac:                  node scripts/wifi-sense/collector.mjs --mock'
    );
  }
  return bin;
}

/**
 * @param {number} intervalMs
 * @returns {Source}
 */
function createCoreWlanSource(intervalMs) {
  const bin = compileHelper();
  /** @type {import('node:child_process').ChildProcessWithoutNullStreams | null} */
  let child = null;
  let stopping = false;
  /** @type {NodeJS.Timeout | null} */
  let restartTimer = null;

  return {
    name: 'corewlan',
    start(onSample, onStatus) {
      const launch = () => {
        child = spawn(bin, ['--interval-ms', String(intervalMs)]);
        let pending = '';
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (/** @type {string} */ chunk) => {
          pending += chunk;
          let nl;
          while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl);
            pending = pending.slice(nl + 1);
            const sample = parseSample(line);
            if (sample) onSample(sample);
          }
        });
        child.stderr.on('data', (chunk) => process.stderr.write(chunk));
        child.on('exit', (code, signal) => {
          child = null;
          if (stopping) return;
          onStatus(`helper exited (${signal ?? code}), restarting`);
          restartTimer = setTimeout(launch, HELPER_RESTART_MS);
        });
      };
      launch();
    },
    stop() {
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      child?.kill('SIGTERM');
    },
  };
}

/**
 * @param {string} line
 * @returns {Sample | null}
 */
function parseSample(line) {
  /** @type {unknown} */
  let raw;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  if (typeof o.t !== 'number') return null;
  if (o.error === 'not_connected') return { t: o.t, error: 'not_connected' };
  if (
    typeof o.rssi === 'number' &&
    typeof o.noise === 'number' &&
    typeof o.txRate === 'number' &&
    typeof o.iface === 'string'
  ) {
    return { t: o.t, rssi: o.rssi, noise: o.noise, txRate: o.txRate, iface: o.iface };
  }
  return null;
}

// ---------------------------------------------------------------------------------
// Mock source: integer RSSI around -55 dBm with random inside and outside bursts
// ---------------------------------------------------------------------------------

/**
 * @param {number} min
 * @param {number} max
 */
function uniform(min, max) {
  return min + Math.random() * (max - min);
}

/** Standard normal via Box-Muller. */
function gaussian() {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * @param {number} intervalMs
 * @returns {Source}
 */
function createMockSource(intervalMs) {
  /** @type {NodeJS.Timeout | null} */
  let timer = null;
  // 'auto' runs the random burst schedule; the others pin one condition.
  let scene = 'auto';
  let baseline = MOCK_BASE_RSSI;
  let sigma = MOCK_QUIET_SIGMA;
  let burstEndsAt = 0;
  let nextBurstAt = Date.now() + uniform(MOCK_GAP_MIN_MS, MOCK_GAP_MAX_MS);
  let dropUntil = 0;
  let value = MOCK_BASE_RSSI;
  let lastRefresh = 0;
  /** @type {(message: string) => void} */
  let status = () => {};

  /** @param {number} now */
  function updateSchedule(now) {
    if (scene !== 'auto') return;
    if (burstEndsAt && now >= burstEndsAt) {
      burstEndsAt = 0;
      sigma = MOCK_QUIET_SIGMA;
      nextBurstAt = now + uniform(MOCK_GAP_MIN_MS, MOCK_GAP_MAX_MS);
      status('mock: burst ended');
    }
    if (!burstEndsAt && now >= nextBurstAt) {
      const inside = Math.random() < MOCK_INSIDE_SHARE;
      sigma = inside
        ? uniform(MOCK_INSIDE_SIGMA_MIN, MOCK_INSIDE_SIGMA_MAX)
        : uniform(MOCK_OUTSIDE_SIGMA_MIN, MOCK_OUTSIDE_SIGMA_MAX);
      burstEndsAt = now + uniform(MOCK_BURST_MIN_MS, MOCK_BURST_MAX_MS);
      status(`mock: ${inside ? 'inside' : 'outside'} motion burst`);
    }
  }

  return {
    name: 'mock',
    start(onSample, onStatus) {
      status = onStatus;
      timer = setInterval(() => {
        const now = Date.now();
        updateSchedule(now);
        if (now < dropUntil) {
          onSample({ t: now, error: 'not_connected' });
          return;
        }
        // Hold each value for a while, like CoreWLAN does, then draw a new one.
        if (now - lastRefresh >= MOCK_REFRESH_MS) {
          lastRefresh = now;
          value = Math.round(baseline + gaussian() * sigma);
        }
        onSample({
          t: now,
          rssi: value,
          noise: MOCK_NOISE,
          txRate: MOCK_TX_RATE,
          iface: MOCK_IFACE,
        });
      }, intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    setScene(name) {
      const now = Date.now();
      if (name === 'auto') {
        sigma = MOCK_QUIET_SIGMA;
        burstEndsAt = 0;
        nextBurstAt = now + uniform(MOCK_GAP_MIN_MS, MOCK_GAP_MAX_MS);
      } else if (name === 'quiet') sigma = MOCK_QUIET_SIGMA;
      else if (name === 'inside')
        sigma = uniform(MOCK_INSIDE_SIGMA_MIN, MOCK_INSIDE_SIGMA_MAX);
      else if (name === 'outside')
        sigma = uniform(MOCK_OUTSIDE_SIGMA_MIN, MOCK_OUTSIDE_SIGMA_MAX);
      else if (name === 'shift') {
        // A one-off event on top of the current scene, not a scene of its own.
        baseline =
          baseline === MOCK_BASE_RSSI ? MOCK_BASE_RSSI - MOCK_SHIFT_DB : MOCK_BASE_RSSI;
        status(`mock: baseline moved to ${baseline} dBm`);
        return true;
      } else if (name === 'drop') {
        dropUntil = now + MOCK_DROP_MS;
        status('mock: link dropped');
        return true;
      } else return false;
      scene = name;
      status(`mock: scene ${name}`);
      return true;
    },
  };
}

// ---------------------------------------------------------------------------------
// Keepalive: one byte to the default gateway's discard port, ~10 times a second
// ---------------------------------------------------------------------------------

/** @returns {string | null} the default IPv4 gateway, if it's a private address */
function readGateway() {
  const result = spawnSync('route', ['-n', 'get', 'default'], { encoding: 'utf8' });
  if (result.status !== 0 || typeof result.stdout !== 'string') return null;
  const match = /gateway:\s*(\d+\.\d+\.\d+\.\d+)/.exec(result.stdout);
  if (!match) return null;
  return isPrivateIPv4(match[1]) ? match[1] : null;
}

/** @param {string} ip */
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

function createKeepalive() {
  const socket = dgram.createSocket('udp4');
  const payload = Buffer.alloc(1);
  /** @type {string | null} */
  let gateway = readGateway();
  let warned = false;
  socket.on('error', () => {});

  const send = setInterval(() => {
    if (!gateway) return;
    socket.send(payload, KEEPALIVE_PORT, gateway, (err) => {
      if (err && !warned) {
        warned = true;
        console.warn(`[wifi-sense] keepalive send failed: ${err.message}`);
      }
    });
  }, KEEPALIVE_MS);
  const refresh = setInterval(() => {
    gateway = readGateway();
  }, GATEWAY_REFRESH_MS);

  return {
    get gateway() {
      return gateway;
    },
    stop() {
      clearInterval(send);
      clearInterval(refresh);
      socket.close();
    },
  };
}

// ---------------------------------------------------------------------------------
// Rolling rates for /health
// ---------------------------------------------------------------------------------

function createStats() {
  /** @type {number[]} */
  const sampleTimes = [];
  /** @type {number[]} */
  const distinctTimes = [];
  let prevRssi = NaN;
  let prevNoise = NaN;

  /** @param {number[]} times @param {number} now */
  const prune = (times, now) => {
    while (times.length && now - times[0] > STATS_WINDOW_MS) times.shift();
  };

  return {
    /** @param {Sample} sample */
    add(sample) {
      const now = sample.t;
      sampleTimes.push(now);
      if ('rssi' in sample && (sample.rssi !== prevRssi || sample.noise !== prevNoise)) {
        // "Distinct" = a fresh reading. A frozen driver repeats both RSSI and noise.
        distinctTimes.push(now);
        prevRssi = sample.rssi;
        prevNoise = sample.noise;
      }
      prune(sampleTimes, now);
      prune(distinctTimes, now);
    },
    sampleHz() {
      prune(sampleTimes, Date.now());
      return round2(sampleTimes.length / (STATS_WINDOW_MS / 1000));
    },
    distinctPerSec() {
      prune(distinctTimes, Date.now());
      return round2(distinctTimes.length / (STATS_WINDOW_MS / 1000));
    },
  };
}

/** @param {number} n */
function round2(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------------

function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!opts.mock && process.platform !== 'darwin') {
    fail(
      `Real data needs macOS (CoreWLAN); this is ${process.platform}.\n` +
        '  Run with synthetic data instead:  node scripts/wifi-sense/collector.mjs --mock'
    );
  }

  /** @type {Source} */
  const source = opts.mock
    ? createMockSource(opts.intervalMs)
    : createCoreWlanSource(opts.intervalMs);
  const keepalive = !opts.mock && opts.keepalive === 'udp' ? createKeepalive() : null;
  const stats = createStats();

  /** @type {Set<http.ServerResponse>} */
  const clients = new Set();
  /** @type {Sample | null} */
  let lastSample = null;
  let connected = false;

  /** @param {string} event @param {string} data */
  const broadcast = (event, data) => {
    const frame = `event: ${event}\ndata: ${data}\n\n`;
    for (const res of clients) res.write(frame);
  };

  const statusPayload = (/** @type {string} */ message) =>
    JSON.stringify({
      source: source.name,
      connected,
      gateway: keepalive?.gateway ?? null,
      message,
    });

  /** @param {string} message */
  const onStatus = (message) => {
    console.log(`[wifi-sense] ${message}`);
    broadcast('status', statusPayload(message));
  };

  /** @param {Sample} sample */
  const onSample = (sample) => {
    lastSample = sample;
    stats.add(sample);
    const nowConnected = 'rssi' in sample;
    if (nowConnected !== connected) {
      connected = nowConnected;
      onStatus(connected ? 'link connected' : 'link not connected');
    }
    broadcast('sample', JSON.stringify(sample));
  };

  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);

  const server = http.createServer((req, res) => {
    // Refuse other Host headers, so a web page can't reach us via DNS rebinding.
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.writeHead(403).end();
      return;
    }
    if (req.headers.origin === opts.origin) {
      res.setHeader('Access-Control-Allow-Origin', opts.origin);
      res.setHeader('Vary', 'Origin');
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      res.writeHead(204).end();
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
      res.write(`retry: ${HELPER_RESTART_MS}\n\n`);
      res.write(`event: status\ndata: ${statusPayload('client connected')}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          source: source.name,
          platform: process.platform,
          connected,
          sampleHz: stats.sampleHz(),
          distinctPerSec: stats.distinctPerSec(),
          lastSample,
          gateway: keepalive?.gateway ?? null,
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/mock/scene' && source.setScene) {
      const ok = source.setScene(url.searchParams.get('name') ?? '');
      res.writeHead(ok ? 204 : 400).end();
      return;
    }

    res.writeHead(404).end();
  });

  const heartbeat = setInterval(() => {
    for (const res of clients) res.write(': heartbeat\n\n');
  }, HEARTBEAT_MS);

  server.on('error', (err) => fail(`HTTP server error: ${err.message}`));
  server.listen(opts.port, '127.0.0.1', () => {
    console.log(
      `[wifi-sense] ${source.name} source, http://127.0.0.1:${opts.port}/stream ` +
        `(CORS: ${opts.origin}), keepalive: ${
          keepalive ? (keepalive.gateway ?? 'no private gateway found') : 'off'
        }`
    );
    source.start(onSample, onStatus);
  });

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[wifi-sense] shutting down');
    source.stop();
    keepalive?.stop();
    clearInterval(heartbeat);
    for (const res of clients) res.end();
    clients.clear();
    server.close(() => process.exit(0));
    // Don't hang on a stuck socket.
    setTimeout(() => process.exit(0), HELPER_RESTART_MS).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
