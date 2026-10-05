import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { readBoundedText } from '../security/upstream.js';

import { EventEmitter } from 'node:events';
import zlib from 'node:zlib';
import WebSocket from 'ws';
import type {
  ArchiveLine,
  ArchiveStream,
  FeedData,
  LiveState,
  Replay,
  ReplayProgress,
  SimSector,
  SimStint,
  Subscriber,
} from './live-timing.types.js';

@Injectable()
export class LiveTimingService implements OnModuleDestroy {
  private destroyed = false;
  private readonly abortController = new AbortController();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  /**
   * Live timing relay.
   *
   * Holds a single upstream connection to the unofficial F1 live timing
   * SignalR feed (the same stream that powers the official app's timing
   * screens), merges its snapshot + delta messages into an in-memory session
   * state, and re-broadcasts every change to any number of SSE subscribers via
   * an EventEmitter — so N site visitors cost exactly one upstream connection.
   *
   * The upstream connection is lazy: it opens when the first SSE client
   * subscribes and closes a grace period after the last one leaves. A built-in
   * simulator can replay a synthetic race through the exact same ingest path
   * for local development and demos (no upstream needed).
   */

  // SignalR Core endpoint (the legacy /signalr endpoint now returns 401 and
  // requires an F1 TV subscription token; /signalrcore still negotiates openly).
  F1_BASE = 'https://livetiming.formula1.com/signalrcore';

  F1_WS_URL = 'wss://livetiming.formula1.com/signalrcore';

  // SignalR Core frames are terminated by the ASCII record separator.
  RS = '\x1e';

  // Optional F1 TV subscription token (JWT) — attached as a bearer token if the
  // feed ever starts rejecting anonymous access like the legacy endpoint does.
  F1_AUTH_TOKEN = process.env.F1_LIVETIMING_TOKEN || null;

  // Every topic the official timing screens use. `.z` topics arrive
  // base64+deflate-compressed and are stored under their bare name.
  TOPICS = [
    'Heartbeat',
    'CarData.z',
    'Position.z',
    'ExtrapolatedClock',
    'TopThree',
    'TimingStats',
    'TimingAppData',
    'WeatherData',
    'TrackStatus',
    'DriverList',
    'RaceControlMessages',
    'SessionInfo',
    'SessionData',
    'LapCount',
    'TimingData',
    'TeamRadio',
    'PitLaneTimeCollection',
  ];

  // Disconnect from upstream this long after the last SSE client leaves, so a
  // page refresh doesn't tear down and rebuild the SignalR session.
  IDLE_DISCONNECT_MS = 60_000;

  // If upstream goes silent for this long the socket is presumed dead.
  STALE_FEED_MS = 90_000;

  emitter = new EventEmitter();

  state: LiveState = {
    topics: {}, // topic name -> latest merged value
    status: 'idle', // idle | connecting | connected | error
    simulated: false,
    replay: null, // { path, name, speed, paused, loading, offsetMs, durationMs }
    lastFeedAt: null,
    subscribers: 0,
    error: null,
  };

  socket: WebSocket | null = null;

  idleTimer: NodeJS.Timeout | null = null;

  staleTimer: NodeJS.Timeout | null = null;

  reconnectDelay = 2000;

  generation = 0;

  // invalidates callbacks from abandoned connections

  /* ------------------------------------------------------------------ */
  /* State merging                                                       */
  /* ------------------------------------------------------------------ */

  /**
   * Merge an F1 feed delta into the current value. Objects merge key-by-key
   * recursively; anything else (strings, numbers, arrays sent whole) replaces.
   * Array patches arrive as objects keyed by stringified index ("0", "5", ...)
   * and are applied per-index onto the existing array.
   */
  deepMerge = (base: FeedData, patch: FeedData, depth = 0): FeedData => {
    if (depth > 32) return null;
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    if (Array.isArray(base)) {
      const next = base.slice();
      for (const [key, value] of Object.entries(patch)) {
        const idx = Number(key);
        if (Number.isInteger(idx) && idx >= 0 && idx < 10000)
          next[idx] = this.deepMerge(next[idx], value, depth + 1);
      }
      return next;
    }
    const target = base && typeof base === 'object' ? { ...base } : {};
    for (const [key, value] of Object.entries(patch)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) continue;
      target[key] = this.deepMerge(
        Object.hasOwn(target, key) ? target[key] : undefined,
        value,
        depth + 1,
      );
    }
    return target;
  };

  inflate = (b64: string): FeedData =>
    JSON.parse(
      zlib
        .inflateRawSync(Buffer.from(b64, 'base64'), { maxOutputLength: 8 * 1024 * 1024 })
        .toString('utf8'),
    );

  /**
   * Single ingest path for the real feed, the simulator and archive replay:
   * normalize the topic, update merged state, notify subscribers. `silent`
   * skips the per-update broadcast (used when fast-forwarding a replay seek —
   * one snapshot event goes out at the end instead).
   */
  ingest = (
    topic: string,
    data: FeedData,
    timestamp: string | null = null,
    { replace = false, silent = false } = {},
  ) => {
    if (!this.TOPICS.includes(topic) && !this.TOPICS.includes(`${topic}.z`)) return;
    let name = topic;
    let value = data;
    if (name.endsWith('.z')) {
      name = name.slice(0, -2);
      try {
        value = this.inflate(data);
      } catch (err) {
        console.error(`Live timing: failed to inflate ${topic}:`, err.message);
        return;
      }
      replace = true; // compressed topics are full snapshots, not deltas
    }
    this.state.topics[name] = replace ? value : this.deepMerge(this.state.topics[name], value);
    this.state.lastFeedAt = Date.now();
    if (!silent) {
      this.emitter.emit('update', {
        topic: name,
        data: value,
        timestamp: timestamp || new Date().toISOString(),
      });
    }
  };

  setStatus = (status: string, error: string | null = null) => {
    this.state.status = status;
    this.state.error = error;
    this.emitter.emit('status', { status, error, simulated: this.state.simulated });
  };

  /* ------------------------------------------------------------------ */
  /* Upstream SignalR connection                                         */
  /* ------------------------------------------------------------------ */
  negotiate = async () => {
    const res = await fetch(`${this.F1_BASE}/negotiate?negotiateVersion=1`, {
      method: 'POST',
      signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
      headers: {
        'User-Agent': 'BestHTTP',
        ...(this.F1_AUTH_TOKEN ? { Authorization: `Bearer ${this.F1_AUTH_TOKEN}` } : {}),
      },
    });
    if (!res.ok) throw new Error(`negotiate failed: HTTP ${res.status}`);
    const body = JSON.parse(await readBoundedText(res, 64 * 1024));
    // The AWSALB affinity cookies from negotiate must be echoed on the socket.
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
      .map((c) => c.split(';')[0])
      .join('; ');
    return { token: body.connectionToken || body.connectionId, cookie };
  };

  teardownSocket = () => {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = null;
    if (this.socket) {
      this.socket.removeAllListeners();
      // Terminating during CONNECTING can emit an asynchronous error.
      this.socket.on('error', () => {});
      try {
        this.socket.terminate();
      } catch {
        /* already closed */
      }
      this.socket = null;
    }
  };

  bumpStaleTimer = (gen: number) => {
    if (this.staleTimer) clearTimeout(this.staleTimer);
    this.staleTimer = setTimeout(() => {
      if (gen !== this.generation) return;
      console.warn('Live timing: feed went stale, reconnecting');
      this.teardownSocket();
      this.scheduleReconnect(gen);
    }, this.STALE_FEED_MS);
  };

  scheduleReconnect = (gen: number) => {
    if (gen !== this.generation || this.state.subscribers === 0 || this.state.simulated) return;
    this.setStatus('connecting');
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, 60_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (gen === this.generation && this.state.subscribers > 0 && !this.state.simulated)
        this.connect();
    }, delay);
  };

  connect = async () => {
    const gen = this.generation;
    this.setStatus('connecting');
    let session;
    try {
      session = await this.negotiate();
    } catch (err) {
      if (gen !== this.generation || this.destroyed) return;
      console.error('Live timing: negotiate error:', err.message);
      this.setStatus('error', 'Live feed unavailable');
      this.scheduleReconnect(gen);
      return;
    }
    if (gen !== this.generation) return;

    const qs =
      `id=${encodeURIComponent(session.token)}` +
      (this.F1_AUTH_TOKEN ? `&access_token=${encodeURIComponent(this.F1_AUTH_TOKEN)}` : '');

    const socket = (this.socket = new WebSocket(`${this.F1_WS_URL}?${qs}`, {
      maxPayload: 8 * 1024 * 1024,
      handshakeTimeout: 10_000,
      headers: {
        'User-Agent': 'BestHTTP',
        'Accept-Encoding': 'gzip,identity',
        ...(session.cookie ? { Cookie: session.cookie } : {}),
      },
    }));

    let handshakeDone = false;

    socket.on('open', () => {
      if (gen !== this.generation) return;
      this.reconnectDelay = 2000;
      // SignalR Core protocol handshake, then subscribe once it's acked.
      socket.send(`{"protocol":"json","version":1}${this.RS}`);
      this.bumpStaleTimer(gen);
      this.pingTimer = setInterval(() => {
        try {
          socket.send(`{"type":6}${this.RS}`);
        } catch {
          /* closing */
        }
      }, 15000);
    });

    socket.on('message', (raw) => {
      if (gen !== this.generation) return;
      this.bumpStaleTimer(gen);
      const frames = raw.toString().split(this.RS).filter(Boolean);
      for (const frame of frames) {
        let msg;
        try {
          msg = JSON.parse(frame);
        } catch {
          continue;
        }
        // First frame acks the protocol handshake ({} or {error}).
        if (!handshakeDone) {
          handshakeDone = true;
          if (msg.error) {
            console.error('Live timing: handshake rejected:', msg.error);
            socket.close();
            return;
          }
          this.setStatus('connected');
          socket.send(
            JSON.stringify({
              type: 1,
              invocationId: '1',
              target: 'Subscribe',
              arguments: [this.TOPICS],
            }) + this.RS,
          );
          continue;
        }
        // type 3: invocation result — the full snapshot keyed by topic.
        if (msg.type === 3 && msg.result && typeof msg.result === 'object') {
          for (const [topic, data] of Object.entries(msg.result)) {
            this.ingest(topic, data, null, { replace: true });
          }
          this.emitter.emit('snapshot');
        }
        // type 1: streaming invocation — feed(topic, data, timestamp).
        if (msg.type === 1 && msg.target === 'feed' && Array.isArray(msg.arguments)) {
          this.ingest(msg.arguments[0], msg.arguments[1], msg.arguments[2]);
        }
        // type 7: server is closing the connection.
        if (msg.type === 7) socket.close();
      }
    });

    const clearPing = () => {
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
    };

    socket.on('error', (err) => {
      if (gen !== this.generation) return;
      console.error('Live timing: socket error:', err.message);
    });

    socket.on('close', () => {
      clearPing();
      if (gen !== this.generation) return;
      this.teardownSocket();
      this.scheduleReconnect(gen);
    });
  };

  /* ------------------------------------------------------------------ */
  /* Subscriber lifecycle                                                */
  /* ------------------------------------------------------------------ */

  /**
   * Register an SSE subscriber. Opens the upstream connection on the first
   * subscriber (unless a replay or simulation is already the active source).
   * Returns an unsubscribe function.
   */
  addSubscriber = ({ onUpdate, onStatus, onReplay, onSnapshot, onShutdown }: Subscriber) => {
    if (this.destroyed) throw new Error('Live timing service is shutting down');
    this.state.subscribers += 1;
    if (onShutdown) this.emitter.on('shutdown', onShutdown);
    this.emitter.on('update', onUpdate);
    if (onStatus) this.emitter.on('status', onStatus);
    if (onReplay) this.emitter.on('replay', onReplay);
    if (onSnapshot) this.emitter.on('snapshot', onSnapshot);

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (
      !this.state.simulated &&
      !this.state.replay &&
      !this.socket &&
      this.state.status !== 'connecting'
    ) {
      this.generation += 1;
      this.connect();
    }

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (onShutdown) this.emitter.off('shutdown', onShutdown);
      this.state.subscribers = Math.max(0, this.state.subscribers - 1);
      this.emitter.off('update', onUpdate);
      if (onStatus) this.emitter.off('status', onStatus);
      if (onReplay) this.emitter.off('replay', onReplay);
      if (onSnapshot) this.emitter.off('snapshot', onSnapshot);
      if (!this.destroyed && this.state.subscribers === 0 && !this.state.simulated) {
        this.idleTimer = setTimeout(() => {
          if (this.state.subscribers === 0 && !this.state.simulated) {
            this.generation += 1; // invalidate reconnect loops
            this.teardownSocket();
            this.releaseReplay(); // free the loaded session archive
            this.setStatus('idle');
          }
        }, this.IDLE_DISCONNECT_MS);
      }
    };
  };

  getState = () => ({
    status: this.state.status,
    simulated: this.state.simulated,
    replay: this.replayProgress(),
    lastFeedAt: this.state.lastFeedAt,
    subscribers: this.state.subscribers,
    error: this.state.error,
    topics: this.state.topics,
  });

  /* ------------------------------------------------------------------ */
  /* Simulator                                                           */
  /* ------------------------------------------------------------------ */
  SIM_GRID = [
    {
      num: '4',
      tla: 'NOR',
      first: 'Lando',
      last: 'Norris',
      team: 'McLaren',
      color: 'F58020',
      pace: 0.0,
    },
    {
      num: '81',
      tla: 'PIA',
      first: 'Oscar',
      last: 'Piastri',
      team: 'McLaren',
      color: 'F58020',
      pace: 0.05,
    },
    {
      num: '1',
      tla: 'VER',
      first: 'Max',
      last: 'Verstappen',
      team: 'Red Bull',
      color: '3671C6',
      pace: 0.08,
    },
    {
      num: '22',
      tla: 'TSU',
      first: 'Yuki',
      last: 'Tsunoda',
      team: 'Red Bull',
      color: '3671C6',
      pace: 0.4,
    },
    {
      num: '16',
      tla: 'LEC',
      first: 'Charles',
      last: 'Leclerc',
      team: 'Ferrari',
      color: 'E8002D',
      pace: 0.12,
    },
    {
      num: '44',
      tla: 'HAM',
      first: 'Lewis',
      last: 'Hamilton',
      team: 'Ferrari',
      color: 'E8002D',
      pace: 0.18,
    },
    {
      num: '63',
      tla: 'RUS',
      first: 'George',
      last: 'Russell',
      team: 'Mercedes',
      color: '27F4D2',
      pace: 0.15,
    },
    {
      num: '12',
      tla: 'ANT',
      first: 'Kimi',
      last: 'Antonelli',
      team: 'Mercedes',
      color: '27F4D2',
      pace: 0.25,
    },
    {
      num: '14',
      tla: 'ALO',
      first: 'Fernando',
      last: 'Alonso',
      team: 'Aston Martin',
      color: '229971',
      pace: 0.35,
    },
    {
      num: '18',
      tla: 'STR',
      first: 'Lance',
      last: 'Stroll',
      team: 'Aston Martin',
      color: '229971',
      pace: 0.55,
    },
    {
      num: '10',
      tla: 'GAS',
      first: 'Pierre',
      last: 'Gasly',
      team: 'Alpine',
      color: '0093CC',
      pace: 0.45,
    },
    {
      num: '43',
      tla: 'COL',
      first: 'Franco',
      last: 'Colapinto',
      team: 'Alpine',
      color: '0093CC',
      pace: 0.6,
    },
    {
      num: '23',
      tla: 'ALB',
      first: 'Alexander',
      last: 'Albon',
      team: 'Williams',
      color: '64C4FF',
      pace: 0.3,
    },
    {
      num: '55',
      tla: 'SAI',
      first: 'Carlos',
      last: 'Sainz',
      team: 'Williams',
      color: '64C4FF',
      pace: 0.28,
    },
    {
      num: '6',
      tla: 'HAD',
      first: 'Isack',
      last: 'Hadjar',
      team: 'Racing Bulls',
      color: '6692FF',
      pace: 0.42,
    },
    {
      num: '30',
      tla: 'LAW',
      first: 'Liam',
      last: 'Lawson',
      team: 'Racing Bulls',
      color: '6692FF',
      pace: 0.5,
    },
    {
      num: '27',
      tla: 'HUL',
      first: 'Nico',
      last: 'Hulkenberg',
      team: 'Audi',
      color: '00E701',
      pace: 0.52,
    },
    {
      num: '5',
      tla: 'BOR',
      first: 'Gabriel',
      last: 'Bortoleto',
      team: 'Audi',
      color: '00E701',
      pace: 0.58,
    },
    {
      num: '31',
      tla: 'OCO',
      first: 'Esteban',
      last: 'Ocon',
      team: 'Haas',
      color: 'B6BABD',
      pace: 0.48,
    },
    {
      num: '87',
      tla: 'BEA',
      first: 'Oliver',
      last: 'Bearman',
      team: 'Haas',
      color: 'B6BABD',
      pace: 0.46,
    },
    {
      num: '11',
      tla: 'PER',
      first: 'Sergio',
      last: 'Perez',
      team: 'Cadillac',
      color: 'BFB07E',
      pace: 0.65,
    },
    {
      num: '77',
      tla: 'BOT',
      first: 'Valtteri',
      last: 'Bottas',
      team: 'Cadillac',
      color: 'BFB07E',
      pace: 0.7,
    },
  ];

  // Closed loop of waypoints tracing Silverstone (normalized 0-100 coords from
  // the frontend's track silhouette data) — simulated cars lap around it so the
  // live track map draws a believable circuit.
  SIM_TRACK = [
    [54.8, 8.8],
    [63.9, 8.0],
    [67.6, 9.1],
    [69.7, 13.1],
    [71.5, 21.5],
    [72.0, 31.8],
    [73.8, 36.7],
    [74.1, 39.7],
    [72.4, 45.4],
    [74.8, 49.7],
    [75.1, 51.8],
    [72.8, 54.9],
    [69.0, 57.5],
    [65.9, 63.0],
    [54.8, 83.4],
    [50.1, 90.5],
    [47.3, 92.0],
    [44.5, 91.3],
    [41.9, 87.2],
    [38.8, 82.7],
    [32.7, 75.7],
    [29.8, 77.1],
    [27.1, 75.7],
    [25.2, 72.3],
    [26.0, 68.3],
    [36.9, 54.0],
    [40.8, 49.7],
    [43.9, 49.5],
    [49.5, 50.2],
    [53.1, 49.1],
    [60.1, 43.6],
    [62.7, 43.8],
    [64.8, 48.9],
    [66.6, 47.6],
    [67.8, 44.0],
    [68.0, 40.5],
    [44.5, 18.7],
    [42.0, 17.7],
    [39.2, 19.6],
    [38.4, 24.1],
    [36.2, 25.2],
    [34.0, 23.9],
    [33.7, 21.8],
    [37.2, 14.7],
    [40.4, 11.6],
    [43.9, 9.9],
    [46.4, 9.6],
  ];

  SIM_LAP_BASE = 88.5;

  // seconds around Silverstone
  SIM_TOTAL_LAPS = 52;

  SIM_TICK_MS = 1000;

  COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD'];

  sim: { interval: NodeJS.Timeout } | null = null;

  fmtLap = (s: number) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
  };

  fmtGap = (s: number) => `+${s.toFixed(3)}`;

  utc = () => new Date().toISOString().replace('Z', '');

  simTrackPos = (progress: number) => {
    const t = progress * this.SIM_TRACK.length;
    const i = Math.floor(t) % this.SIM_TRACK.length;
    const j = (i + 1) % this.SIM_TRACK.length;
    const f = t - Math.floor(t);
    // Scale into telemetry-like coordinates so the map code paths match reality.
    return {
      X: Math.round(
        (this.SIM_TRACK[i][0] + (this.SIM_TRACK[j][0] - this.SIM_TRACK[i][0]) * f) * 100,
      ),
      Y: Math.round(
        -(this.SIM_TRACK[i][1] + (this.SIM_TRACK[j][1] - this.SIM_TRACK[i][1]) * f) * 100,
      ),
    };
  };

  startSimulation = () => {
    if (this.sim) return this.getState();
    // Take over cleanly from any real connection or running replay.
    this.generation += 1;
    this.teardownSocket();
    this.releaseReplay();
    this.state.simulated = true;
    this.state.topics = {};

    const now = Date.now();
    const cars = this.SIM_GRID.map((d, i) => ({
      ...d,
      line: i + 1,
      totalDist: -i * 0.004, // grid spread
      bestLap: null as number | null,
      lastLap: null as number | null,
      lastLapPersonalBest: false,
      lastLapOverallBest: false,
      lapStartDist: 0,
      laps: 0,
      pits: 0,
      stint: { compound: this.COMPOUNDS[i % 2 === 0 ? 1 : 0], age: 0, new: 'true' },
      stints: [] as SimStint[],
      inPit: false,
      pitUntil: 0,
      retired: false,
      sectors: [null, null, null] as (SimSector | null)[],
      speed: 280,
    }));
    cars.forEach((c) =>
      c.stints.push({ Compound: c.stint.compound, New: c.stint.new, TotalLaps: 0, StartLaps: 0 }),
    );

    let overallBest = Infinity;
    let lap = 1;
    let trackStatus = { Status: '1', Message: 'AllClear' };
    let rcCounter = 0;
    const raceControl: Record<string, unknown>[] = [];
    const pushRC = (
      Message: string,
      extra: { Category?: string; Flag?: string; Scope?: string } = {},
    ) => {
      raceControl.push({
        Utc: this.utc(),
        Lap: lap,
        Category: extra.Category || 'Other',
        Message,
        Flag: extra.Flag,
        Scope: extra.Scope,
      });
      rcCounter += 1;
    };
    pushRC('GREEN LIGHT - PIT EXIT OPEN', { Category: 'Flag', Flag: 'GREEN', Scope: 'Track' });

    // Seed every topic with a full snapshot so late joiners get complete state.
    const snapshot = () => {
      this.ingest(
        'SessionInfo',
        {
          Meeting: {
            Name: 'British Grand Prix',
            OfficialName: 'FORMULA 1 BRITISH GRAND PRIX 2026',
            Location: 'Silverstone',
            Country: { Name: 'United Kingdom', Code: 'GBR' },
            Circuit: { ShortName: 'Silverstone' },
          },
          Name: 'Race',
          Type: 'Race',
          StartDate: new Date(now).toISOString(),
        },
        null,
        { replace: true },
      );
      this.ingest('TrackStatus', trackStatus, null, { replace: true });
      this.ingest('LapCount', { CurrentLap: lap, TotalLaps: this.SIM_TOTAL_LAPS }, null, {
        replace: true,
      });
      this.ingest(
        'WeatherData',
        {
          AirTemp: '21.4',
          TrackTemp: '38.2',
          Humidity: '54.0',
          Pressure: '1011.2',
          Rainfall: '0',
          WindSpeed: '3.4',
          WindDirection: '210',
        },
        null,
        { replace: true },
      );
      this.ingest(
        'DriverList',
        Object.fromEntries(
          cars.map((c) => [
            c.num,
            {
              RacingNumber: c.num,
              BroadcastName: `${c.first[0]} ${c.last.toUpperCase()}`,
              FullName: `${c.first} ${c.last}`,
              Tla: c.tla,
              Line: c.line,
              TeamName: c.team,
              TeamColour: c.color,
              FirstName: c.first,
              LastName: c.last,
              Reference: c.tla,
            },
          ]),
        ),
        null,
        { replace: true },
      );
      this.ingest('RaceControlMessages', { Messages: raceControl.slice() }, null, {
        replace: true,
      });
      emitTiming(true);
      emitCarData();
      emitPosition();
      this.emitter.emit('snapshot');
    };

    const emitTiming = (replace = false) => {
      const ordered = cars.slice().sort((a, b) => {
        if (a.retired !== b.retired) return a.retired ? 1 : -1;
        return b.totalDist - a.totalDist;
      });
      const leader = ordered[0];
      const lines: Record<string, FeedData> = {};
      ordered.forEach((c, idx) => {
        const ahead = idx > 0 ? ordered[idx - 1] : null;
        // distance (in laps) -> seconds, using base lap time
        const gapS = c.retired ? null : (leader.totalDist - c.totalDist) * this.SIM_LAP_BASE;
        const intS =
          c.retired || !ahead ? null : (ahead.totalDist - c.totalDist) * this.SIM_LAP_BASE;
        lines[c.num] = {
          Line: idx + 1,
          Position: String(idx + 1),
          RacingNumber: c.num,
          Retired: c.retired,
          InPit: c.inPit,
          PitOut: !c.inPit && c.pitUntil > 0 && Date.now() - c.pitUntil < 8000,
          Stopped: false,
          NumberOfLaps: c.laps,
          NumberOfPitStops: c.pits,
          GapToLeader: c.retired
            ? ''
            : idx === 0
              ? ''
              : gapS! > this.SIM_LAP_BASE
                ? `${Math.floor(gapS! / this.SIM_LAP_BASE)}L`
                : this.fmtGap(gapS!),
          IntervalToPositionAhead: {
            Value: c.retired
              ? ''
              : idx === 0
                ? ''
                : intS! > this.SIM_LAP_BASE
                  ? `${Math.floor(intS! / this.SIM_LAP_BASE)}L`
                  : this.fmtGap(intS!),
            Catching: intS !== null && intS! < 1.0,
          },
          LastLapTime: {
            Value: c.lastLap ? this.fmtLap(c.lastLap) : '',
            PersonalFastest: c.lastLapPersonalBest,
            OverallFastest: c.lastLapOverallBest,
          },
          BestLapTime: { Value: c.bestLap ? this.fmtLap(c.bestLap) : '', Lap: c.laps },
          Sectors: c.sectors.map((s, si) => ({
            Value: s ? s.value.toFixed(3) : '',
            PersonalFastest: s ? s.pb : false,
            OverallFastest: s ? s.ob : false,
            Segments: Array.from({ length: [7, 8, 6][si] }, (_, k) => ({
              Status: !s ? 0 : s.ob && k % 3 === 0 ? 2051 : s.pb && k % 2 === 0 ? 2049 : 2048,
            })),
          })),
          Speeds: {
            ST: {
              Value: String(Math.round(c.speed + 25)),
              PersonalFastest: false,
              OverallFastest: false,
            },
          },
        };
      });
      this.ingest('TimingData', { Lines: lines, SessionPart: 0 }, null, { replace });
      this.ingest(
        'TimingAppData',
        {
          Lines: Object.fromEntries(
            cars.map((c) => [
              c.num,
              {
                RacingNumber: c.num,
                Line: c.line,
                Stints: c.stints.map((s) => ({ ...s })),
              },
            ]),
          ),
        },
        null,
        { replace },
      );
    };

    const emitCarData = () => {
      const carsChannels: Record<string, FeedData> = {};
      cars.forEach((c) => {
        const throttle = c.inPit ? 40 : 60 + Math.round(Math.random() * 40);
        carsChannels[c.num] = {
          Channels: {
            0: 9500 + Math.round(Math.random() * 2500), // RPM
            2: Math.round(c.speed), // Speed
            3: c.inPit ? 2 : 5 + Math.round(Math.random() * 3), // Gear
            4: throttle, // Throttle
            5: throttle > 92 ? 0 : Math.round(Math.random() * 60), // Brake
            45: !c.inPit && Math.random() > 0.6 ? 12 : 8, // DRS (10/12/14 = open)
          },
        };
      });
      // Mirror the real feed: entries batched with a timestamp, ingested as a .z snapshot topic.
      this.state.topics.CarData = {
        Entries: [{ Utc: new Date().toISOString(), Cars: carsChannels }],
      };
      this.state.lastFeedAt = Date.now();
      this.emitter.emit('update', {
        topic: 'CarData',
        data: this.state.topics.CarData,
        timestamp: new Date().toISOString(),
      });
    };

    const emitPosition = () => {
      const entries: Record<string, FeedData> = {};
      cars.forEach((c) => {
        const p = this.simTrackPos(((c.totalDist % 1) + 1) % 1);
        entries[c.num] = { Status: c.retired ? 'Retired' : 'OnTrack', X: p.X, Y: p.Y, Z: 0 };
      });
      this.state.topics.Position = {
        Position: [{ Timestamp: new Date().toISOString(), Entries: entries }],
      };
      this.state.lastFeedAt = Date.now();
      this.emitter.emit('update', {
        topic: 'Position',
        data: this.state.topics.Position,
        timestamp: new Date().toISOString(),
      });
    };

    snapshot();
    this.setStatus('connected');

    let tick = 0;
    const interval = setInterval(() => {
      tick += 1;
      const scPhase = trackStatus.Status === '4';

      cars.forEach((c) => {
        if (c.retired) return;
        // advance: fraction of a lap per tick, modulated by pace, tyre age, pit, SC
        const degradation = 1 + c.stint.age * 0.0006;
        const variance = 1 + (Math.random() - 0.5) * 0.015;
        let lapTime = (this.SIM_LAP_BASE + c.pace) * degradation * variance;
        if (scPhase) lapTime *= 1.45;
        if (c.inPit) {
          if (Date.now() >= c.pitUntil) {
            c.inPit = false;
            c.stint = {
              compound: this.COMPOUNDS[Math.floor(Math.random() * 3)],
              age: 0,
              new: 'true',
            };
            c.stints.push({
              Compound: c.stint.compound,
              New: 'true',
              TotalLaps: 0,
              StartLaps: c.laps,
            });
            c.pitUntil = Date.now(); // marks PitOut window
          } else {
            lapTime *= 3.2;
          }
        }
        const prevDist = c.totalDist;
        c.totalDist += this.SIM_TICK_MS / 1000 / lapTime;
        c.speed = c.inPit ? 80 : scPhase ? 120 + Math.random() * 30 : 250 + Math.random() * 80;

        // Sector boundaries at 1/3 and 2/3 of each lap
        const lapFrac = ((c.totalDist % 1) + 1) % 1;
        const prevFrac = ((prevDist % 1) + 1) % 1;
        const crossed = (b: number) => prevFrac < b && lapFrac >= b;
        const sectorTime = () => lapTime / 3 + (Math.random() - 0.5) * 0.4;
        if (crossed(1 / 3))
          c.sectors[0] = {
            value: sectorTime(),
            pb: Math.random() > 0.75,
            ob: Math.random() > 0.94,
          };
        if (crossed(2 / 3))
          c.sectors[1] = {
            value: sectorTime(),
            pb: Math.random() > 0.75,
            ob: Math.random() > 0.94,
          };

        // Lap completed
        if (Math.floor(c.totalDist) > Math.floor(prevDist) && c.totalDist > 0) {
          c.laps += 1;
          c.stint.age += 1;
          c.stints[c.stints.length - 1].TotalLaps = c.stint.age;
          c.sectors[2] = {
            value: sectorTime(),
            pb: Math.random() > 0.75,
            ob: Math.random() > 0.94,
          };
          c.lastLap = lapTime;
          c.lastLapPersonalBest = !c.bestLap || lapTime < c.bestLap;
          if (c.lastLapPersonalBest) c.bestLap = lapTime;
          c.lastLapOverallBest = lapTime < overallBest;
          if (c.lastLapOverallBest) {
            overallBest = lapTime;
            pushRC(`FASTEST LAP: CAR ${c.num} (${c.tla}) TIME ${this.fmtLap(lapTime)}`, {
              Category: 'Other',
            });
            this.ingest('RaceControlMessages', {
              Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] },
            });
          }
          // Pit strategy: window around lap 16-22 and 34-40
          if (
            !c.inPit &&
            !scPhase &&
            ((c.stint.age > 14 && Math.random() < 0.12) || c.stint.age > 26)
          ) {
            c.inPit = true;
            c.pits += 1;
            c.pitUntil = Date.now() + 21000 + Math.random() * 4000;
          }
        }
      });

      const leaderLaps = Math.max(...cars.map((c) => Math.floor(c.totalDist))) + 1;
      if (leaderLaps > lap && leaderLaps <= this.SIM_TOTAL_LAPS) {
        lap = leaderLaps;
        this.ingest('LapCount', { CurrentLap: lap });
      }

      // Occasional incidents: yellow -> SC -> green
      if (!scPhase && tick % 30 === 0 && Math.random() < 0.12 && lap > 3) {
        trackStatus = { Status: '2', Message: 'Yellow' };
        this.ingest('TrackStatus', trackStatus, null, { replace: true });
        pushRC('YELLOW FLAG - SECTOR 2 INCIDENT', {
          Category: 'Flag',
          Flag: 'YELLOW',
          Scope: 'Sector',
        });
        this.ingest('RaceControlMessages', {
          Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] },
        });
        setTimeout(
          () => {
            if (!this.sim) return;
            trackStatus = { Status: '1', Message: 'AllClear' };
            this.ingest('TrackStatus', trackStatus, null, { replace: true });
            pushRC('CLEAR - TRACK CLEAR', { Category: 'Flag', Flag: 'CLEAR', Scope: 'Track' });
            this.ingest('RaceControlMessages', {
              Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] },
            });
          },
          15000 + Math.random() * 10000,
        );
      }

      // Rare retirement
      if (tick % 45 === 0 && Math.random() < 0.08) {
        const alive = cars.filter((c) => !c.retired && c.line > 5);
        if (alive.length > 12) {
          const victim = alive[Math.floor(Math.random() * alive.length)];
          victim.retired = true;
          pushRC(`CAR ${victim.num} (${victim.tla}) RETIRED`, { Category: 'Other' });
          this.ingest('RaceControlMessages', {
            Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] },
          });
        }
      }

      // Weather drift
      if (tick % 20 === 0) {
        this.ingest('WeatherData', {
          AirTemp: (21 + Math.random() * 2).toFixed(1),
          TrackTemp: (37 + Math.random() * 3).toFixed(1),
          WindSpeed: (2 + Math.random() * 3).toFixed(1),
        });
      }

      emitTiming();
      emitCarData();
      emitPosition();
    }, this.SIM_TICK_MS);

    this.sim = { interval };
    return this.getState();
  };

  stopSimulation = () => {
    if (!this.sim) return this.getState();
    clearInterval(this.sim.interval);
    this.sim = null;
    this.state.simulated = false;
    this.state.topics = {};
    this.setStatus('idle');
    // If clients are still watching, fall back to the real feed.
    if (this.state.subscribers > 0) {
      this.generation += 1;
      this.connect();
    }
    return this.getState();
  };

  /* ------------------------------------------------------------------ */
  /* Session archive replay                                              */
  /*                                                                     */
  /* F1 archives every session's raw feed as static files:              */
  /*   .../static/{year}/Index.json           — meetings + sessions     */
  /*   .../static/{session.Path}{Topic}.jsonStream                      */
  /* Each stream line is `H:MM:SS.mmm` (elapsed) + a JSON payload — the */
  /* same deltas the live socket sends — so a replay just schedules the */
  /* recorded lines through the normal ingest path at a chosen speed.   */
  /* ------------------------------------------------------------------ */
  F1_STATIC_BASE = 'https://livetiming.formula1.com/static/';

  // Same UA the official clients send; some CDN configs reject default agents.
  STATIC_HEADERS = { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip' };

  ARCHIVE_FIRST_YEAR = 2018;

  // Full snapshots (not deltas) — during replay only the newest due line
  // matters, and seeks can jump straight to the last one before the target.
  SNAPSHOT_TOPICS = new Set(['CarData.z', 'Position.z']);

  REPLAY_TICK_MS = 200;

  REPLAY_SPEEDS = [1, 2, 5, 10, 20, 30];

  // Skip straight to just before the green flag by default: archive recordings
  // begin up to an hour before the session actually starts. This much lead-in is
  // kept so the user still catches the grid forming / the start itself.
  REPLAY_LEAD_IN_MS = 15_000;

  stripBom = (text: string) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

  archiveCache = new Map();

  // year -> { data, fetchedAt }

  /**
   * Fetch (and cache) a season's session index. Past seasons are immutable so
   * they cache long; the current season refreshes every few minutes.
   */
  getArchiveIndex = async (year: string) => {
    const y = Number(year);
    if (!Number.isInteger(y) || y < this.ARCHIVE_FIRST_YEAR || y > new Date().getUTCFullYear()) {
      const err: Error & { status?: number } = new Error(
        `No archive for year ${year} (available ${this.ARCHIVE_FIRST_YEAR}+)`,
      );
      err.status = 404;
      throw err;
    }
    const ttl = y === new Date().getUTCFullYear() ? 5 * 60_000 : 6 * 3_600_000;
    const cached = this.archiveCache.get(y);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.data;
    const res = await fetch(`${this.F1_STATIC_BASE}${y}/Index.json`, {
      headers: this.STATIC_HEADERS,
      signal: AbortSignal.any([this.abortController.signal, AbortSignal.timeout(15_000)]),
      redirect: 'error',
    });
    if (!res.ok) {
      const err: Error & { status?: number } = new Error(
        `Archive index fetch failed: HTTP ${res.status}`,
      );
      err.status = res.status === 404 ? 404 : 502;
      throw err;
    }
    const data = JSON.parse(this.stripBom(await readBoundedText(res)));
    this.archiveCache.set(y, { data, fetchedAt: Date.now() });
    return data;
  };

  replay: Replay | null = null;

  // { streams, virtualMs, durationMs, speed, paused, interval, lastTickAt, gen }
  replayGen = 0;
  private replayAbort: AbortController | null = null;

  LINE_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{3})/;

  /** Parse a .jsonStream file into [{ t: msOffset, raw: jsonString }]. */
  parseStream = (text: string): ArchiveLine[] => {
    const lines = this.stripBom(text).split('\n');
    const out = [];
    for (const lineRaw of lines) {
      const line = lineRaw.endsWith('\r') ? lineRaw.slice(0, -1) : lineRaw;
      const m = this.LINE_RE.exec(line);
      if (!m) continue;
      out.push({
        t: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]),
        raw: line.slice(m[0].length),
      });
    }
    return out;
  };

  replayProgress = (): ReplayProgress | null => {
    if (!this.state.replay) return null;
    return {
      ...this.state.replay,
      offsetMs: this.replay ? Math.round(this.replay.virtualMs) : 0,
      durationMs: this.replay ? this.replay.durationMs : 0,
      speed: this.replay ? this.replay.speed : this.state.replay.speed,
      paused: this.replay ? this.replay.paused : false,
    };
  };

  emitReplayProgress = () => this.emitter.emit('replay', this.replayProgress());

  /** Tear down any running replay and free the loaded archive. */
  releaseReplay = () => {
    this.replayAbort?.abort();
    this.replayAbort = null;
    this.replayGen += 1;
    if (this.replay?.interval) clearInterval(this.replay.interval);
    this.replay = null;
    this.state.replay = null;
  };

  /**
   * Advance the replay clock and push every newly-due recorded line through
   * ingest. Delta topics fold all due lines into one merge + one broadcast per
   * tick; snapshot topics only apply the newest due line.
   */
  replayTick = () => {
    if (!this.replay || this.replay.paused) return;
    const now = Date.now();
    this.replay.virtualMs = Math.min(
      this.replay.durationMs,
      this.replay.virtualMs + (now - this.replay.lastTickAt) * this.replay.speed,
    );
    this.replay.lastTickAt = now;

    for (const stream of this.replay.streams) {
      let combined;
      let last = null;
      while (
        stream.idx < stream.lines.length &&
        stream.lines[stream.idx].t <= this.replay.virtualMs
      ) {
        const line = stream.lines[stream.idx];
        stream.idx += 1;
        if (this.SNAPSHOT_TOPICS.has(stream.topic)) {
          last = line;
        } else {
          try {
            combined =
              combined === undefined
                ? JSON.parse(line.raw)
                : this.deepMerge(combined, JSON.parse(line.raw));
          } catch {
            /* skip corrupt line */
          }
        }
      }
      if (last) this.ingest(stream.topic, JSON.parse(last.raw));
      if (combined !== undefined) this.ingest(stream.topic, combined);
    }

    this.emitReplayProgress();
    if (this.replay.virtualMs >= this.replay.durationMs) {
      this.replay.paused = true;
      this.emitReplayProgress();
    }
  };

  /**
   * Find the offset (ms into the recording) at which the session actually goes
   * green. F1's `SessionData.StatusSeries` carries a `SessionStatus: "Started"`
   * marker at lights-out; everything before it is pre-session build-up. Returns 0
   * if no such marker is found (older/partial recordings) so playback just begins
   * at the top.
   */
  findSessionStartMs = (streams: ArchiveStream[]) => {
    const sd = streams.find((s) => s.topic === 'SessionData');
    if (!sd) return 0;
    for (const line of sd.lines) {
      let data;
      try {
        data = JSON.parse(line.raw);
      } catch {
        continue;
      }
      const series = data?.StatusSeries;
      if (!series) continue;
      const entries = Array.isArray(series) ? series : Object.values(series);
      if (entries.some((e: any) => e && e.SessionStatus === 'Started')) return line.t;
    }
    return 0;
  };

  /**
   * Load a session from the archive and start playing it through the live
   * pipeline. Resolves once the streams are downloaded and playback begins.
   */
  startReplay = async (path: string, { name = '', speed = 1 } = {}) => {
    if (
      typeof path !== 'string' ||
      path.length > 300 ||
      !/^\d{4}\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/$/.test(path)
    ) {
      const err: Error & { status?: number } = new Error('Invalid session path');
      err.status = 400;
      throw err;
    }
    // Take over from live/sim/any previous replay.
    this.generation += 1;
    this.teardownSocket();
    if (this.sim) {
      clearInterval(this.sim.interval);
      this.sim = null;
      this.state.simulated = false;
    }
    this.releaseReplay();
    const gen = this.replayGen;
    const replayAbort = (this.replayAbort = new AbortController());

    this.state.replay = { path, name, speed, paused: false, loading: true };
    this.setStatus('connected');
    this.emitReplayProgress();

    const results = await Promise.all(
      this.TOPICS.map(async (topic) => {
        try {
          const res = await fetch(`${this.F1_STATIC_BASE}${path}${topic}.jsonStream`, {
            headers: this.STATIC_HEADERS,
            signal: AbortSignal.any([
              this.abortController.signal,
              replayAbort.signal,
              AbortSignal.timeout(15_000),
            ]),
            redirect: 'error',
          });
          if (!res.ok) return null;
          return { topic, lines: this.parseStream(await readBoundedText(res)), idx: 0 };
        } catch {
          return null; // topic not recorded for this session
        }
      }),
    );
    if (gen !== this.replayGen) return this.getState(); // superseded while downloading

    const streams = results.filter((s): s is ArchiveStream => !!s && s.lines.length > 0);
    if (streams.length === 0) {
      this.state.replay = null;
      this.setStatus('idle');
      const err: Error & { status?: number } = new Error('No recorded data found for this session');
      err.status = 404;
      throw err;
    }

    this.state.topics = {};
    this.state.replay.loading = false;
    this.replay = {
      streams,
      virtualMs: 0,
      durationMs: Math.max(...streams.map((s) => s.lines[s.lines.length - 1].t)),
      speed: this.REPLAY_SPEEDS.includes(Number(speed)) ? Number(speed) : 1,
      paused: false,
      lastTickAt: Date.now(),
      interval: setInterval(this.replayTick, this.REPLAY_TICK_MS),
    };

    // Skip the pre-session build-up by default, landing just before the green
    // flag. seekReplay folds state up to that point and emits the snapshot.
    // startOffsetMs anchors the transport bar so it represents the session, not
    // the (much longer) raw recording with its dead pre-session lead-in.
    const startMs = this.findSessionStartMs(streams);
    const initialMs = startMs > this.REPLAY_LEAD_IN_MS ? startMs - this.REPLAY_LEAD_IN_MS : 0;
    this.state.replay.startOffsetMs = initialMs;
    if (initialMs > 0) {
      this.seekReplay(initialMs);
    } else {
      this.emitter.emit('snapshot');
      this.emitReplayProgress();
    }
    return this.getState();
  };

  stopReplay = () => {
    this.releaseReplay();
    this.state.topics = {};
    this.setStatus('idle');
    this.emitter.emit('replay', null);
    this.emitter.emit('snapshot');
    // Fall back to the real feed if anyone is still watching.
    if (this.state.subscribers > 0 && !this.state.simulated) {
      this.generation += 1;
      this.connect();
    }
    return this.getState();
  };

  setReplayPaused = (paused: boolean) => {
    if (this.replay) {
      if (!paused) this.replay.lastTickAt = Date.now(); // don't credit paused wall time
      this.replay.paused = !!paused;
      this.emitReplayProgress();
    }
    return this.getState();
  };

  setReplaySpeed = (speed: unknown) => {
    if (this.replay && this.REPLAY_SPEEDS.includes(Number(speed))) {
      this.replay.speed = Number(speed);
      this.emitReplayProgress();
    }
    return this.getState();
  };

  /**
   * Jump to an absolute offset. State is rebuilt silently by folding every
   * recorded line up to the target, then broadcast as a single snapshot.
   */
  seekReplay = (offsetMs: unknown) => {
    if (!this.replay) return this.getState();
    const target = Math.max(0, Math.min(Number(offsetMs) || 0, this.replay.durationMs));
    this.state.topics = {};
    for (const stream of this.replay.streams) {
      stream.idx = 0;
      if (this.SNAPSHOT_TOPICS.has(stream.topic)) {
        let last = null;
        while (stream.idx < stream.lines.length && stream.lines[stream.idx].t <= target) {
          last = stream.lines[stream.idx];
          stream.idx += 1;
        }
        if (last) this.ingest(stream.topic, JSON.parse(last.raw), null, { silent: true });
      } else {
        while (stream.idx < stream.lines.length && stream.lines[stream.idx].t <= target) {
          try {
            this.ingest(stream.topic, JSON.parse(stream.lines[stream.idx].raw), null, {
              silent: true,
            });
          } catch {
            /* skip corrupt line */
          }
          stream.idx += 1;
        }
      }
    }
    this.replay.virtualMs = target;
    this.replay.lastTickAt = Date.now();
    this.emitter.emit('snapshot');
    this.emitReplayProgress();
    return this.getState();
  };

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  onModuleDestroy() {
    this.destroyed = true;
    this.generation += 1;
    this.abortController.abort();
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    this.teardownSocket();
    if (this.sim) clearInterval(this.sim.interval);
    this.sim = null;
    this.releaseReplay();
    this.emitter.emit('shutdown');
    this.emitter.removeAllListeners();
    this.archiveCache.clear();
    this.state.subscribers = 0;
    this.state.simulated = false;
    this.state.topics = {};
    this.state.status = 'idle';
  }
}
