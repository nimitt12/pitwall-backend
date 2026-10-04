import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class ResultService {
  /**
   * Syncs race results from external API to local database
   * @returns {Promise<Object>}
   */
  syncResults = async () => {
    try {
      return await this.db.transaction(async (client) => {
        let totalCount = 0;
        let offset = 0;
        const limit = 100; // Fetch 100 results per request
        let hasMore = true;

        while (hasMore) {
          const url = `https://api.jolpi.ca/ergast/f1/2026/results/?format=json&limit=${limit}&offset=${offset}`;
          console.log(`Syncing results: offset ${offset}, limit ${limit}...`);

          const response = await axios.get(url);
          const mrData = response.data.MRData;
          const races = mrData.RaceTable.Races;
          const total = parseInt(mrData.total);

          if (!races || races.length === 0) {
            hasMore = false;
            break;
          }

          const insertQuery = `
                INSERT INTO results (
                    id, season, round, driver_number, position, points, grid, laps, status, 
                    time, fastest_lap, fastest_lap_rank, fastest_lap_time
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE
                SET 
                    driver_number = EXCLUDED.driver_number,
                    position = EXCLUDED.position,
                    points = EXCLUDED.points,
                    grid = EXCLUDED.grid,
                    laps = EXCLUDED.laps,
                    status = EXCLUDED.status,
                    time = EXCLUDED.time,
                    fastest_lap = EXCLUDED.fastest_lap,
                    fastest_lap_rank = EXCLUDED.fastest_lap_rank,
                    fastest_lap_time = EXCLUDED.fastest_lap_time,
                    updated_at = NOW()
            `;

          for (const race of races) {
            const season = race.season;
            const round = race.round;
            const results = race.Results;

            for (const item of results) {
              const driverId = item.Driver.driverId;
              const id = `${season}_${round}_${driverId}`;

              const values = [
                id,
                season,
                round,
                item.number,
                item.position,
                item.points,
                item.grid,
                item.laps,
                item.status,
                item.Time ? item.Time.time : null,
                item.FastestLap ? item.FastestLap.lap : null,
                item.FastestLap ? item.FastestLap.rank : null,
                item.FastestLap && item.FastestLap.Time ? item.FastestLap.Time.time : null,
              ];

              await client.query(insertQuery, values);
              totalCount++;
            }
          }

          offset += limit;
          if (offset >= total) {
            hasMore = false;
          }
        }

        return {
          success: true,
          message: `Successfully synced ${totalCount} results`,
          total: totalCount,
        };
      });
    } catch (error) {
      console.error('Error syncing results:', error.message);
      throw error;
    }
  };

  /**
   * Fetches results by season and round from the database, including driver and constructor info
   * @param {string} season
   * @param {string} round
   * @returns {Promise<Array>}
   */
  getResultsBySeasonAndRoundFromDb = async (season: string, round: string) => {
    try {
      const query = `
            SELECT 
                r.*, 
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM results r
            LEFT JOIN drivers d ON r.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE r.season = $1 AND r.round = $2
            ORDER BY CAST(r.position AS INTEGER) ASC
        `;
      const result = await this.db.query(query, [season, round]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching results from database:', error.message);
      throw error;
    }
  };

  /**
   * Fetches statistics overall for ticker from the database, including driver and constructor info
   * @param {string} season
   * @returns {Promise<Array>}
   */
  getStatsOverallFromDb = async (season: string) => {
    try {
      // get top driver for ticker
      const driverQuery = `
            SELECT
                ds.points,
                d.family_name
            FROM drivers_season ds
            LEFT JOIN drivers d ON ds.driver_id = d.id
            WHERE ds.season = $1
            ORDER BY ds.points DESC LIMIT 1;
        `;
      const driverResult = await this.db.query(driverQuery, [season]);

      // get top constructor for ticker
      const constructorQuery = `
            SELECT
                cs.points,
                c.name
            FROM constructors_season cs
            LEFT JOIN constructors c ON cs.constructors_id = c.id::integer
            WHERE cs.season = $1
            ORDER BY cs.points DESC LIMIT 1;
        `;
      const constructorResult = await this.db.query(constructorQuery, [season]);

      // get youngest driver
      const youngestDriverQuery = `
            select d.family_name, ds.points
                from drivers d
                INNER JOIN drivers_season ds ON d.id = ds.driver_id
                ORDER BY d.dob DESC
                LIMIT 1;
        `;
      const youngestDriverResult = await this.db.query(youngestDriverQuery);

      // get maximum poles this season
      const polesQuery = `
            SELECT driver_number, COUNT(*) AS pole_positions, d.family_name
            FROM results
            INNER JOIN drivers d on d.number = results.driver_number
            WHERE season = $1 AND grid = '1'
            GROUP BY driver_number, d,family_name
            ORDER BY pole_positions DESC
            LIMIT 1;
        `;
      const polesResult = await this.db.query(polesQuery, [season]);

      const tickerData = {
        topDriver: driverResult.rows[0].family_name,
        topDriverPoints: driverResult.rows[0].points,
        topConstructor: constructorResult.rows[0].name,
        topConstructorPoints: constructorResult.rows[0].points,
        youngestDriver: youngestDriverResult.rows[0].family_name,
        youngestDriverPoints: youngestDriverResult.rows[0].points,
        maxPoles: polesResult.rows[0].family_name,
        maxPolesCount: polesResult.rows[0].pole_positions,
      };

      return tickerData;
    } catch (error) {
      console.error('Error fetching statistics from database:', error.message);
      throw error;
    }
  };

  /**
   * Syncs qualifying results from external API to local database
   * @returns {Promise<Object>}
   */
  syncQualifying = async () => {
    try {
      return await this.db.transaction(async (client) => {
        let totalCount = 0;
        let offset = 0;
        const limit = 100; // Fetch 100 results per request
        let hasMore = true;

        while (hasMore) {
          const url = `https://api.jolpi.ca/ergast/f1/2026/qualifying/?format=json&limit=${limit}&offset=${offset}`;
          console.log(`Syncing qualifying results: offset ${offset}, limit ${limit}...`);

          const response = await axios.get(url);
          const mrData = response.data.MRData;
          const races = mrData.RaceTable.Races;
          const total = parseInt(mrData.total);

          if (!races || races.length === 0) {
            hasMore = false;
            break;
          }

          const insertQuery = `
                INSERT INTO qualifying (
                    id, season, round, driver_number, position, q1, q2, q3
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE
                SET 
                    driver_number = EXCLUDED.driver_number,
                    position = EXCLUDED.position,
                    q1 = EXCLUDED.q1,
                    q2 = EXCLUDED.q2,
                    q3 = EXCLUDED.q3,
                    updated_at = NOW()
            `;

          for (const race of races) {
            const season = race.season;
            const round = race.round;
            const qualifyingResults = race.QualifyingResults;

            for (const item of qualifyingResults) {
              const driverId = item.Driver.driverId;
              const id = `${season}_${round}_${driverId}`;

              const values = [
                id,
                season,
                round,
                item.number,
                item.position,
                item.Q1 || null,
                item.Q2 || null,
                item.Q3 || null,
              ];

              await client.query(insertQuery, values);
              totalCount++;
            }
          }

          offset += limit;
          if (offset >= total) {
            hasMore = false;
          }
        }

        return {
          success: true,
          message: `Successfully synced ${totalCount} qualifying results`,
          total: totalCount,
        };
      });
    } catch (error) {
      console.error('Error syncing qualifying results:', error.message);
      throw error;
    }
  };

  /**
   * Fetches qualifying results by season and round from the database, including driver and constructor info
   * @param {string} season
   * @param {string} round
   * @returns {Promise<Array>}
   */
  getQualifyingBySeasonAndRoundFromDb = async (season: string, round: string) => {
    try {
      const query = `
            SELECT 
                q.*, 
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM qualifying q
            LEFT JOIN drivers d ON q.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE q.season = $1 AND q.round = $2
            ORDER BY CAST(q.position AS INTEGER) ASC
        `;
      const result = await this.db.query(query, [season, round]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching qualifying results from database:', error.message);
      throw error;
    }
  };

  // DDL for the sprint tables, applied lazily on sync so no manual migration
  // is required (mirrors sql/sprint.sql).
  SPRINT_RESULTS_DDL = `
    CREATE TABLE IF NOT EXISTS sprint_results (
        id                TEXT PRIMARY KEY,
        season            TEXT NOT NULL,
        round             TEXT NOT NULL,
        driver_number     TEXT,
        position          TEXT,
        points            TEXT,
        grid              TEXT,
        laps              TEXT,
        status            TEXT,
        time              TEXT,
        fastest_lap       TEXT,
        fastest_lap_rank  TEXT,
        fastest_lap_time  TEXT,
        updated_at        TIMESTAMPTZ DEFAULT now()
    )
`;

  SPRINT_QUALIFYING_DDL = `
    CREATE TABLE IF NOT EXISTS sprint_qualifying (
        id                TEXT PRIMARY KEY,
        season            TEXT NOT NULL,
        round             TEXT NOT NULL,
        driver_number     TEXT,
        position          TEXT,
        sq1               TEXT,
        sq2               TEXT,
        sq3               TEXT,
        updated_at        TIMESTAMPTZ DEFAULT now()
    )
`;

  /**
   * Syncs sprint race results from external API to local database
   * @returns {Promise<Object>}
   */
  syncSprintResults = async () => {
    try {
      return await this.db.transaction(async (client) => {
        let totalCount = 0;
        let offset = 0;
        const limit = 100; // Fetch 100 results per request
        let hasMore = true;

        await client.query(this.SPRINT_RESULTS_DDL);

        while (hasMore) {
          const url = `https://api.jolpi.ca/ergast/f1/2026/sprint/?format=json&limit=${limit}&offset=${offset}`;
          console.log(`Syncing sprint results: offset ${offset}, limit ${limit}...`);

          const response = await axios.get(url);
          const mrData = response.data.MRData;
          const races = mrData.RaceTable.Races;
          const total = parseInt(mrData.total);

          if (!races || races.length === 0) {
            hasMore = false;
            break;
          }

          const insertQuery = `
                INSERT INTO sprint_results (
                    id, season, round, driver_number, position, points, grid, laps, status,
                    time, fastest_lap, fastest_lap_rank, fastest_lap_time
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE
                SET
                    driver_number = EXCLUDED.driver_number,
                    position = EXCLUDED.position,
                    points = EXCLUDED.points,
                    grid = EXCLUDED.grid,
                    laps = EXCLUDED.laps,
                    status = EXCLUDED.status,
                    time = EXCLUDED.time,
                    fastest_lap = EXCLUDED.fastest_lap,
                    fastest_lap_rank = EXCLUDED.fastest_lap_rank,
                    fastest_lap_time = EXCLUDED.fastest_lap_time,
                    updated_at = NOW()
            `;

          for (const race of races) {
            const season = race.season;
            const round = race.round;
            const sprintResults = race.SprintResults;

            for (const item of sprintResults) {
              const driverId = item.Driver.driverId;
              const id = `${season}_${round}_${driverId}`;

              const values = [
                id,
                season,
                round,
                item.number,
                item.position,
                item.points,
                item.grid,
                item.laps,
                item.status,
                item.Time ? item.Time.time : null,
                item.FastestLap ? item.FastestLap.lap : null,
                item.FastestLap ? item.FastestLap.rank : null,
                item.FastestLap && item.FastestLap.Time ? item.FastestLap.Time.time : null,
              ];

              await client.query(insertQuery, values);
              totalCount++;
            }
          }

          offset += limit;
          if (offset >= total) {
            hasMore = false;
          }
        }

        return {
          success: true,
          message: `Successfully synced ${totalCount} sprint results`,
          total: totalCount,
        };
      });
    } catch (error) {
      console.error('Error syncing sprint results:', error.message);
      throw error;
    }
  };

  /**
   * Fetches sprint results by season and round from the database, including driver and constructor info
   * @param {string} season
   * @param {string} round
   * @returns {Promise<Array>}
   */
  getSprintResultsBySeasonAndRoundFromDb = async (season: string, round: string) => {
    try {
      const query = `
            SELECT
                s.*,
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM sprint_results s
            LEFT JOIN drivers d ON s.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE s.season = $1 AND s.round = $2
            ORDER BY CAST(s.position AS INTEGER) ASC
        `;
      const result = await this.db.query(query, [season, round]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching sprint results from database:', error.message);
      throw error;
    }
  };

  // Format an OpenF1 duration (seconds, e.g. 91.52) as a lap-time string
  // matching the qualifying table's format (e.g. "1:31.520").
  formatLapTime = (seconds: number) => {
    if (seconds === null || seconds === undefined || isNaN(seconds)) return null;
    const mins = Math.floor(seconds / 60);
    const secs = (seconds - mins * 60).toFixed(3).padStart(6, '0');
    return `${mins}:${secs}`;
  };

  /**
   * Syncs sprint qualifying classification to the local database. Jolpica has no
   * sprint qualifying endpoint, so this pulls from OpenF1: session list filtered
   * to "Sprint Qualifying", then per-session results whose `duration` array holds
   * the best SQ1/SQ2/SQ3 laps. Rounds are resolved by matching the session date
   * to races.sprint_quali_date.
   * @returns {Promise<Object>}
   */
  syncSprintQualifying = async () => {
    try {
      return await this.db.transaction(async (client) => {
        const season = '2026';
        let totalCount = 0;

        await client.query(this.SPRINT_QUALIFYING_DDL);

        const sessionsUrl = `https://api.openf1.org/v1/sessions?year=${season}&session_name=Sprint%20Qualifying`;
        const sessionsResponse = await axios.get(sessionsUrl);
        const sessions = sessionsResponse.data || [];

        const insertQuery = `
            INSERT INTO sprint_qualifying (
                id, season, round, driver_number, position, sq1, sq2, sq3
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (id) DO UPDATE
            SET
                driver_number = EXCLUDED.driver_number,
                position = EXCLUDED.position,
                sq1 = EXCLUDED.sq1,
                sq2 = EXCLUDED.sq2,
                sq3 = EXCLUDED.sq3,
                updated_at = NOW()
        `;

        for (const session of sessions) {
          // Only sessions that have finished have a classification.
          if (new Date(session.date_end) > new Date()) continue;

          const sessionDate = session.date_start.slice(0, 10);
          const roundResult = await client.query(
            'SELECT round FROM races WHERE season = $1 AND sprint_quali_date = $2',
            [season, sessionDate],
          );
          if (roundResult.rows.length === 0) {
            console.warn(`No race found for sprint qualifying on ${sessionDate}, skipping`);
            continue;
          }
          const round = roundResult.rows[0].round;

          console.log(
            `Syncing sprint qualifying: round ${round} (session ${session.session_key})...`,
          );
          const resultsUrl = `https://api.openf1.org/v1/session_result?session_key=${session.session_key}`;
          const resultsResponse = await axios.get(resultsUrl);

          for (const item of resultsResponse.data || []) {
            if (item.position === null || item.driver_number === null) continue;
            const id = `${season}_${round}_${item.driver_number}`;
            const durations = Array.isArray(item.duration) ? item.duration : [item.duration];

            const values = [
              id,
              season,
              round,
              String(item.driver_number),
              String(item.position),
              this.formatLapTime(durations[0]),
              this.formatLapTime(durations[1]),
              this.formatLapTime(durations[2]),
            ];

            await client.query(insertQuery, values);
            totalCount++;
          }

          // Stay under the external API's burst rate limit.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }

        return {
          success: true,
          message: `Successfully synced ${totalCount} sprint qualifying results`,
          total: totalCount,
        };
      });
    } catch (error) {
      console.error('Error syncing sprint qualifying results:', error.message);
      throw error;
    }
  };

  /**
   * Fetches sprint qualifying results by season and round from the database, including driver and constructor info
   * @param {string} season
   * @param {string} round
   * @returns {Promise<Array>}
   */
  getSprintQualifyingBySeasonAndRoundFromDb = async (season: string, round: string) => {
    try {
      const query = `
            SELECT
                sq.*,
                sq.sq1 as q1, sq.sq2 as q2, sq.sq3 as q3,
                d.given_name, d.family_name, d.code, d.nationality,
                c.name as team_name
            FROM sprint_qualifying sq
            LEFT JOIN drivers d ON sq.driver_number = d.number
            LEFT JOIN constructors c ON d.constructor_id = c.id
            WHERE sq.season = $1 AND sq.round = $2
            ORDER BY CAST(sq.position AS INTEGER) ASC
        `;
      const result = await this.db.query(query, [season, round]);
      return result.rows;
    } catch (error) {
      console.error('Error fetching sprint qualifying results from database:', error.message);
      throw error;
    }
  };

  // Completed races are immutable, so lap data is cached in memory for the
  // lifetime of the process to avoid re-hitting the external API.
  lapPositionsCache = new Map();

  /**
   * Fetches lap-by-lap positions for a race from the external API (paginated).
   * @param {string} season
   * @param {string} round
   * @returns {Promise<Object>} { season, round, totalLaps, drivers: { [driverId]: [{ lap, position }] } }
   */
  getLapPositions = async (season: string, round: string) => {
    const cacheKey = `${season}_${round}`;
    if (this.lapPositionsCache.has(cacheKey)) {
      return this.lapPositionsCache.get(cacheKey);
    }

    try {
      const limit = 100; // API caps page size at 100 timing entries
      let offset = 0;
      let hasMore = true;
      const drivers: Record<string, { lap: number; position: number }[]> = {};
      let totalLaps = 0;

      while (hasMore) {
        const url = `https://api.jolpi.ca/ergast/f1/${season}/${round}/laps/?format=json&limit=${limit}&offset=${offset}`;
        const response = await axios.get(url);
        const mrData = response.data.MRData;
        const races = mrData.RaceTable.Races;
        const total = parseInt(mrData.total);

        if (!races || races.length === 0) {
          hasMore = false;
          break;
        }

        for (const lap of races[0].Laps || []) {
          const lapNumber = parseInt(lap.number);
          totalLaps = Math.max(totalLaps, lapNumber);
          for (const timing of lap.Timings || []) {
            if (!drivers[timing.driverId]) drivers[timing.driverId] = [];
            drivers[timing.driverId].push({
              lap: lapNumber,
              position: parseInt(timing.position),
            });
          }
        }

        offset += limit;
        if (offset >= total) hasMore = false;
        // Stay under the external API's burst rate limit.
        if (hasMore) await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const payload = { season, round, totalLaps, drivers };
      if (totalLaps > 0) {
        this.lapPositionsCache.set(cacheKey, payload);
      }
      return payload;
    } catch (error) {
      console.error('Error fetching lap positions:', error.message);
      throw error;
    }
  };

  constructor(private readonly db: DatabaseService) {}
}
