const db = require('../../config/database');
const crypto = require('crypto');

/**
 * Generic, table-driven CRUD service for the admin portal.
 *
 * Every table/column the admin portal can touch is declared in TABLES below.
 * Because Postgres cannot parameterize identifiers (table/column names), this
 * whitelist is the security boundary: only declared tables/columns are ever
 * interpolated into SQL. Anything not listed here is rejected.
 *
 * Column flags:
 *   type      'text' | 'integer' | 'text[]'  — controls value coercion
 *   required  must be present on create (the primary key is auto-generated if omitted)
 *   auto      managed by the DB/server (timestamps); never read from or written by the client
 *   hidden    never selected or returned, and never writable (e.g. password hashes)
 */
const TABLES = {
    constructors: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            name: { type: 'text', required: true },
            nationality: { type: 'text' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    constructors_season: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            constructors_id: { type: 'integer', required: true },
            season: { type: 'integer' },
            rounds: { type: 'integer' },
            wins: { type: 'integer' },
            points: { type: 'integer' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    drivers: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            given_name: { type: 'text' },
            family_name: { type: 'text' },
            code: { type: 'text' },
            number: { type: 'text' },
            dob: { type: 'text' },
            nationality: { type: 'text' },
            constructor_id: { type: 'text' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    drivers_season: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            driver_id: { type: 'text' },
            season: { type: 'text' },
            rounds: { type: 'text' },
            wins: { type: 'text' },
            points: { type: 'text' },
            position: { type: 'text' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    qualifying: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            season: { type: 'text' },
            round: { type: 'text' },
            driver_number: { type: 'text' },
            position: { type: 'text' },
            q1: { type: 'text' },
            q2: { type: 'text' },
            q3: { type: 'text' },
            created_at: { type: 'timestamp', auto: true },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    results: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            season: { type: 'text' },
            round: { type: 'text' },
            driver_number: { type: 'text' },
            position: { type: 'text' },
            points: { type: 'text' },
            grid: { type: 'text' },
            laps: { type: 'text' },
            status: { type: 'text' },
            time: { type: 'text' },
            fastest_lap: { type: 'text' },
            fastest_lap_rank: { type: 'text' },
            fastest_lap_time: { type: 'text' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    races: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            season: { type: 'text', required: true },
            round: { type: 'text', required: true },
            race_name: { type: 'text' },
            url: { type: 'text' },
            circuit_id: { type: 'text' },
            circuit_name: { type: 'text' },
            circuit_url: { type: 'text' },
            locality: { type: 'text' },
            country: { type: 'text' },
            lat: { type: 'text' },
            long: { type: 'text' },
            date: { type: 'text' },
            time: { type: 'text' },
            fp1_date: { type: 'text' },
            fp1_time: { type: 'text' },
            fp2_date: { type: 'text' },
            fp2_time: { type: 'text' },
            fp3_date: { type: 'text' },
            fp3_time: { type: 'text' },
            quali_date: { type: 'text' },
            quali_time: { type: 'text' },
            sprint_date: { type: 'text' },
            sprint_time: { type: 'text' },
            sprint_quali_date: { type: 'text' },
            sprint_quali_time: { type: 'text' },
            updated_at: { type: 'timestamp', auto: true },
        },
    },
    users: {
        pk: 'id',
        columns: {
            id: { type: 'text', required: true },
            email: { type: 'text', required: true },
            full_name: { type: 'text' },
            avatar_url: { type: 'text' },
            fav_constructor: { type: 'text' },
            fav_drivers: { type: 'text[]' },
            updated_at: { type: 'timestamp', auto: true },
            password: { type: 'text', hidden: true },
        },
    },
};

/** Build an Error carrying an HTTP status for the controller to surface. */
const httpError = (status, message) => {
    const err = new Error(message);
    err.status = status;
    return err;
};

/** Resolve and validate a requested table name against the whitelist. */
const getConfig = (table) => {
    const cfg = TABLES[table];
    if (!cfg) throw httpError(400, `Unknown table: ${table}`);
    return cfg;
};

/** Columns safe to SELECT/return (everything except hidden ones). */
const visibleColumns = (cfg) =>
    Object.keys(cfg.columns).filter((c) => !cfg.columns[c].hidden);

/** Remove hidden columns from a returned row (defensive for RETURNING *). */
const stripHidden = (cfg, row) => {
    if (!row) return row;
    const out = { ...row };
    for (const [name, col] of Object.entries(cfg.columns)) {
        if (col.hidden) delete out[name];
    }
    return out;
};

/** Coerce an incoming value to the column's declared type. Empty -> null. */
const coerce = (column, value) => {
    if (value === undefined || value === null || value === '') return null;
    switch (column.type) {
        case 'integer': {
            const n = Number(value);
            if (!Number.isFinite(n)) throw httpError(400, `Invalid integer value: ${value}`);
            return Math.trunc(n);
        }
        case 'text[]':
            if (Array.isArray(value)) return value.map((v) => String(v));
            return String(value)
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
        default:
            return String(value);
    }
};

/** Metadata for all tables, used by the frontend to render generic forms/tables. */
const listTables = () =>
    Object.entries(TABLES).map(([name, cfg]) => ({
        name,
        pk: cfg.pk,
        columns: visibleColumns(cfg).map((cn) => {
            const col = cfg.columns[cn];
            return {
                name: cn,
                type: col.type,
                required: !!col.required,
                auto: !!col.auto,
                isPk: cn === cfg.pk,
            };
        }),
    }));

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * List rows of a table (hidden columns omitted), ordered by primary key.
 *
 * Always paginated: returns { data, total, page, limit }. An optional `search`
 * term filters across every visible column (cast to text, case-insensitive).
 */
const list = async (table, { page = 1, limit = DEFAULT_LIMIT, search = '', filters = {} } = {}) => {
    const cfg = getConfig(table);
    const visible = visibleColumns(cfg);
    const cols = visible.map((c) => `"${c}"`).join(', ');

    const params = [];
    const clauses = [];

    // Exact-match filters, e.g. season/round. Only declared columns are allowed.
    for (const [col, val] of Object.entries(filters || {})) {
        if (val === undefined || val === null || val === '') continue;
        if (!cfg.columns[col]) throw httpError(400, `Unknown filter column: ${col}`);
        params.push(String(val));
        clauses.push(`CAST("${col}" AS TEXT) = $${params.length}`);
    }

    // Optional case-insensitive search across all visible columns.
    const term = typeof search === 'string' ? search.trim() : '';
    if (term) {
        params.push(`%${term}%`);
        const conds = visible.map((c) => `CAST("${c}" AS TEXT) ILIKE $${params.length}`);
        clauses.push(`(${conds.join(' OR ')})`);
    }

    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

    const countRes = await db.query(`SELECT COUNT(*)::int AS total FROM "${table}" ${where}`, params);
    const total = countRes.rows[0].total;

    const lim = Math.max(1, Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT));
    const pg = Math.max(1, Number(page) || 1);
    const offset = (pg - 1) * lim;

    const dataParams = [...params, lim, offset];
    const sql = `SELECT ${cols} FROM "${table}" ${where} ` +
        `ORDER BY "${cfg.pk}" LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
    const result = await db.query(sql, dataParams);

    return { data: result.rows, total, page: pg, limit: lim };
};

/**
 * Distinct non-null values of a column, optionally constrained by exact-match
 * filters (e.g. rounds for a given season). Used to populate filter dropdowns.
 * Sorted numerically when the values are numeric, otherwise lexically.
 */
const distinct = async (table, column, filters = {}) => {
    const cfg = getConfig(table);
    if (!cfg.columns[column] || cfg.columns[column].hidden) {
        throw httpError(400, `Unknown column: ${column}`);
    }

    const params = [];
    const clauses = [`"${column}" IS NOT NULL`];
    for (const [col, val] of Object.entries(filters || {})) {
        if (val === undefined || val === null || val === '') continue;
        if (!cfg.columns[col]) throw httpError(400, `Unknown filter column: ${col}`);
        params.push(String(val));
        clauses.push(`CAST("${col}" AS TEXT) = $${params.length}`);
    }

    const result = await db.query(
        `SELECT DISTINCT "${column}" AS value FROM "${table}" WHERE ${clauses.join(' AND ')}`,
        params
    );

    return result.rows
        .map((r) => r.value)
        .sort((a, b) => {
            const na = Number(a);
            const nb = Number(b);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return String(a).localeCompare(String(b));
        });
};

/** Fetch a single row by primary key, or null if not found. */
const getOne = async (table, id) => {
    const cfg = getConfig(table);
    const cols = visibleColumns(cfg).map((c) => `"${c}"`).join(', ');
    const result = await db.query(
        `SELECT ${cols} FROM "${table}" WHERE "${cfg.pk}" = $1`,
        [id]
    );
    return result.rows[0] || null;
};

/** Collect writable (non-auto, non-hidden) values supplied in the body. */
const collectWritable = (cfg, body) => {
    const data = {};
    for (const [name, col] of Object.entries(cfg.columns)) {
        if (col.auto || col.hidden) continue;
        if (body[name] !== undefined) data[name] = coerce(col, body[name]);
    }
    return data;
};

/** Create a row. The primary key is auto-generated (UUID) when not supplied. */
const create = async (table, body) => {
    const cfg = getConfig(table);
    const data = collectWritable(cfg, body);

    if (data[cfg.pk] === undefined || data[cfg.pk] === null) {
        data[cfg.pk] = crypto.randomUUID();
    }

    for (const [name, col] of Object.entries(cfg.columns)) {
        if (col.required && !col.auto && (data[name] === undefined || data[name] === null)) {
            throw httpError(400, `Missing required field: ${name}`);
        }
    }

    const cols = Object.keys(data).map((c) => `"${c}"`);
    const values = Object.values(data);
    const placeholders = values.map((_, i) => `$${i + 1}`);

    // Auto timestamp columns are set to now() on insert via SQL literals.
    for (const [name, col] of Object.entries(cfg.columns)) {
        if (col.auto) {
            cols.push(`"${name}"`);
            placeholders.push('now()');
        }
    }

    const sql = `INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`;
    try {
        const result = await db.query(sql, values);
        return stripHidden(cfg, result.rows[0]);
    } catch (err) {
        if (err.code === '23505') throw httpError(409, `A record with that ${cfg.pk} already exists`);
        if (err.code === '23503') throw httpError(409, 'Violates a foreign key constraint');
        throw err;
    }
};

/** Update a row by primary key (the primary key itself is immutable). */
const update = async (table, id, body) => {
    const cfg = getConfig(table);
    const data = collectWritable(cfg, body);
    delete data[cfg.pk];

    const sets = [];
    const values = [];
    let i = 1;
    for (const [name, value] of Object.entries(data)) {
        sets.push(`"${name}" = $${i++}`);
        values.push(value);
    }
    if (cfg.columns.updated_at && cfg.columns.updated_at.auto) {
        sets.push(`"updated_at" = now()`);
    }
    if (sets.length === 0) throw httpError(400, 'No updatable fields provided');

    values.push(id);
    const sql = `UPDATE "${table}" SET ${sets.join(', ')} WHERE "${cfg.pk}" = $${i} RETURNING *`;
    try {
        const result = await db.query(sql, values);
        if (result.rows.length === 0) throw httpError(404, 'Record not found');
        return stripHidden(cfg, result.rows[0]);
    } catch (err) {
        if (err.code === '23503') throw httpError(409, 'Violates a foreign key constraint');
        throw err;
    }
};

/** Delete a row by primary key. */
const remove = async (table, id) => {
    const cfg = getConfig(table);
    try {
        const result = await db.query(
            `DELETE FROM "${table}" WHERE "${cfg.pk}" = $1 RETURNING "${cfg.pk}"`,
            [id]
        );
        if (result.rows.length === 0) throw httpError(404, 'Record not found');
        return { success: true, id };
    } catch (err) {
        if (err.code === '23503') {
            throw httpError(409, 'Cannot delete: other records reference this row');
        }
        throw err;
    }
};

module.exports = {
    TABLES,
    listTables,
    list,
    distinct,
    getOne,
    create,
    update,
    remove,
};
