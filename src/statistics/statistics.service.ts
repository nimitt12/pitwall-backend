import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { upstreamGet } from '../security/upstream.js';

type OutcomeCategory = 'classified' | 'mechanical' | 'incident' | 'regulatory' | 'other';

interface StoredStatus {
  status_id: number | string;
  status: string;
  count: number | string;
  fetched_at: Date | string;
}

interface StatusRow {
  statusId: string;
  status: string;
  count: number;
  percentage: number;
  category: OutcomeCategory;
}

interface ChampionshipDbRow {
  round: string;
  race_name: string;
  driver_number: string;
  code: string | null;
  given_name: string;
  family_name: string;
  team_name: string;
  points: number | string;
}

interface QualifyingDbRow {
  round: string;
  race_name: string;
  driver_number: string;
  code: string | null;
  given_name: string;
  family_name: string;
  team_name: string;
  position: string;
  q1: string | null;
  q2: string | null;
  q3: string | null;
}

interface SpeedDbRow {
  round: string;
  race_name: string;
  circuit_name: string;
  driver_number: string;
  code: string | null;
  given_name: string;
  family_name: string;
  team_name: string;
  fastest_lap: string | null;
  fastest_lap_rank: string | null;
  fastest_lap_time: string | null;
  fastest_lap_speed?: string | null;
}

@Injectable()
export class StatisticsService {
  private readonly logger = new Logger(StatisticsService.name);
  private readonly source = 'https://api.jolpi.ca/ergast/f1/status/';
  private storeReady?: Promise<void>;
  private circuitDirectoryCache?: { expires: number; value: unknown };
  private readonly circuitInsightCache = new Map<string, { expires: number; value: unknown }>();

  constructor(private readonly db: DatabaseService) {}

  private async ensureStore() {
    if (!this.storeReady) {
      this.storeReady = this.db
        .query(
          `CREATE TABLE IF NOT EXISTS f1_statuses (
             status_id INTEGER PRIMARY KEY CHECK (status_id >= 0),
             status VARCHAR(120) NOT NULL,
             count INTEGER NOT NULL CHECK (count >= 0),
             fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )`,
        )
        .then(() => undefined);
    }
    try {
      await this.storeReady;
    } catch (error) {
      this.storeReady = undefined;
      throw error;
    }
  }

  private categoryFor(status: string): OutcomeCategory {
    const value = status.toLowerCase().trim();
    if (
      value === 'finished' ||
      value === 'lapped' ||
      value === 'running' ||
      /^\+\d+ laps?$/.test(value)
    )
      return 'classified';
    if (/accident|collision|spun|damage|debris|puncture/.test(value)) return 'incident';
    if (/disqualif|excluded|illegal|underweight/.test(value)) return 'regulatory';
    if (
      /engine|gearbox|transmission|electrical|hydraulic|brake|suspension|clutch|turbo|fuel|oil|overheat|ignition|throttle|power unit|driveshaft|wheel|tyre|water|radiator|exhaust|battery|alternator|differential/.test(
        value,
      )
    )
      return 'mechanical';
    return 'other';
  }

  private responseFor(stored: StoredStatus[], cacheStatus: 'fresh' | 'refreshed' | 'stale') {
    const total = stored.reduce((sum, row) => sum + Number(row.count), 0);
    const statuses: StatusRow[] = stored
      .map((row) => {
        const count = Number(row.count);
        return {
          statusId: String(row.status_id),
          status: row.status,
          count,
          percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
          category: this.categoryFor(row.status),
        };
      })
      .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status));
    const order: OutcomeCategory[] = [
      'classified',
      'mechanical',
      'incident',
      'regulatory',
      'other',
    ];
    const categories = order.map((category) => {
      const count = statuses
        .filter((row) => row.category === category)
        .reduce((sum, row) => sum + row.count, 0);
      return {
        category,
        count,
        percentage: total ? Number(((count / total) * 100).toFixed(2)) : 0,
      };
    });
    const classified = categories.find((row) => row.category === 'classified')?.count || 0;
    return {
      source: this.source,
      fetchedAt: new Date(stored[0].fetched_at).toISOString(),
      cacheStatus,
      summary: {
        total,
        classified,
        nonClassified: total - classified,
        completionRate: total ? Number(((classified / total) * 100).toFixed(2)) : 0,
        statusTypes: statuses.length,
        leadingStatus: statuses[0]
          ? { status: statuses[0].status, count: statuses[0].count }
          : null,
      },
      categories,
      statuses,
    };
  }

  private async storedStatuses() {
    await this.ensureStore();
    const result = await this.db.query<StoredStatus>(
      `SELECT status_id, status, count, fetched_at
       FROM f1_statuses
       ORDER BY count DESC, status ASC`,
    );
    return result.rows;
  }

  private isFresh(rows: StoredStatus[]) {
    if (!rows.length) return false;
    return Date.now() - new Date(rows[0].fetched_at).getTime() < 6 * 60 * 60 * 1000;
  }

  private parsePage(payload: unknown) {
    const mrData = (
      payload as {
        MRData?: { total?: unknown; StatusTable?: { Status?: unknown } };
      }
    )?.MRData;
    const values = mrData?.StatusTable?.Status;
    if (!Array.isArray(values) || !/^\d+$/.test(String(mrData?.total)))
      throw new Error('Invalid Jolpica status response');
    const rows = values.map((value) => {
      const row = value as { statusId?: unknown; status?: unknown; count?: unknown };
      if (
        !/^\d+$/.test(String(row.statusId)) ||
        typeof row.status !== 'string' ||
        row.status.length < 1 ||
        row.status.length > 120 ||
        !/^\d+$/.test(String(row.count))
      )
        throw new Error('Invalid Jolpica status row');
      return { statusId: String(row.statusId), status: row.status, count: Number(row.count) };
    });
    return { rows, total: Number(mrData?.total) };
  }

  private async refresh() {
    const pageSize = 100;
    const all = new Map<string, { statusId: string; status: string; count: number }>();
    let offset = 0;
    let total = 1;
    while (offset < total) {
      if (offset >= 1000) throw new Error('Jolpica status pagination limit exceeded');
      const response = await upstreamGet(`${this.source}?limit=${pageSize}&offset=${offset}`);
      const page = this.parsePage(response.data);
      total = page.total;
      for (const row of page.rows) all.set(row.statusId, row);
      if (!page.rows.length) break;
      offset += pageSize;
    }
    const statuses = [...all.values()];
    if (!statuses.length) throw new Error('Jolpica returned no status data');
    const fetchedAt = new Date();
    await this.db.transaction(async (client) => {
      await client.query('DELETE FROM f1_statuses');
      for (const row of statuses) {
        await client.query(
          `INSERT INTO f1_statuses (status_id, status, count, fetched_at)
           VALUES ($1, $2, $3, $4)`,
          [row.statusId, row.status, row.count, fetchedAt],
        );
      }
    });
    return statuses.map((row) => ({
      status_id: row.statusId,
      status: row.status,
      count: row.count,
      fetched_at: fetchedAt,
    }));
  }

  async getStatuses() {
    const stored = await this.storedStatuses();
    if (this.isFresh(stored)) return this.responseFor(stored, 'fresh');
    try {
      const refreshed = await this.refresh();
      return this.responseFor(refreshed, 'refreshed');
    } catch {
      if (stored.length) {
        this.logger.warn('Serving stale all-time F1 statistics');
        return this.responseFor(stored, 'stale');
      }
      this.logger.error('Unable to build all-time F1 statistics');
      throw new ServiceUnavailableException('F1 statistics are temporarily unavailable');
    }
  }

  private parseLapTime(value: string | null) {
    if (!value) return null;
    const parts = value.split(':').map(Number);
    if (parts.some((part) => !Number.isFinite(part))) return null;
    const seconds = parts.length === 2 ? parts[0] * 60 + parts[1] : parts[0];
    return Math.round(seconds * 1000);
  }

  async getChampionship(season: string) {
    const championshipRows = (includeSprint: boolean) =>
      this.db.query<ChampionshipDbRow>(
        `${
          includeSprint
            ? `WITH sprint_points AS (
         SELECT season, round, driver_number,
                SUM(COALESCE(NULLIF(points, '')::numeric, 0)) AS points
         FROM sprint_results
         WHERE season = $1
         GROUP BY season, round, driver_number
       )`
            : ''
        }
       SELECT r.round, ra.race_name, r.driver_number, d.code, d.given_name, d.family_name,
              c.name AS team_name,
              COALESCE(NULLIF(r.points, '')::numeric, 0)${includeSprint ? ' + COALESCE(sp.points, 0)' : ''} AS points
       FROM results r
       JOIN races ra ON ra.season = r.season AND ra.round = r.round
       ${
         includeSprint
           ? `LEFT JOIN sprint_points sp ON sp.season = r.season AND sp.round = r.round
                                  AND sp.driver_number = r.driver_number`
           : ''
       }
       LEFT JOIN drivers d ON d.number = r.driver_number
       LEFT JOIN constructors c ON c.id = d.constructor_id
       WHERE r.season = $1
       ORDER BY CAST(r.round AS INTEGER), CAST(r.position AS INTEGER)`,
        [season],
      );
    let result;
    try {
      result = await championshipRows(true);
    } catch (error) {
      if (error?.code !== '42P01') throw error;
      this.logger.warn('Sprint results table unavailable; serving Grand Prix points only');
      result = await championshipRows(false);
    }
    const roundNames = new Map<number, string>();
    const drivers = new Map<
      string,
      {
        driverNumber: string;
        code: string;
        name: string;
        team: string;
        cumulative: number;
        points: Array<{ round: number; points: number; rank: number }>;
      }
    >();
    for (const row of result.rows) {
      const round = Number(row.round);
      roundNames.set(round, row.race_name);
      const driver = drivers.get(row.driver_number) || {
        driverNumber: row.driver_number,
        code: row.code || row.family_name.slice(0, 3).toUpperCase(),
        name: `${row.given_name || ''} ${row.family_name || ''}`.trim(),
        team: row.team_name || 'Unknown',
        cumulative: 0,
        points: [],
      };
      driver.cumulative += Number(row.points) || 0;
      driver.points.push({ round, points: Number(driver.cumulative.toFixed(2)), rank: 0 });
      drivers.set(row.driver_number, driver);
    }
    for (const round of roundNames.keys()) {
      const ordered = [...drivers.values()]
        .map((driver) => ({ driver, point: driver.points.find((item) => item.round === round) }))
        .filter((item) => item.point)
        .sort((a, b) => b.point!.points - a.point!.points);
      ordered.forEach((item, index) => {
        item.point!.rank = index + 1;
      });
    }
    const constructors = new Map<
      string,
      {
        team: string;
        cumulative: number;
        points: Array<{ round: number; points: number; rank: number }>;
      }
    >();
    for (const round of [...roundNames.keys()].sort((a, b) => a - b)) {
      const roundTotals = new Map<string, number>();
      for (const driver of drivers.values()) {
        const current = driver.points.find((item) => item.round === round);
        const previous = [...driver.points].reverse().find((item) => item.round < round);
        const earned = current ? current.points - (previous?.points || 0) : 0;
        if (current) roundTotals.set(driver.team, (roundTotals.get(driver.team) || 0) + earned);
      }
      for (const [team, earned] of roundTotals) {
        const entry = constructors.get(team) || { team, cumulative: 0, points: [] };
        entry.cumulative += earned;
        entry.points.push({ round, points: Number(entry.cumulative.toFixed(2)), rank: 0 });
        constructors.set(team, entry);
      }
      [...constructors.values()]
        .map((team) => ({ team, point: team.points.find((item) => item.round === round) }))
        .filter((item) => item.point)
        .sort((a, b) => b.point!.points - a.point!.points)
        .forEach((item, index) => {
          item.point!.rank = index + 1;
        });
    }
    return {
      season,
      source: 'Jolpica race and sprint results stored by Pitwall',
      rounds: [...roundNames]
        .sort(([a], [b]) => a - b)
        .map(([round, raceName]) => ({ round, raceName })),
      drivers: [...drivers.values()]
        .sort((a, b) => b.cumulative - a.cumulative)
        .map(({ cumulative: _cumulative, ...driver }) => driver),
      constructors: [...constructors.values()]
        .sort((a, b) => b.cumulative - a.cumulative)
        .map(({ cumulative: _cumulative, ...team }) => team),
    };
  }

  async getQualifyingTrends(season: string) {
    const result = await this.db.query<QualifyingDbRow>(
      `SELECT q.round, ra.race_name, q.driver_number, d.code, d.given_name, d.family_name,
              c.name AS team_name, q.position, q.q1, q.q2, q.q3
       FROM qualifying q
       JOIN races ra ON ra.season = q.season AND ra.round = q.round
       LEFT JOIN drivers d ON d.number = q.driver_number
       LEFT JOIN constructors c ON c.id = d.constructor_id
       WHERE q.season = $1
       ORDER BY CAST(q.round AS INTEGER), CAST(q.position AS INTEGER)`,
      [season],
    );
    const byRound = new Map<number, QualifyingDbRow[]>();
    for (const row of result.rows) {
      const round = Number(row.round);
      byRound.set(round, [...(byRound.get(round) || []), row]);
    }
    return {
      season,
      rounds: [...byRound]
        .sort(([a], [b]) => a - b)
        .map(([round, rows]) => {
          const leaders = (['q1', 'q2', 'q3'] as const).map((key) => {
            const values = rows
              .map((row) => this.parseLapTime(row[key]))
              .filter((value): value is number => value !== null);
            return values.length ? Math.min(...values) : null;
          });
          return {
            round,
            raceName: rows[0].race_name,
            drivers: rows.map((row) => ({
              driverNumber: row.driver_number,
              code: row.code || row.family_name.slice(0, 3).toUpperCase(),
              name: `${row.given_name || ''} ${row.family_name || ''}`.trim(),
              team: row.team_name || 'Unknown',
              position: Number(row.position),
              sessions: ([row.q1, row.q2, row.q3] as const).map((time, index) => {
                const timeMs = this.parseLapTime(time);
                return {
                  time,
                  timeMs,
                  deltaMs:
                    timeMs !== null && leaders[index] !== null ? timeMs - leaders[index]! : null,
                };
              }),
            })),
          };
        }),
    };
  }

  async getSpeedIndex(season: string) {
    let rows: SpeedDbRow[];
    try {
      rows = (
        await this.db.query<SpeedDbRow>(
          `SELECT r.round, ra.race_name, ra.circuit_name, r.driver_number, d.code,
                d.given_name, d.family_name, c.name AS team_name, r.fastest_lap,
                r.fastest_lap_rank, r.fastest_lap_time, r.fastest_lap_speed
         FROM results r
         JOIN races ra ON ra.season = r.season AND ra.round = r.round
         LEFT JOIN drivers d ON d.number = r.driver_number
         LEFT JOIN constructors c ON c.id = d.constructor_id
         WHERE r.season = $1 AND r.fastest_lap_time IS NOT NULL
         ORDER BY CAST(r.round AS INTEGER), CAST(r.fastest_lap_rank AS INTEGER)`,
          [season],
        )
      ).rows;
    } catch (error) {
      if (error?.code !== '42703') throw error;
      rows = (
        await this.db.query<SpeedDbRow>(
          `SELECT r.round, ra.race_name, ra.circuit_name, r.driver_number, d.code,
                d.given_name, d.family_name, c.name AS team_name, r.fastest_lap,
                r.fastest_lap_rank, r.fastest_lap_time, NULL AS fastest_lap_speed
         FROM results r
         JOIN races ra ON ra.season = r.season AND ra.round = r.round
         LEFT JOIN drivers d ON d.number = r.driver_number
         LEFT JOIN constructors c ON c.id = d.constructor_id
         WHERE r.season = $1 AND r.fastest_lap_time IS NOT NULL
         ORDER BY CAST(r.round AS INTEGER), CAST(r.fastest_lap_rank AS INTEGER)`,
          [season],
        )
      ).rows;
    }
    return {
      season,
      entries: rows.map((row) => ({
        round: Number(row.round),
        raceName: row.race_name,
        circuitName: row.circuit_name,
        driverNumber: row.driver_number,
        code: row.code || row.family_name.slice(0, 3).toUpperCase(),
        name: `${row.given_name || ''} ${row.family_name || ''}`.trim(),
        team: row.team_name || 'Unknown',
        lap: row.fastest_lap ? Number(row.fastest_lap) : null,
        rank: row.fastest_lap_rank ? Number(row.fastest_lap_rank) : null,
        time: row.fastest_lap_time,
        timeMs: this.parseLapTime(row.fastest_lap_time),
        speedKph: row.fastest_lap_speed ? Number(row.fastest_lap_speed) : null,
      })),
    };
  }

  private async fetchAll(url: string, limit = 100, maximum = 5000) {
    const values: unknown[] = [];
    let offset = 0;
    let total = 1;
    while (offset < total) {
      if (offset >= maximum) throw new Error('Jolpica pagination limit exceeded');
      const response = await upstreamGet(
        `${url}${url.includes('?') ? '&' : '?'}limit=${limit}&offset=${offset}`,
      );
      const mrData = response.data?.MRData;
      total = Number(mrData?.total);
      if (!Number.isFinite(total)) throw new Error('Invalid Jolpica response');
      values.push(mrData);
      offset += limit;
      if (offset < total) await new Promise((resolve) => setTimeout(resolve, 260));
    }
    return values;
  }

  async getCircuits() {
    if (this.circuitDirectoryCache && this.circuitDirectoryCache.expires > Date.now())
      return this.circuitDirectoryCache.value;
    const pages = await this.fetchAll('https://api.jolpi.ca/ergast/f1/circuits/');
    const circuits = pages
      .flatMap((page: any) => page.CircuitTable?.Circuits || [])
      .map((circuit: any) => ({
        id: circuit.circuitId,
        name: circuit.circuitName,
        locality: circuit.Location?.locality || '',
        country: circuit.Location?.country || '',
        lat: Number(circuit.Location?.lat),
        long: Number(circuit.Location?.long),
      }));
    const value = { source: 'Jolpica circuits', circuits };
    this.circuitDirectoryCache = { expires: Date.now() + 24 * 60 * 60 * 1000, value };
    return value;
  }

  async getCircuitInsights(circuitId: string) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(circuitId))
      throw new ServiceUnavailableException('Invalid circuit identifier');
    const cached = this.circuitInsightCache.get(circuitId);
    if (cached && cached.expires > Date.now()) return cached.value;
    const pages = await this.fetchAll(
      `https://api.jolpi.ca/ergast/f1/circuits/${circuitId}/results/`,
      100,
      5000,
    );
    const races = pages.flatMap((page: any) => page.RaceTable?.Races || []);
    const seenRaces = new Map<string, any>();
    const results: any[] = [];
    for (const race of races) {
      seenRaces.set(`${race.season}_${race.round}`, race);
      for (const result of race.Results || []) results.push({ race, result });
    }
    if (!results.length) throw new ServiceUnavailableException('Circuit history is unavailable');
    const counts = (selector: (item: any) => string, filter: (item: any) => boolean) => {
      const map = new Map<string, number>();
      results
        .filter(filter)
        .forEach((item) => map.set(selector(item), (map.get(selector(item)) || 0) + 1));
      return [...map]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    };
    const classified = (status: string) =>
      status === 'Finished' || /^\+\d+ Laps?$/.test(status || '');
    const gridRows = results.filter(
      ({ result }) => Number(result.grid) > 0 && Number(result.position) > 0,
    );
    const poleRows = results.filter(({ result }) => Number(result.grid) === 1);
    const fastestLaps = results
      .filter(({ result }) => result.FastestLap?.rank === '1')
      .map(({ race, result }) => ({
        season: Number(race.season),
        raceName: race.raceName,
        driver: `${result.Driver?.givenName || ''} ${result.Driver?.familyName || ''}`.trim(),
        code: result.Driver?.code || '',
        team: result.Constructor?.name || '',
        time: result.FastestLap?.Time?.time || null,
        speedKph: Number(result.FastestLap?.AverageSpeed?.speed) || null,
      }))
      .sort((a, b) => b.season - a.season);
    const winners = results.filter(({ result }) => Number(result.position) === 1);
    const latestRace = [...seenRaces.values()].sort(
      (a, b) => Number(b.season) - Number(a.season) || Number(b.round) - Number(a.round),
    )[0];
    const value = {
      source: `https://api.jolpi.ca/ergast/f1/circuits/${circuitId}/results/`,
      circuit: {
        id: circuitId,
        name: latestRace.Circuit?.circuitName || circuitId,
        locality: latestRace.Circuit?.Location?.locality || '',
        country: latestRace.Circuit?.Location?.country || '',
      },
      summary: {
        races: seenRaces.size,
        firstSeason: Math.min(...[...seenRaces.values()].map((race) => Number(race.season))),
        latestSeason: Math.max(...[...seenRaces.values()].map((race) => Number(race.season))),
        poleConversion: poleRows.length
          ? Number(
              (
                (poleRows.filter(({ result }) => Number(result.position) === 1).length /
                  poleRows.length) *
                100
              ).toFixed(1),
            )
          : 0,
        averageGridMovement: gridRows.length
          ? Number(
              (
                gridRows.reduce(
                  (sum, { result }) =>
                    sum + Math.abs(Number(result.grid) - Number(result.position)),
                  0,
                ) / gridRows.length
              ).toFixed(2),
            )
          : 0,
        dnfRate: results.length
          ? Number(
              (
                (results.filter(({ result }) => !classified(result.status)).length /
                  results.length) *
                100
              ).toFixed(1),
            )
          : 0,
      },
      topDrivers: counts(
        ({ result }) =>
          `${result.Driver?.givenName || ''} ${result.Driver?.familyName || ''}`.trim(),
        ({ result }) => Number(result.position) === 1,
      ).slice(0, 8),
      topConstructors: counts(
        ({ result }) => result.Constructor?.name || 'Unknown',
        ({ result }) => Number(result.position) === 1,
      ).slice(0, 8),
      recentWinners: winners
        .slice()
        .sort((a, b) => Number(b.race.season) - Number(a.race.season))
        .slice(0, 12)
        .map(({ race, result }) => ({
          season: Number(race.season),
          driver: `${result.Driver?.givenName || ''} ${result.Driver?.familyName || ''}`.trim(),
          team: result.Constructor?.name || '',
        })),
      fastestLaps: fastestLaps.slice(0, 20),
    };
    if (this.circuitInsightCache.size >= 30)
      this.circuitInsightCache.delete(this.circuitInsightCache.keys().next().value!);
    this.circuitInsightCache.set(circuitId, { expires: Date.now() + 6 * 60 * 60 * 1000, value });
    return value;
  }
}
