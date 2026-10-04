require('reflect-metadata');
const { it } = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseService } = require('../dist/database/database.service.js');

function database(fail) {
  const statements = [];
  const releases = [];
  const client = {
    query: async (sql) => {
      statements.push(sql);
      if (sql === fail) throw new Error(sql + ' failed');
      return { rows: [] };
    },
    release: (error) => releases.push(error),
  };
  const db = Object.create(DatabaseService.prototype);
  db.pool = {
    connect: async () => client,
    end: async () => {
      statements.push('END');
    },
  };
  db.logger = { error() {} };
  return { db, client, statements, releases };
}

it('commits a transaction on one connection and releases it', async () => {
  const { db, client, statements, releases } = database();
  const result = await db.transaction(async (connection) => {
    assert.equal(connection, client);
    await connection.query('INSERT');
    return 'done';
  });
  assert.equal(result, 'done');
  assert.deepEqual(statements, ['BEGIN', 'INSERT', 'COMMIT']);
  assert.deepEqual(releases, [undefined]);
});

for (const fail of ['BEGIN', 'INSERT', 'COMMIT']) {
  it(`rolls back and releases the connection if ${fail} fails`, async () => {
    const { db, statements, releases } = database(fail);
    await assert.rejects(
      db.transaction((client) => client.query('INSERT')),
      new RegExp(fail + ' failed'),
    );
    assert.equal(statements.at(-1), 'ROLLBACK');
    assert.equal(releases.length, 1);
  });
}

it('preserves the original error and discards the client when rollback fails', async () => {
  const { db, releases } = database('ROLLBACK');
  await assert.rejects(
    db.transaction(async () => {
      throw new Error('original failure');
    }),
    /original failure/,
  );
  assert.match(releases[0].message, /ROLLBACK failed/);
});

it('closes the pool during Nest shutdown', async () => {
  const { db, statements } = database();
  await db.onApplicationShutdown();
  assert.deepEqual(statements, ['END']);
});
