const { it, before } = require('node:test');
const assert = require('node:assert/strict');
let axios;
before(async () => {
  axios = (await import('axios')).default;
});
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { services } = require('./helpers.cjs');

function database(responses = []) {
  const queries = [];
  const db = {
    query: async (sql, values) => {
      queries.push({ sql, values });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response || { rows: [] };
    },
  };
  db.transaction = async (work) => {
    await db.query('BEGIN');
    try {
      const result = await work(db);
      await db.query('COMMIT');
      return result;
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  };
  return { db, queries };
}

it('registers with a bcrypt password and issues the existing seven-day JWT claims', async () => {
  process.env.JWT_SECRET = 'service-test-secret';
  const user = { id: 'user-1', email: 'test@example.com', is_admin: false };
  const { db, queries } = database([{ rows: [] }, { rows: [user] }]);
  const result = await new services.authService(db).register({
    email: user.email,
    password: 'secret-password',
    fullName: 'Test',
  });
  assert.equal(result.user, user);
  assert.ok(await bcrypt.compare('secret-password', queries[1].values[2]));
  const claims = jwt.verify(result.token, process.env.JWT_SECRET);
  assert.equal(claims.id, user.id);
  assert.equal(claims.email, user.email);
  assert.equal(claims.is_admin, false);
  assert.equal(claims.exp - claims.iat, 7 * 24 * 60 * 60);
  assert.equal(queries[1].values[3], 'Test');
});

it('rejects duplicate registration and incorrect credentials', async () => {
  const { db } = database([
    { rows: [{ id: 'existing' }] },
    { rows: [] },
    { rows: [{ password: await bcrypt.hash('correct', 4) }] },
  ]);
  const service = new services.authService(db);
  await assert.rejects(
    service.register({ email: 'test@example.com', password: 'secret' }),
    /already exists/,
  );
  await assert.rejects(service.login('test@example.com', 'secret'), /Invalid email or password/);
  await assert.rejects(service.login('test@example.com', 'wrong'), /Invalid email or password/);
});

it('logs in with the stored password and preserves user output', async () => {
  const user = {
    id: 'user-1',
    email: 'test@example.com',
    password: await bcrypt.hash('correct', 4),
  };
  const { db } = database([{ rows: [user] }]);
  const result = await new services.authService(db).login(user.email, 'correct');
  assert.deepEqual(result.user, user);
  assert.equal(jwt.verify(result.token, process.env.JWT_SECRET).id, user.id);
});

for (const existing of [true, false]) {
  it(`Google login ${existing ? 'updates an existing' : 'creates a new'} user after token verification`, async (t) => {
    const user = { id: 'google-id', email: 'google@example.com' };
    const { db, queries } = database([{ rows: existing ? [user] : [] }, { rows: [user] }]);
    const service = new services.authService(db);
    t.mock.method(service.client, 'verifyIdToken', async ({ idToken }) => {
      assert.equal(idToken, 'google-token');
      return {
        getPayload: () => ({
          sub: user.id,
          email: user.email,
          name: 'Google User',
          picture: 'avatar',
        }),
      };
    });
    assert.equal((await service.googleLogin('google-token')).user, user);
    assert.match(queries[1].sql, existing ? /UPDATE users/ : /INSERT INTO users/);
  });
}

it('normalizes Google verification failures', async (t) => {
  const service = new services.authService(database().db);
  t.mock.method(service.client, 'verifyIdToken', async () => {
    throw new Error('upstream failure');
  });
  await assert.rejects(service.googleLogin('bad'), /Invalid Google token/);
});

it('reads profiles, initializes columns once, and limits favorites to two strings', async () => {
  const { db, queries } = database([
    { rows: [] },
    { rows: [] },
    { rows: [{ id: 'u' }] },
    { rows: [{ id: 'u' }] },
  ]);
  const service = new services.profileService(db);
  assert.deepEqual(await service.getProfile('u'), { id: 'u' });
  await service.updateProfile('u', {
    fav_constructor: 'mclaren',
    fav_drivers: ['norris', 12, 'piastri', 'hamilton'],
  });
  assert.equal(queries.filter((q) => q.sql.includes('ALTER TABLE')).length, 2);
  assert.deepEqual(queries.at(-1).values, ['mclaren', ['norris', 'piastri'], 'u']);
});

for (const mode of ['new', 'pending', 'missing', 'mismatch']) {
  it(`account deletion request handles ${mode} accounts`, async () => {
    const user = { id: 'u', email: 'test@example.com' };
    const { db, queries } = database([
      { rows: [] },
      { rows: mode === 'missing' ? [] : [user] },
      { rows: mode === 'pending' ? [{ id: 'pending-id' }] : [] },
      { rows: [{ id: 'new-id', status: 'pending' }] },
    ]);
    const service = new services.accountService(db);
    const promise = service.createDeletionRequest('u', {
      email: mode === 'mismatch' ? 'wrong@example.com' : 'TEST@example.com',
      reason: 'Requested',
    });
    if (['missing', 'mismatch'].includes(mode))
      await assert.rejects(promise, (e) => e.status === (mode === 'missing' ? 404 : 400));
    else assert.equal((await promise).id, mode === 'pending' ? 'pending-id' : 'new-id');
    assert.ok(queries.every((q) => !q.sql.includes('DELETE FROM users')));
  });
}

it('reshapes the race calendar and binds the season filter', async () => {
  const { db, queries } = database([
    {
      rows: [
        {
          season: '2026',
          round: '3',
          race_name: 'Race',
          circuit_name: 'Circuit',
          locality: 'City',
          country: 'Country',
          date: '2026-05-01',
          quali_date: '2026-04-30',
        },
      ],
    },
  ]);
  const races = await new services.raceService(db).getRacesFromDb('2026');
  assert.equal(races[0].raceName, 'Race');
  assert.equal(races[0].Circuit.Location.country, 'Country');
  assert.deepEqual(races[0].Qualifying, { date: '2026-04-30', time: undefined });
  assert.equal('Sprint' in races[0], false);
  assert.deepEqual(queries[0].values, ['2026']);
});

it('reads trivia in display order', async () => {
  const { db, queries } = database([{ rows: [{ id: '1', body: 'Trivia' }] }]);
  assert.deepEqual(await new services.triviaService(db).getTriviaFromDb(), [
    { id: '1', body: 'Trivia' },
  ]);
  assert.match(queries[0].sql, /ORDER BY/);
});

it('admin CRUD enforces table and column allowlists and hides password hashes', async () => {
  const { db, queries } = database([
    { rows: [{ id: 'u', email: 'a@example.com', password: 'hash' }] },
  ]);
  const service = new services.adminService(db);
  await assert.rejects(service.getOne('users; DROP TABLE users', 'u'), (e) => e.status === 400);
  await assert.rejects(service.distinct('users', 'password'), (e) => e.status === 400);
  const row = await service.create('users', {
    id: 'u',
    email: 'a@example.com',
    password: 'injected',
    is_admin: true,
  });
  assert.deepEqual(row, { id: 'u', email: 'a@example.com' });
  assert.ok(!queries[0].sql.includes('password'));
  assert.ok(!queries[0].sql.includes('is_admin'));
  assert.ok(!queries[0].values.includes('injected'));
});

it('admin pagination bounds the limit and parameterizes filters/search', async () => {
  const { db, queries } = database([{ rows: [{ total: 1 }] }, { rows: [{ id: 'u' }] }]);
  const result = await new services.adminService(db).list('users', {
    page: '2',
    limit: '1000',
    search: "' OR 1=1",
    filters: { email: 'test@example.com' },
  });
  assert.equal(result.limit, 500);
  assert.equal(result.page, 2);
  assert.deepEqual(queries[1].values, ['test@example.com', "%' OR 1=1%", 500, 500]);
  assert.ok(!queries[1].sql.includes("' OR 1=1"));
});

it('admin updates bind values, preserve server fields, and translate constraint errors', async () => {
  const { db, queries } = database([
    { rows: [{ id: 'u', full_name: 'New', password: 'hash' }] },
    Object.assign(new Error('foreign key'), { code: '23503' }),
  ]);
  const service = new services.adminService(db);
  assert.deepEqual(
    await service.update('users', 'u', {
      id: 'changed',
      full_name: 'New',
      password: 'bad',
      updated_at: 'bad',
    }),
    { id: 'u', full_name: 'New' },
  );
  assert.deepEqual(queries[0].values, ['New', 'u']);
  assert.match(queries[0].sql, /now\(\)/);
  await assert.rejects(service.remove('users', 'u'), (e) => e.status === 409);
});

const reads = [
  ['driverService', 'getAllDriversFromDb', []],
  ['driverService', 'getAllDriversSeasonRankingsFromDb', []],
  ['constructorService', 'getAllConstructorsFromDb', []],
  ['constructorService', 'getAllConstructorsSeasonRankingsFromDb', []],
  ['resultService', 'getResultsBySeasonAndRoundFromDb', ['2026', '3']],
  ['resultService', 'getQualifyingBySeasonAndRoundFromDb', ['2026', '3']],
  ['resultService', 'getSprintResultsBySeasonAndRoundFromDb', ['2026', '3']],
  ['resultService', 'getSprintQualifyingBySeasonAndRoundFromDb', ['2026', '3']],
];
for (const [name, method, args] of reads)
  it(`${method} reads through injected PostgreSQL`, async () => {
    const queries = [];
    const db = {
      query: async (sql, values) => {
        queries.push({ sql, values });
        return { rows: [{ id: 'row' }] };
      },
    };
    assert.deepEqual(await new services[name](db)[method](...args), [{ id: 'row' }]);
    if (args.length) assert.deepEqual(queries.at(-1).values, args);
    assert.match(queries.at(-1).sql, /SELECT/);
  });

it('fetches constructor standings from the existing upstream', async (t) => {
  t.mock.method(axios, 'get', async (url) => {
    assert.match(url, /constructorstandings/);
    return {
      data: {
        MRData: {
          StandingsTable: { StandingsLists: [{ ConstructorStandings: [{ position: '1' }] }] },
        },
      },
    };
  });
  assert.ok(await new services.constructorService(database().db).getConstructorStandings());
});

for (const [method, property, table] of [
  ['syncResults', 'Results', 'results'],
  ['syncQualifying', 'QualifyingResults', 'qualifying'],
  ['syncSprintResults', 'SprintResults', 'sprint_results'],
]) {
  it(`${method} pages upstream data and upserts stable IDs inside one transaction`, async (t) => {
    const urls = [];
    t.mock.method(axios, 'get', async (url) => {
      urls.push(url);
      return {
        data: {
          MRData: {
            total: '101',
            RaceTable: {
              Races: [
                {
                  season: '2026',
                  round: String(urls.length),
                  [property]: [
                    {
                      Driver: { driverId: 'norris' },
                      number: '4',
                      position: '1',
                      points: '25',
                      Q1: '1:20.000',
                    },
                  ],
                },
              ],
            },
          },
        },
      };
    });
    const { db, queries } = database();
    const result = await new services.resultService(db)[method]();
    assert.equal(result.total, 2);
    assert.equal(urls.length, 2);
    assert.match(urls[1], /offset=100/);
    const inserts = queries.filter((q) => q.sql.includes('INSERT INTO ' + table));
    assert.deepEqual(
      inserts.map((q) => q.values[0]),
      ['2026_1_norris', '2026_2_norris'],
    );
    assert.ok(inserts.every((q) => q.sql.includes('ON CONFLICT')));
    assert.equal(queries[0].sql, 'BEGIN');
    assert.equal(queries.at(-1).sql, 'COMMIT');
  });
}

it('sync failures roll back instead of committing partial results', async (t) => {
  t.mock.method(axios, 'get', async () => {
    throw new Error('Upstream unavailable');
  });
  const { db, queries } = database();
  await assert.rejects(new services.resultService(db).syncResults(), /Upstream unavailable/);
  assert.deepEqual(
    queries.map((q) => q.sql),
    ['BEGIN', 'ROLLBACK'],
  );
});

for (const [name, method, kind] of [
  ['driverService', 'syncDriverSeason', 'Driver'],
  ['constructorService', 'syncConstructorSeason', 'Constructor'],
]) {
  it(`${method} maps upstream standings to local IDs`, async (t) => {
    const item = {
      points: '25',
      wins: '1',
      position: '1',
      [kind]:
        kind === 'Driver'
          ? { code: 'NOR', familyName: 'Norris' }
          : { constructorId: 'mclaren', name: 'McLaren' },
    };
    t.mock.method(axios, 'get', async () => ({
      data: {
        MRData: {
          StandingsTable: {
            StandingsLists: [{ season: '2026', round: '1', [kind + 'Standings']: [item] }],
          },
        },
      },
    }));
    const { db, queries } = database();
    const query = db.query;
    db.query = async (sql, values) =>
      sql.startsWith('SELECT *')
        ? (queries.push({ sql, values }),
          { rows: [{ id: 'local-id', name: 'McLaren', code: 'NOR' }] })
        : query(sql, values);
    const result = await new services[name](db)[method]();
    assert.equal(result.count, 1);
    const insert = queries.find((q) => q.sql.includes('INSERT INTO'));
    assert.equal(insert.values[1], 'local-id');
    assert.equal(queries.at(-1).sql, 'COMMIT');
  });
}

it('syncs sprint qualifying from OpenF1 with race mapping and formatted lap times', async (t) => {
  t.mock.method(axios, 'get', async (url) => ({
    data: url.includes('/sessions?')
      ? [{ date_start: '2020-01-01T00:00:00', date_end: '2020-01-01T01:00:00', session_key: 123 }]
      : [{ driver_number: 4, position: 1, duration: [80.123, 79.555, 78.1] }],
  }));
  const { db, queries } = database();
  const query = db.query;
  db.query = async (sql, values) =>
    sql.startsWith('SELECT round')
      ? (queries.push({ sql, values }), { rows: [{ round: '3' }] })
      : query(sql, values);
  const result = await new services.resultService(db).syncSprintQualifying();
  assert.equal(result.total, 1);
  assert.deepEqual(queries.find((q) => q.sql.includes('INSERT INTO')).values, [
    '2026_3_4',
    '2026',
    '3',
    '4',
    '1',
    '1:20.123',
    '1:19.555',
    '1:18.100',
  ]);
});

it('caches completed lap-position responses, preserving numeric lap and position values', async (t) => {
  let calls = 0;
  t.mock.method(axios, 'get', async () => {
    calls++;
    return {
      data: {
        MRData: {
          total: '1',
          RaceTable: {
            Races: [{ Laps: [{ number: '1', Timings: [{ driverId: 'norris', position: '2' }] }] }],
          },
        },
      },
    };
  });
  const service = new services.resultService(database().db);
  const expected = {
    season: '2026',
    round: '3',
    totalLaps: 1,
    drivers: { norris: [{ lap: 1, position: 2 }] },
  };
  assert.deepEqual(await service.getLapPositions('2026', '3'), expected);
  assert.deepEqual(await service.getLapPositions('2026', '3'), expected);
  assert.equal(calls, 1);
});
