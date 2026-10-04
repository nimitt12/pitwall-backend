import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../database/database.service.js';

@Injectable()
export class DriverService {
  /**
   * Fetches all drivers from the database
   * @returns {Promise<Array>}
   */
  getAllDriversFromDb = async () => {
    try {
      const result = await this.db.query('SELECT * FROM drivers ORDER BY family_name ASC');
      return result.rows;
    } catch (error) {
      console.error('Error fetching drivers from database:', error.message);
      throw error;
    }
  };

  /**
   * Syncs driver season data from external API to local database
   * @returns {Promise<Object>}
   */
  syncDriverSeason = async () => {
    try {
      return await this.db.transaction(async (client) => {
        const response = await axios.get(
          'https://api.jolpi.ca/ergast/f1/2026/driverstandings/?format=json',
        );
        const standingsList = response.data.MRData.StandingsTable.StandingsLists[0];
        const season = standingsList.season;
        const rounds = standingsList.round;
        const driverStandings = standingsList.DriverStandings;

        // Fetch local drivers for mapping slugs to IDs
        const localDrivers = await this.getAllDriversFromDb();
        const driverMap: Record<string, string> = {};

        localDrivers.forEach((d) => {
          // Using driver code (e.g., 'ANT', 'RUS') for more reliable mapping
          if (d.code) {
            driverMap[d.code.toUpperCase()] = d.id;
          }
        });

        // Insert or update drivers in the database
        const insertQuery = `
            INSERT INTO drivers_season (id, driver_id, season, points, wins, rounds, position)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO UPDATE
            SET points = EXCLUDED.points, wins = EXCLUDED.wins, rounds = EXCLUDED.rounds, position = EXCLUDED.position
        `;

        const values = driverStandings
          .map((item: any) => {
            const apiCode = item.Driver.code;
            const dbId = driverMap[apiCode];

            if (!dbId) {
              console.warn(
                `Warning: No mapping found for external driver code: ${apiCode} (${item.Driver.familyName})`,
              );
              return null;
            }

            // Generate a unique text ID for the season entry
            const entryId = `${dbId}_${season}`;

            return [
              entryId,
              dbId,
              season.toString(),
              item.points.toString(),
              item.wins.toString(),
              rounds.toString(),
              item.position.toString(),
            ];
          })
          .filter((v: unknown) => v !== null);

        // Use transaction for batch insert/update

        for (const value of values) {
          await client.query(insertQuery, value);
        }

        return {
          success: true,
          message: 'Driver season synced successfully',
          count: values.length,
          data: driverStandings,
        };
      });
    } catch (error) {
      console.error('Error syncing driver season:', error.message);
      throw error;
    }
  };

  /**
   * Fetches all driver season rankings from the database
   * @returns {Promise<Array>}
   */
  getAllDriversSeasonRankingsFromDb = async () => {
    try {
      const result = await this.db.query(`
            SELECT ds.*, d.given_name, d.family_name, d.code, d.number, d.nationality, c.name as constructor_name,
                COALESCE(p.podiums, 0) AS podiums
            FROM drivers_season ds
            JOIN drivers d ON ds.driver_id = d.id
            LEFT JOIN constructors c ON d.constructor_id = c.id
            LEFT JOIN (
                SELECT season, driver_number, COUNT(*) AS podiums
                FROM results
                WHERE position IN ('1', '2', '3')
                GROUP BY season, driver_number
            ) p ON p.season = ds.season AND p.driver_number = d.number
            ORDER BY season DESC, CAST(points AS NUMERIC) DESC`);
      return result.rows;
    } catch (error) {
      console.error('Error fetching driver season rankings from database:', error.message);
      throw error;
    }
  };

  /**
   * Fetches a single driver's season stats (points/wins/podiums/poles/fastest
   * laps/points finishes) plus their last 5 race results for a season.
   * @param {string} season
   * @param {string} driverId
   * @returns {Promise<Object|null>}
   */
  getDriverStatsForComparison = async (
    season: string,
    driverId: string,
  ): Promise<(Record<string, any> & { number: string; last5: Record<string, any>[] }) | null> => {
    const result = await this.db.query(
      `
        SELECT
            d.id as driver_id, d.number, d.code, d.given_name, d.family_name, d.nationality,
            c.name as constructor_name,
            ds.points, ds.wins, ds.position,
            COALESCE(podiums.cnt, 0) as podiums,
            COALESCE(poles.cnt, 0) as poles,
            COALESCE(fl.cnt, 0) as fastest_laps,
            COALESCE(pf.cnt, 0) as points_finishes
        FROM drivers d
        JOIN drivers_season ds ON ds.driver_id = d.id AND ds.season = $1
        LEFT JOIN constructors c ON d.constructor_id = c.id
        LEFT JOIN (
            SELECT driver_number, COUNT(*) cnt FROM results
            WHERE season = $1 AND position IN ('1', '2', '3')
            GROUP BY driver_number
        ) podiums ON podiums.driver_number = d.number
        LEFT JOIN (
            SELECT driver_number, COUNT(*) cnt FROM qualifying
            WHERE season = $1 AND position = '1'
            GROUP BY driver_number
        ) poles ON poles.driver_number = d.number
        LEFT JOIN (
            SELECT driver_number, COUNT(*) cnt FROM results
            WHERE season = $1 AND fastest_lap_rank = '1'
            GROUP BY driver_number
        ) fl ON fl.driver_number = d.number
        LEFT JOIN (
            SELECT driver_number, COUNT(*) cnt FROM results
            WHERE season = $1 AND points ~ '^[0-9.]+$' AND CAST(points AS NUMERIC) > 0
            GROUP BY driver_number
        ) pf ON pf.driver_number = d.number
        WHERE d.id = $2
    `,
      [season, driverId],
    );

    if (result.rows.length === 0) return null;
    const row = result.rows[0];

    const last5Result = await this.db.query(
      `
        SELECT r.round, r.position, r.status, r.points, ra.race_name
        FROM results r
        LEFT JOIN races ra ON ra.season = r.season AND ra.round = r.round
        WHERE r.season = $1 AND r.driver_number = $2
        ORDER BY CAST(r.round AS INTEGER) DESC
        LIMIT 5
    `,
      [season, row.number],
    );

    return { ...row, number: row.number, last5: last5Result.rows };
  };

  /**
   * Builds a full head-to-head comparison between two drivers for a season:
   * per-driver season stats + last 5 results, plus qualifying/race head-to-head
   * win counts across rounds both drivers were classified in.
   * @param {string} season
   * @param {string} driverId1
   * @param {string} driverId2
   * @returns {Promise<Object|null>}
   */
  getDriverComparisonFromDb = async (season: string, driverId1: string, driverId2: string) => {
    try {
      const [driver1, driver2] = await Promise.all([
        this.getDriverStatsForComparison(season, driverId1),
        this.getDriverStatsForComparison(season, driverId2),
      ]);

      if (!driver1 || !driver2) {
        return null;
      }

      const qualiH2H = await this.db.query(
        `
            SELECT
                SUM(CASE WHEN CAST(q1.position AS INTEGER) < CAST(q2.position AS INTEGER) THEN 1 ELSE 0 END) AS d1_wins,
                SUM(CASE WHEN CAST(q2.position AS INTEGER) < CAST(q1.position AS INTEGER) THEN 1 ELSE 0 END) AS d2_wins
            FROM qualifying q1
            JOIN qualifying q2 ON q1.round = q2.round AND q1.season = q2.season
            WHERE q1.season = $1 AND q1.driver_number = $2 AND q2.driver_number = $3
              AND q1.position ~ '^[0-9]+$' AND q2.position ~ '^[0-9]+$'
        `,
        [season, driver1.number, driver2.number],
      );

      const raceH2H = await this.db.query(
        `
            SELECT
                SUM(CASE WHEN CAST(r1.position AS INTEGER) < CAST(r2.position AS INTEGER) THEN 1 ELSE 0 END) AS d1_wins,
                SUM(CASE WHEN CAST(r2.position AS INTEGER) < CAST(r1.position AS INTEGER) THEN 1 ELSE 0 END) AS d2_wins
            FROM results r1
            JOIN results r2 ON r1.round = r2.round AND r1.season = r2.season
            WHERE r1.season = $1 AND r1.driver_number = $2 AND r2.driver_number = $3
              AND r1.position ~ '^[0-9]+$' AND r2.position ~ '^[0-9]+$'
        `,
        [season, driver1.number, driver2.number],
      );

      return {
        season,
        drivers: [driver1, driver2],
        h2h: {
          quali: {
            driver1: parseInt(qualiH2H.rows[0].d1_wins, 10) || 0,
            driver2: parseInt(qualiH2H.rows[0].d2_wins, 10) || 0,
          },
          race: {
            driver1: parseInt(raceH2H.rows[0].d1_wins, 10) || 0,
            driver2: parseInt(raceH2H.rows[0].d2_wins, 10) || 0,
          },
        },
      };
    } catch (error) {
      console.error('Error fetching driver comparison from database:', error.message);
      throw error;
    }
  };

  constructor(private readonly db: DatabaseService) {}
}
