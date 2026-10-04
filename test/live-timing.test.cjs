const { it } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { EventEmitter } = require('node:events');
const { services } = require('./helpers.cjs');
const LiveTimingService = services.liveTimingService;

function service(t) {
  const live = new LiveTimingService();
  t.after(() => live.onModuleDestroy());
  return live;
}
const encode = (data) => zlib.deflateRawSync(Buffer.from(JSON.stringify(data))).toString('base64');

it('merges nested timing deltas and numeric array patches without losing earlier data', (t) => {
  const live = service(t);
  live.ingest('TimingData', {
    Lines: { 4: { Position: '1', Sectors: [{ Value: '20.1' }, { Value: '30.2' }] } },
  });
  live.ingest('TimingData', { Lines: { 4: { Sectors: { 1: { Value: '29.9' } } } } });
  assert.deepEqual(live.getState().topics.TimingData, {
    Lines: { 4: { Position: '1', Sectors: [{ Value: '20.1' }, { Value: '29.9' }] } },
  });
});

it('decompresses telemetry topics and ignores corrupt frames', (t) => {
  const live = service(t);
  live.ingest('CarData.z', encode({ Entries: [{ Cars: { 4: { Channels: { 2: 300 } } } }] }));
  assert.equal(live.getState().topics.CarData.Entries[0].Cars['4'].Channels[2], 300);
  live.ingest('CarData.z', 'invalid');
  assert.equal(live.getState().topics.CarData.Entries.length, 1);
});

it('isolates state per Nest service instance', (t) => {
  const first = service(t),
    second = service(t);
  first.ingest('LapCount', { CurrentLap: 12 });
  assert.deepEqual(second.getState().topics, {});
});

it('simulates a session, broadcasts timed updates, and cleans up subscribers', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const live = service(t);
  live.startSimulation();
  const updates = [];
  const unsubscribe = live.addSubscriber({ onUpdate: (value) => updates.push(value) });
  assert.equal(live.getState().subscribers, 1);
  assert.equal(Object.keys(live.getState().topics.DriverList).length, 22);
  t.mock.timers.tick(2000);
  assert.ok(updates.some((e) => e.topic === 'TimingData'));
  assert.ok(updates.some((e) => e.topic === 'CarData'));
  assert.ok(updates.some((e) => e.topic === 'Position'));
  unsubscribe();
  unsubscribe();
  assert.equal(live.getState().subscribers, 0);
  assert.equal(live.stopSimulation().simulated, false);
  assert.deepEqual(live.getState().topics, {});
});

it('downloads and caches an archive index, preserving error statuses', async (t) => {
  const live = service(t);
  let calls = 0;
  t.mock.method(global, 'fetch', async () => {
    calls++;
    return new Response('\ufeff{"Meetings":[{"Name":"Race"}]}');
  });
  assert.deepEqual(await live.getArchiveIndex('2020'), { Meetings: [{ Name: 'Race' }] });
  await live.getArchiveIndex('2020');
  assert.equal(calls, 1);
  await assert.rejects(live.getArchiveIndex('2017'), (e) => e.status === 404);
  t.mock.method(global, 'fetch', async () => new Response('', { status: 503 }));
  await assert.rejects(live.getArchiveIndex('2019'), (e) => e.status === 502);
});

function archiveFetch(url) {
  const topic = url.split('/').at(-1).replace('.jsonStream', '');
  const streams = {
    TimingData:
      '\ufeff0:00:00.000{"Lines":{"4":{"Position":"2"}}}\r\n0:00:02.000{"Lines":{"4":{"Position":"1"}}}\n0:00:08.000{"Lines":{"4":{"Position":"3"}}}',
    'CarData.z': `0:00:00.000${JSON.stringify(encode({ value: 1 }))}\n0:00:02.000${JSON.stringify(encode({ value: 2 }))}`,
  };
  return Promise.resolve(
    new Response(streams[topic] || '', { status: streams[topic] ? 200 : 404 }),
  );
}

it('replays archived deltas and compressed snapshots with pause, speed, seek and stop', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const live = service(t);
  t.mock.method(global, 'fetch', archiveFetch);
  const state = await live.startReplay('2020/meeting/race/', { name: 'Race', speed: 1 });
  assert.equal(state.replay.durationMs, 8000);
  assert.equal(state.replay.loading, false);
  t.mock.timers.tick(2200);
  assert.equal(live.getState().topics.TimingData.Lines['4'].Position, '1');
  assert.equal(live.getState().topics.CarData.value, 2);
  live.setReplayPaused(true);
  const offset = live.getState().replay.offsetMs;
  t.mock.timers.tick(3000);
  assert.equal(live.getState().replay.offsetMs, offset);
  live.seekReplay(0);
  assert.equal(live.getState().topics.TimingData.Lines['4'].Position, '2');
  live.setReplaySpeed(5);
  assert.equal(live.getState().replay.speed, 5);
  live.setReplayPaused(false);
  t.mock.timers.tick(2000);
  assert.equal(live.getState().replay.paused, true);
  assert.equal(live.getState().topics.TimingData.Lines['4'].Position, '3');
  live.stopReplay();
  assert.equal(live.getState().replay, null);
  assert.deepEqual(live.getState().topics, {});
});

it('source switches cancel pending replay downloads', async (t) => {
  const live = service(t);
  let resolve;
  const pending = new Promise((r) => {
    resolve = r;
  });
  t.mock.method(global, 'fetch', () => pending);
  const replay = live.startReplay('2020/meeting/race/');
  live.startSimulation();
  resolve(new Response('0:00:00.000{}'));
  await replay;
  assert.equal(live.getState().simulated, true);
  assert.equal(live.getState().replay, null);
});

it('rejects invalid paths and missing recordings with the existing errors', async (t) => {
  const live = service(t);
  await assert.rejects(live.startReplay('../private'), (e) => e.status === 400);
  t.mock.method(global, 'fetch', async () => new Response('', { status: 404 }));
  await assert.rejects(live.startReplay('2020/meeting/race/'), (e) => e.status === 404);
  assert.equal(live.getState().status, 'idle');
});

it('shutdown aborts downloads, closes sockets and subscribers, and clears every timer', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout', 'Date'] });
  const live = service(t);
  live.startSimulation();
  let closed = 0;
  live.addSubscriber({
    onUpdate() {},
    onShutdown() {
      closed++;
    },
  });
  const socket = new EventEmitter();
  socket.terminate = () => {
    closed++;
  };
  live.socket = socket;
  let ticks = 0;
  live.pingTimer = setInterval(() => {
    ticks++;
  }, 1000);
  live.reconnectTimer = setTimeout(() => {
    ticks++;
  }, 1000);
  live.idleTimer = setTimeout(() => {
    ticks++;
  }, 1000);
  live.onModuleDestroy();
  t.mock.timers.tick(10000);
  assert.equal(closed, 2);
  assert.equal(ticks, 0);
  assert.equal(live.getState().subscribers, 0);
  assert.equal(live.socket, null);
  assert.equal(live.abortController.signal.aborted, true);
});
