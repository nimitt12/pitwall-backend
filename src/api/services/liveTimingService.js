const zlib = require('zlib');
const { EventEmitter } = require('events');
const WebSocket = require('ws');

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
const F1_BASE = 'https://livetiming.formula1.com/signalrcore';
const F1_WS_URL = 'wss://livetiming.formula1.com/signalrcore';
// SignalR Core frames are terminated by the ASCII record separator.
const RS = '\x1e';
// Optional F1 TV subscription token (JWT) — attached as a bearer token if the
// feed ever starts rejecting anonymous access like the legacy endpoint does.
const F1_AUTH_TOKEN = process.env.F1_LIVETIMING_TOKEN || null;

// Every topic the official timing screens use. `.z` topics arrive
// base64+deflate-compressed and are stored under their bare name.
const TOPICS = [
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
const IDLE_DISCONNECT_MS = 60_000;
// If upstream goes silent for this long the socket is presumed dead.
const STALE_FEED_MS = 90_000;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const state = {
    topics: {},          // topic name -> latest merged value
    status: 'idle',      // idle | connecting | connected | error
    simulated: false,
    replay: null,        // { path, name, speed, paused, loading, offsetMs, durationMs }
    lastFeedAt: null,
    subscribers: 0,
    error: null,
};

let socket = null;
let idleTimer = null;
let staleTimer = null;
let reconnectDelay = 2000;
let generation = 0; // invalidates callbacks from abandoned connections

/* ------------------------------------------------------------------ */
/* State merging                                                       */
/* ------------------------------------------------------------------ */

/**
 * Merge an F1 feed delta into the current value. Objects merge key-by-key
 * recursively; anything else (strings, numbers, arrays sent whole) replaces.
 * Array patches arrive as objects keyed by stringified index ("0", "5", ...)
 * and are applied per-index onto the existing array.
 */
const deepMerge = (base, patch) => {
    if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return patch;
    if (Array.isArray(base)) {
        const next = base.slice();
        for (const [key, value] of Object.entries(patch)) {
            const idx = Number(key);
            if (Number.isInteger(idx)) next[idx] = deepMerge(next[idx], value);
        }
        return next;
    }
    const target = base && typeof base === 'object' ? { ...base } : {};
    for (const [key, value] of Object.entries(patch)) {
        target[key] = deepMerge(target[key], value);
    }
    return target;
};

const inflate = (b64) =>
    JSON.parse(zlib.inflateRawSync(Buffer.from(b64, 'base64')).toString('utf8'));

/**
 * Single ingest path for the real feed, the simulator and archive replay:
 * normalize the topic, update merged state, notify subscribers. `silent`
 * skips the per-update broadcast (used when fast-forwarding a replay seek —
 * one snapshot event goes out at the end instead).
 */
const ingest = (topic, data, timestamp, { replace = false, silent = false } = {}) => {
    let name = topic;
    let value = data;
    if (name.endsWith('.z')) {
        name = name.slice(0, -2);
        try {
            value = inflate(data);
        } catch (err) {
            console.error(`Live timing: failed to inflate ${topic}:`, err.message);
            return;
        }
        replace = true; // compressed topics are full snapshots, not deltas
    }
    state.topics[name] = replace ? value : deepMerge(state.topics[name], value);
    state.lastFeedAt = Date.now();
    if (!silent) {
        emitter.emit('update', { topic: name, data: value, timestamp: timestamp || new Date().toISOString() });
    }
};

const setStatus = (status, error = null) => {
    state.status = status;
    state.error = error;
    emitter.emit('status', { status, error, simulated: state.simulated });
};

/* ------------------------------------------------------------------ */
/* Upstream SignalR connection                                         */
/* ------------------------------------------------------------------ */

const negotiate = async () => {
    const res = await fetch(`${F1_BASE}/negotiate?negotiateVersion=1`, {
        method: 'POST',
        headers: {
            'User-Agent': 'BestHTTP',
            ...(F1_AUTH_TOKEN ? { Authorization: `Bearer ${F1_AUTH_TOKEN}` } : {}),
        },
    });
    if (!res.ok) throw new Error(`negotiate failed: HTTP ${res.status}`);
    const body = await res.json();
    // The AWSALB affinity cookies from negotiate must be echoed on the socket.
    const cookie = (res.headers.getSetCookie ? res.headers.getSetCookie() : [])
        .map((c) => c.split(';')[0])
        .join('; ');
    return { token: body.connectionToken || body.connectionId, cookie };
};

const teardownSocket = () => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = null;
    if (socket) {
        socket.removeAllListeners();
        try { socket.close(); } catch { /* already closed */ }
        socket = null;
    }
};

const bumpStaleTimer = (gen) => {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(() => {
        if (gen !== generation) return;
        console.warn('Live timing: feed went stale, reconnecting');
        teardownSocket();
        scheduleReconnect(gen);
    }, STALE_FEED_MS);
};

const scheduleReconnect = (gen) => {
    if (gen !== generation || state.subscribers === 0 || state.simulated) return;
    setStatus('connecting');
    const delay = reconnectDelay;
    reconnectDelay = Math.min(reconnectDelay * 2, 60_000);
    setTimeout(() => {
        if (gen === generation && state.subscribers > 0 && !state.simulated) connect();
    }, delay);
};

const connect = async () => {
    const gen = generation;
    setStatus('connecting');
    let session;
    try {
        session = await negotiate();
    } catch (err) {
        console.error('Live timing: negotiate error:', err.message);
        setStatus('error', err.message);
        scheduleReconnect(gen);
        return;
    }
    if (gen !== generation) return;

    const qs =
        `id=${encodeURIComponent(session.token)}` +
        (F1_AUTH_TOKEN ? `&access_token=${encodeURIComponent(F1_AUTH_TOKEN)}` : '');

    socket = new WebSocket(`${F1_WS_URL}?${qs}`, {
        headers: {
            'User-Agent': 'BestHTTP',
            'Accept-Encoding': 'gzip,identity',
            ...(session.cookie ? { Cookie: session.cookie } : {}),
        },
    });

    let handshakeDone = false;
    let pingTimer = null;

    socket.on('open', () => {
        if (gen !== generation) return;
        reconnectDelay = 2000;
        // SignalR Core protocol handshake, then subscribe once it's acked.
        socket.send(`{"protocol":"json","version":1}${RS}`);
        bumpStaleTimer(gen);
        pingTimer = setInterval(() => {
            try { socket.send(`{"type":6}${RS}`); } catch { /* closing */ }
        }, 15000);
    });

    socket.on('message', (raw) => {
        if (gen !== generation) return;
        bumpStaleTimer(gen);
        const frames = raw.toString().split(RS).filter(Boolean);
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
                setStatus('connected');
                socket.send(JSON.stringify({
                    type: 1, invocationId: '1', target: 'Subscribe', arguments: [TOPICS],
                }) + RS);
                continue;
            }
            // type 3: invocation result — the full snapshot keyed by topic.
            if (msg.type === 3 && msg.result && typeof msg.result === 'object') {
                for (const [topic, data] of Object.entries(msg.result)) {
                    ingest(topic, data, null, { replace: true });
                }
                emitter.emit('snapshot');
            }
            // type 1: streaming invocation — feed(topic, data, timestamp).
            if (msg.type === 1 && msg.target === 'feed' && Array.isArray(msg.arguments)) {
                ingest(msg.arguments[0], msg.arguments[1], msg.arguments[2]);
            }
            // type 7: server is closing the connection.
            if (msg.type === 7) socket.close();
        }
    });

    const clearPing = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
    };

    socket.on('error', (err) => {
        if (gen !== generation) return;
        console.error('Live timing: socket error:', err.message);
    });

    socket.on('close', () => {
        clearPing();
        if (gen !== generation) return;
        teardownSocket();
        scheduleReconnect(gen);
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
const addSubscriber = ({ onUpdate, onStatus, onReplay, onSnapshot }) => {
    state.subscribers += 1;
    emitter.on('update', onUpdate);
    if (onStatus) emitter.on('status', onStatus);
    if (onReplay) emitter.on('replay', onReplay);
    if (onSnapshot) emitter.on('snapshot', onSnapshot);

    if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
    }
    if (!state.simulated && !state.replay && !socket && state.status !== 'connecting') {
        generation += 1;
        connect();
    }

    return () => {
        state.subscribers = Math.max(0, state.subscribers - 1);
        emitter.off('update', onUpdate);
        if (onStatus) emitter.off('status', onStatus);
        if (onReplay) emitter.off('replay', onReplay);
        if (onSnapshot) emitter.off('snapshot', onSnapshot);
        if (state.subscribers === 0 && !state.simulated) {
            idleTimer = setTimeout(() => {
                if (state.subscribers === 0 && !state.simulated) {
                    generation += 1; // invalidate reconnect loops
                    teardownSocket();
                    releaseReplay(); // free the loaded session archive
                    setStatus('idle');
                }
            }, IDLE_DISCONNECT_MS);
        }
    };
};

const getState = () => ({
    status: state.status,
    simulated: state.simulated,
    replay: replayProgress(),
    lastFeedAt: state.lastFeedAt,
    subscribers: state.subscribers,
    error: state.error,
    topics: state.topics,
});

/* ------------------------------------------------------------------ */
/* Simulator                                                           */
/* ------------------------------------------------------------------ */

const SIM_GRID = [
    { num: '4',  tla: 'NOR', first: 'Lando',    last: 'Norris',     team: 'McLaren',       color: 'F58020', pace: 0.00 },
    { num: '81', tla: 'PIA', first: 'Oscar',    last: 'Piastri',    team: 'McLaren',       color: 'F58020', pace: 0.05 },
    { num: '1',  tla: 'VER', first: 'Max',      last: 'Verstappen', team: 'Red Bull',      color: '3671C6', pace: 0.08 },
    { num: '22', tla: 'TSU', first: 'Yuki',     last: 'Tsunoda',    team: 'Red Bull',      color: '3671C6', pace: 0.40 },
    { num: '16', tla: 'LEC', first: 'Charles',  last: 'Leclerc',    team: 'Ferrari',       color: 'E8002D', pace: 0.12 },
    { num: '44', tla: 'HAM', first: 'Lewis',    last: 'Hamilton',   team: 'Ferrari',       color: 'E8002D', pace: 0.18 },
    { num: '63', tla: 'RUS', first: 'George',   last: 'Russell',    team: 'Mercedes',      color: '27F4D2', pace: 0.15 },
    { num: '12', tla: 'ANT', first: 'Kimi',     last: 'Antonelli',  team: 'Mercedes',      color: '27F4D2', pace: 0.25 },
    { num: '14', tla: 'ALO', first: 'Fernando', last: 'Alonso',     team: 'Aston Martin',  color: '229971', pace: 0.35 },
    { num: '18', tla: 'STR', first: 'Lance',    last: 'Stroll',     team: 'Aston Martin',  color: '229971', pace: 0.55 },
    { num: '10', tla: 'GAS', first: 'Pierre',   last: 'Gasly',      team: 'Alpine',        color: '0093CC', pace: 0.45 },
    { num: '43', tla: 'COL', first: 'Franco',   last: 'Colapinto',  team: 'Alpine',        color: '0093CC', pace: 0.60 },
    { num: '23', tla: 'ALB', first: 'Alexander', last: 'Albon',     team: 'Williams',      color: '64C4FF', pace: 0.30 },
    { num: '55', tla: 'SAI', first: 'Carlos',   last: 'Sainz',      team: 'Williams',      color: '64C4FF', pace: 0.28 },
    { num: '6',  tla: 'HAD', first: 'Isack',    last: 'Hadjar',     team: 'Racing Bulls',  color: '6692FF', pace: 0.42 },
    { num: '30', tla: 'LAW', first: 'Liam',     last: 'Lawson',     team: 'Racing Bulls',  color: '6692FF', pace: 0.50 },
    { num: '27', tla: 'HUL', first: 'Nico',     last: 'Hulkenberg', team: 'Audi',          color: '00E701', pace: 0.52 },
    { num: '5',  tla: 'BOR', first: 'Gabriel',  last: 'Bortoleto',  team: 'Audi',          color: '00E701', pace: 0.58 },
    { num: '31', tla: 'OCO', first: 'Esteban',  last: 'Ocon',       team: 'Haas',          color: 'B6BABD', pace: 0.48 },
    { num: '87', tla: 'BEA', first: 'Oliver',   last: 'Bearman',    team: 'Haas',          color: 'B6BABD', pace: 0.46 },
    { num: '11', tla: 'PER', first: 'Sergio',   last: 'Perez',      team: 'Cadillac',      color: 'BFB07E', pace: 0.65 },
    { num: '77', tla: 'BOT', first: 'Valtteri', last: 'Bottas',     team: 'Cadillac',      color: 'BFB07E', pace: 0.70 },
];

// Closed loop of waypoints tracing Silverstone (normalized 0-100 coords from
// the frontend's track silhouette data) — simulated cars lap around it so the
// live track map draws a believable circuit.
const SIM_TRACK = [
    [54.8, 8.8], [63.9, 8.0], [67.6, 9.1], [69.7, 13.1], [71.5, 21.5], [72.0, 31.8],
    [73.8, 36.7], [74.1, 39.7], [72.4, 45.4], [74.8, 49.7], [75.1, 51.8], [72.8, 54.9],
    [69.0, 57.5], [65.9, 63.0], [54.8, 83.4], [50.1, 90.5], [47.3, 92.0], [44.5, 91.3],
    [41.9, 87.2], [38.8, 82.7], [32.7, 75.7], [29.8, 77.1], [27.1, 75.7], [25.2, 72.3],
    [26.0, 68.3], [36.9, 54.0], [40.8, 49.7], [43.9, 49.5], [49.5, 50.2], [53.1, 49.1],
    [60.1, 43.6], [62.7, 43.8], [64.8, 48.9], [66.6, 47.6], [67.8, 44.0], [68.0, 40.5],
    [44.5, 18.7], [42.0, 17.7], [39.2, 19.6], [38.4, 24.1], [36.2, 25.2], [34.0, 23.9],
    [33.7, 21.8], [37.2, 14.7], [40.4, 11.6], [43.9, 9.9], [46.4, 9.6],
];

const SIM_LAP_BASE = 88.5; // seconds around Silverstone
const SIM_TOTAL_LAPS = 52;
const SIM_TICK_MS = 1000;
const COMPOUNDS = ['SOFT', 'MEDIUM', 'HARD'];

let sim = null;

const fmtLap = (s) => {
    const m = Math.floor(s / 60);
    return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`;
};
const fmtGap = (s) => `+${s.toFixed(3)}`;
const utc = () => new Date().toISOString().replace('Z', '');

const simTrackPos = (progress) => {
    const t = progress * SIM_TRACK.length;
    const i = Math.floor(t) % SIM_TRACK.length;
    const j = (i + 1) % SIM_TRACK.length;
    const f = t - Math.floor(t);
    // Scale into telemetry-like coordinates so the map code paths match reality.
    return {
        X: Math.round((SIM_TRACK[i][0] + (SIM_TRACK[j][0] - SIM_TRACK[i][0]) * f) * 100),
        Y: Math.round(-(SIM_TRACK[i][1] + (SIM_TRACK[j][1] - SIM_TRACK[i][1]) * f) * 100),
    };
};

const startSimulation = () => {
    if (sim) return getState();
    // Take over cleanly from any real connection or running replay.
    generation += 1;
    teardownSocket();
    releaseReplay();
    state.simulated = true;
    state.topics = {};

    const now = Date.now();
    const cars = SIM_GRID.map((d, i) => ({
        ...d,
        line: i + 1,
        totalDist: -i * 0.004,          // grid spread
        bestLap: null,
        lastLap: null,
        lastLapPersonalBest: false,
        lastLapOverallBest: false,
        lapStartDist: 0,
        laps: 0,
        pits: 0,
        stint: { compound: COMPOUNDS[i % 2 === 0 ? 1 : 0], age: 0, new: 'true' },
        stints: [],
        inPit: false,
        pitUntil: 0,
        retired: false,
        sectors: [null, null, null],
        speed: 280,
    }));
    cars.forEach((c) => c.stints.push({ Compound: c.stint.compound, New: c.stint.new, TotalLaps: 0, StartLaps: 0 }));

    let overallBest = Infinity;
    let lap = 1;
    let trackStatus = { Status: '1', Message: 'AllClear' };
    let rcCounter = 0;
    const raceControl = [];
    const pushRC = (Message, extra = {}) => {
        raceControl.push({ Utc: utc(), Lap: lap, Category: extra.Category || 'Other', Message, Flag: extra.Flag, Scope: extra.Scope });
        rcCounter += 1;
    };
    pushRC('GREEN LIGHT - PIT EXIT OPEN', { Category: 'Flag', Flag: 'GREEN', Scope: 'Track' });

    // Seed every topic with a full snapshot so late joiners get complete state.
    const snapshot = () => {
        ingest('SessionInfo', {
            Meeting: {
                Name: 'British Grand Prix', OfficialName: 'FORMULA 1 BRITISH GRAND PRIX 2026',
                Location: 'Silverstone', Country: { Name: 'United Kingdom', Code: 'GBR' },
                Circuit: { ShortName: 'Silverstone' },
            },
            Name: 'Race', Type: 'Race', StartDate: new Date(now).toISOString(),
        }, null, { replace: true });
        ingest('TrackStatus', trackStatus, null, { replace: true });
        ingest('LapCount', { CurrentLap: lap, TotalLaps: SIM_TOTAL_LAPS }, null, { replace: true });
        ingest('WeatherData', {
            AirTemp: '21.4', TrackTemp: '38.2', Humidity: '54.0',
            Pressure: '1011.2', Rainfall: '0', WindSpeed: '3.4', WindDirection: '210',
        }, null, { replace: true });
        ingest('DriverList', Object.fromEntries(cars.map((c) => [c.num, {
            RacingNumber: c.num, BroadcastName: `${c.first[0]} ${c.last.toUpperCase()}`,
            FullName: `${c.first} ${c.last}`, Tla: c.tla, Line: c.line,
            TeamName: c.team, TeamColour: c.color,
            FirstName: c.first, LastName: c.last, Reference: c.tla,
        }])), null, { replace: true });
        ingest('RaceControlMessages', { Messages: raceControl.slice() }, null, { replace: true });
        emitTiming(true);
        emitCarData();
        emitPosition();
        emitter.emit('snapshot');
    };

    const emitTiming = (replace = false) => {
        const ordered = cars.slice().sort((a, b) => {
            if (a.retired !== b.retired) return a.retired ? 1 : -1;
            return b.totalDist - a.totalDist;
        });
        const leader = ordered[0];
        const lines = {};
        ordered.forEach((c, idx) => {
            const ahead = idx > 0 ? ordered[idx - 1] : null;
            // distance (in laps) -> seconds, using base lap time
            const gapS = c.retired ? null : (leader.totalDist - c.totalDist) * SIM_LAP_BASE;
            const intS = c.retired || !ahead ? null : (ahead.totalDist - c.totalDist) * SIM_LAP_BASE;
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
                GapToLeader: c.retired ? '' : idx === 0 ? '' : gapS > SIM_LAP_BASE ? `${Math.floor(gapS / SIM_LAP_BASE)}L` : fmtGap(gapS),
                IntervalToPositionAhead: { Value: c.retired ? '' : idx === 0 ? '' : intS > SIM_LAP_BASE ? `${Math.floor(intS / SIM_LAP_BASE)}L` : fmtGap(intS), Catching: intS !== null && intS < 1.0 },
                LastLapTime: {
                    Value: c.lastLap ? fmtLap(c.lastLap) : '',
                    PersonalFastest: c.lastLapPersonalBest,
                    OverallFastest: c.lastLapOverallBest,
                },
                BestLapTime: { Value: c.bestLap ? fmtLap(c.bestLap) : '', Lap: c.laps },
                Sectors: c.sectors.map((s, si) => ({
                    Value: s ? s.value.toFixed(3) : '',
                    PersonalFastest: s ? s.pb : false,
                    OverallFastest: s ? s.ob : false,
                    Segments: Array.from({ length: [7, 8, 6][si] }, (_, k) => ({
                        Status: !s ? 0 : s.ob && k % 3 === 0 ? 2051 : s.pb && k % 2 === 0 ? 2049 : 2048,
                    })),
                })),
                Speeds: {
                    ST: { Value: String(Math.round(c.speed + 25)), PersonalFastest: false, OverallFastest: false },
                },
            };
        });
        ingest('TimingData', { Lines: lines, SessionPart: 0 }, null, { replace });
        ingest('TimingAppData', {
            Lines: Object.fromEntries(cars.map((c) => [c.num, {
                RacingNumber: c.num, Line: c.line,
                Stints: c.stints.map((s) => ({ ...s })),
            }])),
        }, null, { replace });
    };

    const emitCarData = () => {
        const carsChannels = {};
        cars.forEach((c) => {
            const throttle = c.inPit ? 40 : 60 + Math.round(Math.random() * 40);
            carsChannels[c.num] = {
                Channels: {
                    0: 9500 + Math.round(Math.random() * 2500),                 // RPM
                    2: Math.round(c.speed),                                     // Speed
                    3: c.inPit ? 2 : 5 + Math.round(Math.random() * 3),         // Gear
                    4: throttle,                                                // Throttle
                    5: throttle > 92 ? 0 : Math.round(Math.random() * 60),      // Brake
                    45: !c.inPit && Math.random() > 0.6 ? 12 : 8,               // DRS (10/12/14 = open)
                },
            };
        });
        // Mirror the real feed: entries batched with a timestamp, ingested as a .z snapshot topic.
        state.topics.CarData = { Entries: [{ Utc: new Date().toISOString(), Cars: carsChannels }] };
        state.lastFeedAt = Date.now();
        emitter.emit('update', { topic: 'CarData', data: state.topics.CarData, timestamp: new Date().toISOString() });
    };

    const emitPosition = () => {
        const entries = {};
        cars.forEach((c) => {
            const p = simTrackPos(((c.totalDist % 1) + 1) % 1);
            entries[c.num] = { Status: c.retired ? 'Retired' : 'OnTrack', X: p.X, Y: p.Y, Z: 0 };
        });
        state.topics.Position = { Position: [{ Timestamp: new Date().toISOString(), Entries: entries }] };
        state.lastFeedAt = Date.now();
        emitter.emit('update', { topic: 'Position', data: state.topics.Position, timestamp: new Date().toISOString() });
    };

    snapshot();
    setStatus('connected');

    let tick = 0;
    const interval = setInterval(() => {
        tick += 1;
        const scPhase = trackStatus.Status === '4';

        cars.forEach((c) => {
            if (c.retired) return;
            // advance: fraction of a lap per tick, modulated by pace, tyre age, pit, SC
            const degradation = 1 + c.stint.age * 0.0006;
            const variance = 1 + (Math.random() - 0.5) * 0.015;
            let lapTime = (SIM_LAP_BASE + c.pace) * degradation * variance;
            if (scPhase) lapTime *= 1.45;
            if (c.inPit) {
                if (Date.now() >= c.pitUntil) {
                    c.inPit = false;
                    c.stint = { compound: COMPOUNDS[Math.floor(Math.random() * 3)], age: 0, new: 'true' };
                    c.stints.push({ Compound: c.stint.compound, New: 'true', TotalLaps: 0, StartLaps: c.laps });
                    c.pitUntil = Date.now(); // marks PitOut window
                } else {
                    lapTime *= 3.2;
                }
            }
            const prevDist = c.totalDist;
            c.totalDist += (SIM_TICK_MS / 1000) / lapTime;
            c.speed = c.inPit ? 80 : scPhase ? 120 + Math.random() * 30 : 250 + Math.random() * 80;

            // Sector boundaries at 1/3 and 2/3 of each lap
            const lapFrac = ((c.totalDist % 1) + 1) % 1;
            const prevFrac = ((prevDist % 1) + 1) % 1;
            const crossed = (b) => prevFrac < b && lapFrac >= b;
            const sectorTime = () => lapTime / 3 + (Math.random() - 0.5) * 0.4;
            if (crossed(1 / 3)) c.sectors[0] = { value: sectorTime(), pb: Math.random() > 0.75, ob: Math.random() > 0.94 };
            if (crossed(2 / 3)) c.sectors[1] = { value: sectorTime(), pb: Math.random() > 0.75, ob: Math.random() > 0.94 };

            // Lap completed
            if (Math.floor(c.totalDist) > Math.floor(prevDist) && c.totalDist > 0) {
                c.laps += 1;
                c.stint.age += 1;
                c.stints[c.stints.length - 1].TotalLaps = c.stint.age;
                c.sectors[2] = { value: sectorTime(), pb: Math.random() > 0.75, ob: Math.random() > 0.94 };
                c.lastLap = lapTime;
                c.lastLapPersonalBest = !c.bestLap || lapTime < c.bestLap;
                if (c.lastLapPersonalBest) c.bestLap = lapTime;
                c.lastLapOverallBest = lapTime < overallBest;
                if (c.lastLapOverallBest) {
                    overallBest = lapTime;
                    pushRC(`FASTEST LAP: CAR ${c.num} (${c.tla}) TIME ${fmtLap(lapTime)}`, { Category: 'Other' });
                    ingest('RaceControlMessages', { Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] } });
                }
                // Pit strategy: window around lap 16-22 and 34-40
                if (!c.inPit && !scPhase && ((c.stint.age > 14 && Math.random() < 0.12) || c.stint.age > 26)) {
                    c.inPit = true;
                    c.pits += 1;
                    c.pitUntil = Date.now() + 21000 + Math.random() * 4000;
                }
            }
        });

        const leaderLaps = Math.max(...cars.map((c) => Math.floor(c.totalDist))) + 1;
        if (leaderLaps > lap && leaderLaps <= SIM_TOTAL_LAPS) {
            lap = leaderLaps;
            ingest('LapCount', { CurrentLap: lap });
        }

        // Occasional incidents: yellow -> SC -> green
        if (!scPhase && tick % 30 === 0 && Math.random() < 0.12 && lap > 3) {
            trackStatus = { Status: '2', Message: 'Yellow' };
            ingest('TrackStatus', trackStatus, null, { replace: true });
            pushRC('YELLOW FLAG - SECTOR 2 INCIDENT', { Category: 'Flag', Flag: 'YELLOW', Scope: 'Sector' });
            ingest('RaceControlMessages', { Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] } });
            setTimeout(() => {
                if (!sim) return;
                trackStatus = { Status: '1', Message: 'AllClear' };
                ingest('TrackStatus', trackStatus, null, { replace: true });
                pushRC('CLEAR - TRACK CLEAR', { Category: 'Flag', Flag: 'CLEAR', Scope: 'Track' });
                ingest('RaceControlMessages', { Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] } });
            }, 15000 + Math.random() * 10000);
        }

        // Rare retirement
        if (tick % 45 === 0 && Math.random() < 0.08) {
            const alive = cars.filter((c) => !c.retired && c.line > 5);
            if (alive.length > 12) {
                const victim = alive[Math.floor(Math.random() * alive.length)];
                victim.retired = true;
                pushRC(`CAR ${victim.num} (${victim.tla}) RETIRED`, { Category: 'Other' });
                ingest('RaceControlMessages', { Messages: { [rcCounter - 1]: raceControl[raceControl.length - 1] } });
            }
        }

        // Weather drift
        if (tick % 20 === 0) {
            ingest('WeatherData', {
                AirTemp: (21 + Math.random() * 2).toFixed(1),
                TrackTemp: (37 + Math.random() * 3).toFixed(1),
                WindSpeed: (2 + Math.random() * 3).toFixed(1),
            });
        }

        emitTiming();
        emitCarData();
        emitPosition();
    }, SIM_TICK_MS);

    sim = { interval };
    return getState();
};

const stopSimulation = () => {
    if (!sim) return getState();
    clearInterval(sim.interval);
    sim = null;
    state.simulated = false;
    state.topics = {};
    setStatus('idle');
    // If clients are still watching, fall back to the real feed.
    if (state.subscribers > 0) {
        generation += 1;
        connect();
    }
    return getState();
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

const F1_STATIC_BASE = 'https://livetiming.formula1.com/static/';
// Same UA the official clients send; some CDN configs reject default agents.
const STATIC_HEADERS = { 'User-Agent': 'BestHTTP', 'Accept-Encoding': 'gzip' };
const ARCHIVE_FIRST_YEAR = 2018;
// Full snapshots (not deltas) — during replay only the newest due line
// matters, and seeks can jump straight to the last one before the target.
const SNAPSHOT_TOPICS = new Set(['CarData.z', 'Position.z']);
const REPLAY_TICK_MS = 200;
const REPLAY_SPEEDS = [1, 2, 5, 10, 20, 30];
// Skip straight to just before the green flag by default: archive recordings
// begin up to an hour before the session actually starts. This much lead-in is
// kept so the user still catches the grid forming / the start itself.
const REPLAY_LEAD_IN_MS = 15_000;

const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const archiveCache = new Map(); // year -> { data, fetchedAt }

/**
 * Fetch (and cache) a season's session index. Past seasons are immutable so
 * they cache long; the current season refreshes every few minutes.
 */
const getArchiveIndex = async (year) => {
    const y = Number(year);
    if (!Number.isInteger(y) || y < ARCHIVE_FIRST_YEAR || y > new Date().getUTCFullYear()) {
        const err = new Error(`No archive for year ${year} (available ${ARCHIVE_FIRST_YEAR}+)`);
        err.status = 404;
        throw err;
    }
    const ttl = y === new Date().getUTCFullYear() ? 5 * 60_000 : 6 * 3_600_000;
    const cached = archiveCache.get(y);
    if (cached && Date.now() - cached.fetchedAt < ttl) return cached.data;
    const res = await fetch(`${F1_STATIC_BASE}${y}/Index.json`, { headers: STATIC_HEADERS });
    if (!res.ok) {
        const err = new Error(`Archive index fetch failed: HTTP ${res.status}`);
        err.status = res.status === 404 ? 404 : 502;
        throw err;
    }
    const data = JSON.parse(stripBom(await res.text()));
    archiveCache.set(y, { data, fetchedAt: Date.now() });
    return data;
};

let replay = null; // { streams, virtualMs, durationMs, speed, paused, interval, lastTickAt, gen }
let replayGen = 0;

const LINE_RE = /^(\d+):(\d{2}):(\d{2})\.(\d{3})/;

/** Parse a .jsonStream file into [{ t: msOffset, raw: jsonString }]. */
const parseStream = (text) => {
    const lines = stripBom(text).split('\n');
    const out = [];
    for (const lineRaw of lines) {
        const line = lineRaw.endsWith('\r') ? lineRaw.slice(0, -1) : lineRaw;
        const m = LINE_RE.exec(line);
        if (!m) continue;
        out.push({
            t: (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000 + Number(m[4]),
            raw: line.slice(m[0].length),
        });
    }
    return out;
};

const replayProgress = () => {
    if (!state.replay) return null;
    return {
        ...state.replay,
        offsetMs: replay ? Math.round(replay.virtualMs) : 0,
        durationMs: replay ? replay.durationMs : 0,
        speed: replay ? replay.speed : state.replay.speed,
        paused: replay ? replay.paused : false,
    };
};

const emitReplayProgress = () => emitter.emit('replay', replayProgress());

/** Tear down any running replay and free the loaded archive. */
const releaseReplay = () => {
    replayGen += 1;
    if (replay?.interval) clearInterval(replay.interval);
    replay = null;
    state.replay = null;
};

/**
 * Advance the replay clock and push every newly-due recorded line through
 * ingest. Delta topics fold all due lines into one merge + one broadcast per
 * tick; snapshot topics only apply the newest due line.
 */
const replayTick = () => {
    if (!replay || replay.paused) return;
    const now = Date.now();
    replay.virtualMs = Math.min(
        replay.durationMs,
        replay.virtualMs + (now - replay.lastTickAt) * replay.speed,
    );
    replay.lastTickAt = now;

    for (const stream of replay.streams) {
        let combined;
        let last = null;
        while (stream.idx < stream.lines.length && stream.lines[stream.idx].t <= replay.virtualMs) {
            const line = stream.lines[stream.idx];
            stream.idx += 1;
            if (SNAPSHOT_TOPICS.has(stream.topic)) {
                last = line;
            } else {
                try {
                    combined = combined === undefined
                        ? JSON.parse(line.raw)
                        : deepMerge(combined, JSON.parse(line.raw));
                } catch { /* skip corrupt line */ }
            }
        }
        if (last) ingest(stream.topic, JSON.parse(last.raw));
        if (combined !== undefined) ingest(stream.topic, combined);
    }

    emitReplayProgress();
    if (replay.virtualMs >= replay.durationMs) {
        replay.paused = true;
        emitReplayProgress();
    }
};

/**
 * Find the offset (ms into the recording) at which the session actually goes
 * green. F1's `SessionData.StatusSeries` carries a `SessionStatus: "Started"`
 * marker at lights-out; everything before it is pre-session build-up. Returns 0
 * if no such marker is found (older/partial recordings) so playback just begins
 * at the top.
 */
const findSessionStartMs = (streams) => {
    const sd = streams.find((s) => s.topic === 'SessionData');
    if (!sd) return 0;
    for (const line of sd.lines) {
        let data;
        try { data = JSON.parse(line.raw); } catch { continue; }
        const series = data?.StatusSeries;
        if (!series) continue;
        const entries = Array.isArray(series) ? series : Object.values(series);
        if (entries.some((e) => e && e.SessionStatus === 'Started')) return line.t;
    }
    return 0;
};

/**
 * Load a session from the archive and start playing it through the live
 * pipeline. Resolves once the streams are downloaded and playback begins.
 */
const startReplay = async (path, { name = '', speed = 1 } = {}) => {
    if (!path || !/^\d{4}\/[^.]+\/$/.test(path)) {
        const err = new Error('Invalid session path');
        err.status = 400;
        throw err;
    }
    // Take over from live/sim/any previous replay.
    generation += 1;
    teardownSocket();
    if (sim) {
        clearInterval(sim.interval);
        sim = null;
        state.simulated = false;
    }
    releaseReplay();
    const gen = replayGen;

    state.replay = { path, name, speed, paused: false, loading: true };
    setStatus('connected');
    emitReplayProgress();

    const results = await Promise.all(TOPICS.map(async (topic) => {
        try {
            const res = await fetch(`${F1_STATIC_BASE}${path}${topic}.jsonStream`, { headers: STATIC_HEADERS });
            if (!res.ok) return null;
            return { topic, lines: parseStream(await res.text()), idx: 0 };
        } catch {
            return null; // topic not recorded for this session
        }
    }));
    if (gen !== replayGen) return getState(); // superseded while downloading

    const streams = results.filter((s) => s && s.lines.length > 0);
    if (streams.length === 0) {
        state.replay = null;
        setStatus('idle');
        const err = new Error('No recorded data found for this session');
        err.status = 404;
        throw err;
    }

    state.topics = {};
    state.replay.loading = false;
    replay = {
        streams,
        virtualMs: 0,
        durationMs: Math.max(...streams.map((s) => s.lines[s.lines.length - 1].t)),
        speed: REPLAY_SPEEDS.includes(Number(speed)) ? Number(speed) : 1,
        paused: false,
        lastTickAt: Date.now(),
        interval: setInterval(replayTick, REPLAY_TICK_MS),
    };

    // Skip the pre-session build-up by default, landing just before the green
    // flag. seekReplay folds state up to that point and emits the snapshot.
    // startOffsetMs anchors the transport bar so it represents the session, not
    // the (much longer) raw recording with its dead pre-session lead-in.
    const startMs = findSessionStartMs(streams);
    const initialMs = startMs > REPLAY_LEAD_IN_MS ? startMs - REPLAY_LEAD_IN_MS : 0;
    state.replay.startOffsetMs = initialMs;
    if (initialMs > 0) {
        seekReplay(initialMs);
    } else {
        emitter.emit('snapshot');
        emitReplayProgress();
    }
    return getState();
};

const stopReplay = () => {
    releaseReplay();
    state.topics = {};
    setStatus('idle');
    emitter.emit('replay', null);
    emitter.emit('snapshot');
    // Fall back to the real feed if anyone is still watching.
    if (state.subscribers > 0 && !state.simulated) {
        generation += 1;
        connect();
    }
    return getState();
};

const setReplayPaused = (paused) => {
    if (replay) {
        if (!paused) replay.lastTickAt = Date.now(); // don't credit paused wall time
        replay.paused = !!paused;
        emitReplayProgress();
    }
    return getState();
};

const setReplaySpeed = (speed) => {
    if (replay && REPLAY_SPEEDS.includes(Number(speed))) {
        replay.speed = Number(speed);
        emitReplayProgress();
    }
    return getState();
};

/**
 * Jump to an absolute offset. State is rebuilt silently by folding every
 * recorded line up to the target, then broadcast as a single snapshot.
 */
const seekReplay = (offsetMs) => {
    if (!replay) return getState();
    const target = Math.max(0, Math.min(Number(offsetMs) || 0, replay.durationMs));
    state.topics = {};
    for (const stream of replay.streams) {
        stream.idx = 0;
        if (SNAPSHOT_TOPICS.has(stream.topic)) {
            let last = null;
            while (stream.idx < stream.lines.length && stream.lines[stream.idx].t <= target) {
                last = stream.lines[stream.idx];
                stream.idx += 1;
            }
            if (last) ingest(stream.topic, JSON.parse(last.raw), null, { silent: true });
        } else {
            while (stream.idx < stream.lines.length && stream.lines[stream.idx].t <= target) {
                try {
                    ingest(stream.topic, JSON.parse(stream.lines[stream.idx].raw), null, { silent: true });
                } catch { /* skip corrupt line */ }
                stream.idx += 1;
            }
        }
    }
    replay.virtualMs = target;
    replay.lastTickAt = Date.now();
    emitter.emit('snapshot');
    emitReplayProgress();
    return getState();
};

module.exports = {
    addSubscriber,
    getState,
    startSimulation,
    stopSimulation,
    getArchiveIndex,
    startReplay,
    stopReplay,
    setReplayPaused,
    setReplaySpeed,
    seekReplay,
};
