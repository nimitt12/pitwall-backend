import { readBoundedText } from '../security/upstream.js';
import type { ArchiveStream } from './live-timing.types.js';

type JsonRow = Record<string, any>;

export class OpenF1Archive {
  private readonly baseUrl = 'https://api.openf1.org/v1';
  private readonly cache = new Map<string, { data: unknown; fetchedAt: number }>();
  private lastRequestAt = 0;
  private requestQueue = Promise.resolve();

  constructor(private readonly shutdownSignal: AbortSignal) {}

  private async get(
    path: string,
    ttlMs: number,
    operationSignal: AbortSignal = this.shutdownSignal,
  ): Promise<JsonRow[]> {
    const cached = this.cache.get(path);
    if (cached && Date.now() - cached.fetchedAt < ttlMs) return cached.data as JsonRow[];

    // OpenF1's anonymous API allows three requests per second. Serialize calls
    // with a little margin so one replay cannot immediately rate-limit itself.
    const signal = AbortSignal.any([this.shutdownSignal, operationSignal]);
    const previous = this.requestQueue;
    let release!: () => void;
    this.requestQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const waitMs = Math.max(0, 350 - (Date.now() - this.lastRequestAt));
      if (waitMs) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            clearTimeout(timer);
            reject(signal.reason);
          };
          const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
          }, waitMs);
          signal.addEventListener('abort', onAbort, { once: true });
        });
      }
      this.lastRequestAt = Date.now();
    } finally {
      release();
    }

    const response = await fetch(`${this.baseUrl}/${path}`, {
      headers: { Accept: 'application/json', 'User-Agent': 'Pitwall/1.0' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: 'error',
    });
    if (!response.ok) {
      const error: Error & { status?: number } = new Error(
        `OpenF1 request failed: HTTP ${response.status}`,
      );
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }
    const data = JSON.parse(await readBoundedText(response, 32 * 1024 * 1024));
    if (!Array.isArray(data)) throw new Error('Invalid OpenF1 response');
    this.cache.set(path, { data, fetchedAt: Date.now() });
    return data;
  }

  async getIndex(year: number) {
    if (year < 2023) return { Meetings: [] };
    const ttl = year === new Date().getUTCFullYear() ? 5 * 60_000 : 24 * 3_600_000;
    const [meetings, sessions] = await Promise.all([
      this.get(`meetings?year=${year}`, ttl),
      this.get(`sessions?year=${year}`, ttl),
    ]);
    return {
      Provider: 'openf1',
      Meetings: meetings.map((meeting) => ({
        Key: meeting.meeting_key,
        Name: meeting.meeting_name,
        Location: meeting.location,
        Country: { Name: meeting.country_name, Code: meeting.country_code },
        Sessions: sessions
          .filter(
            (session) =>
              session.meeting_key === meeting.meeting_key &&
              !session.is_cancelled &&
              new Date(session.date_start).getTime() <= Date.now(),
          )
          .map((session) => ({
            Key: session.session_key,
            Name: session.session_name,
            Path: `${year}/openf1_${meeting.meeting_key}/openf1_${session.session_key}/`,
          })),
      })),
    };
  }

  private at(sessionStart: number, date: unknown, fallback = 0) {
    const timestamp = typeof date === 'string' ? Date.parse(date) : Number.NaN;
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - sessionStart) : fallback;
  }

  private time(seconds: unknown) {
    if (!Number.isFinite(Number(seconds))) return '';
    const totalMs = Math.round(Number(seconds) * 1000);
    const minutes = Math.floor(totalMs / 60_000);
    const remainder = totalMs - minutes * 60_000;
    return `${minutes}:${(remainder / 1000).toFixed(3).padStart(6, '0')}`;
  }

  private stream(topic: string, events: Array<{ t: number; data: unknown }>): ArchiveStream {
    return {
      topic,
      idx: 0,
      lines: events
        .filter((event) => Number.isFinite(event.t))
        .sort((a, b) => a.t - b.t)
        .map((event) => ({ t: event.t, raw: JSON.stringify(event.data) })),
    };
  }

  async getStreams(path: string, signal: AbortSignal): Promise<ArchiveStream[]> {
    const match = /^(\d{4})\/openf1_(\d+)\/openf1_(\d+)\/$/.exec(path);
    if (!match) throw Object.assign(new Error('Invalid OpenF1 session path'), { status: 400 });
    const sessionKey = Number(match[3]);
    const ttl = 24 * 3_600_000;
    const sessions = await this.get(`sessions?session_key=${sessionKey}`, ttl, signal);
    const session = sessions[0];
    if (!session) throw Object.assign(new Error('OpenF1 session not found'), { status: 404 });
    const meetings = await this.get(`meetings?meeting_key=${session.meeting_key}`, ttl, signal);
    const meeting = meetings[0] || {};
    const start = Date.parse(session.date_start);
    const duration = Math.max(1, Date.parse(session.date_end) - start);

    const endpoint = (name: string) => this.get(`${name}?session_key=${sessionKey}`, ttl, signal);
    // Keep these sequential: anonymous OpenF1 traffic is capped at 3 req/s.
    const drivers = await endpoint('drivers');
    const laps = await endpoint('laps');
    const positions = await endpoint('position');
    const intervals = await endpoint('intervals');
    const stints = await endpoint('stints');
    const pits = await endpoint('pit');
    const raceControl = await endpoint('race_control');
    const weather = await endpoint('weather');
    const radio = await endpoint('team_radio');

    const driverMap = Object.fromEntries(
      drivers.map((driver) => [
        String(driver.driver_number),
        {
          RacingNumber: String(driver.driver_number),
          BroadcastName: driver.broadcast_name,
          FullName: driver.full_name,
          Tla: driver.name_acronym,
          TeamName: driver.team_name,
          TeamColour: driver.team_colour,
          HeadshotUrl: driver.headshot_url,
          CountryCode: driver.country_code,
        },
      ]),
    );
    const sessionInfo = {
      Name: session.session_name,
      Type: session.session_type,
      StartDate: session.date_start,
      EndDate: session.date_end,
      Meeting: {
        Key: session.meeting_key,
        Name: meeting.meeting_name || session.location,
        Location: session.location,
        Country: { Name: session.country_name, Code: session.country_code },
        Circuit: { Key: session.circuit_key, ShortName: session.circuit_short_name },
      },
    };

    const best = new Map<number, number>();
    const lapEvents = laps.map((lap) => {
      const number = Number(lap.driver_number);
      const lapDuration = Number(lap.lap_duration);
      if (Number.isFinite(lapDuration) && (!best.has(number) || lapDuration < best.get(number)!)) {
        best.set(number, lapDuration);
      }
      const lapStart = this.at(start, lap.date_start);
      return {
        t: lapStart + (Number.isFinite(lapDuration) ? lapDuration * 1000 : 0),
        data: {
          Lines: {
            [number]: {
              RacingNumber: String(number),
              NumberOfLaps: lap.lap_number,
              LastLapTime: { Value: this.time(lap.lap_duration) },
              BestLapTime: { Value: this.time(best.get(number)) },
              Sectors: [1, 2, 3].map((sector) => ({
                Value: this.time(lap[`duration_sector_${sector}`]),
                Segments: (lap[`segments_sector_${sector}`] || []).map((Status: number) => ({
                  Status,
                })),
              })),
            },
          },
        },
      };
    });
    const positionEvents = positions.map((row) => ({
      t: this.at(start, row.date),
      data: { Lines: { [row.driver_number]: { Position: String(row.position) } } },
    }));
    const intervalEvents = intervals.map((row) => ({
      t: this.at(start, row.date),
      data: {
        Lines: {
          [row.driver_number]: {
            GapToLeader:
              row.gap_to_leader == null
                ? ''
                : typeof row.gap_to_leader === 'number'
                  ? `+${row.gap_to_leader.toFixed(3)}`
                  : String(row.gap_to_leader),
            IntervalToPositionAhead: {
              Value:
                row.interval == null
                  ? ''
                  : typeof row.interval === 'number'
                    ? `+${row.interval.toFixed(3)}`
                    : String(row.interval),
            },
          },
        },
      },
    }));
    const pitCounts = new Map<number, number>();
    const pitEvents = pits.map((pit) => {
      const number = Number(pit.driver_number);
      const count = (pitCounts.get(number) || 0) + 1;
      pitCounts.set(number, count);
      return {
        t: this.at(start, pit.date),
        data: { Lines: { [number]: { NumberOfPitStops: count } } },
      };
    });
    const lapStartByDriver = new Map<string, Map<number, number>>();
    for (const lap of laps) {
      const driver = String(lap.driver_number);
      if (!lapStartByDriver.has(driver)) lapStartByDriver.set(driver, new Map());
      lapStartByDriver.get(driver)!.set(Number(lap.lap_number), this.at(start, lap.date_start));
    }
    const stintEvents = stints.map((stint) => {
      const number = String(stint.driver_number);
      const t = lapStartByDriver.get(number)?.get(Number(stint.lap_start)) || 0;
      return {
        t,
        data: {
          Lines: {
            [number]: {
              Stints: [
                {
                  Compound: String(stint.compound || 'UNKNOWN').toUpperCase(),
                  New: String(stint.tyre_age_at_start === 0),
                  StartLaps: stint.tyre_age_at_start || 0,
                  TotalLaps: Math.max(
                    0,
                    Number(stint.lap_end || stint.lap_start) - Number(stint.lap_start) + 1,
                  ),
                },
              ],
            },
          },
        },
      };
    });
    const raceControlEvents = raceControl.map((message, index) => ({
      t: this.at(start, message.date),
      data: {
        Messages: {
          [index]: {
            Utc: message.date,
            Category: message.category,
            Message: message.message,
            Flag: message.flag,
            Scope: message.scope,
            RacingNumber: message.driver_number ? String(message.driver_number) : undefined,
          },
        },
      },
    }));
    const trackEvents = raceControl
      .filter((message) => message.category === 'Flag' || message.category === 'SafetyCar')
      .map((message) => ({
        t: this.at(start, message.date),
        data: {
          Status:
            message.flag === 'RED'
              ? '5'
              : String(message.flag || '').includes('YELLOW')
                ? '2'
                : String(message.category).includes('SafetyCar')
                  ? '4'
                  : '1',
        },
      }));
    const weatherEvents = weather.map((value) => ({
      t: this.at(start, value.date),
      data: {
        AirTemp: value.air_temperature,
        TrackTemp: value.track_temperature,
        Humidity: value.humidity,
        Pressure: value.pressure,
        Rainfall: value.rainfall,
        WindDirection: value.wind_direction,
        WindSpeed: value.wind_speed,
      },
    }));
    const radioEvents = radio.map((capture, index) => ({
      t: this.at(start, capture.date),
      data: {
        Captures: {
          [index]: {
            Utc: capture.date,
            RacingNumber: String(capture.driver_number),
            Path: capture.recording_url,
          },
        },
      },
    }));
    const totalLaps = Math.max(0, ...laps.map((lap) => Number(lap.lap_number) || 0));
    const lapCountEvents = laps.map((lap) => ({
      t: this.at(start, lap.date_start) + (Number(lap.lap_duration) || 0) * 1000,
      data: { CurrentLap: Number(lap.lap_number), TotalLaps: totalLaps },
    }));

    return [
      this.stream('SessionInfo', [{ t: 0, data: sessionInfo }]),
      this.stream('SessionData', [
        { t: 0, data: { StatusSeries: [{ Utc: session.date_start, SessionStatus: 'Started' }] } },
        {
          t: duration,
          data: { StatusSeries: { 1: { Utc: session.date_end, SessionStatus: 'Finished' } } },
        },
      ]),
      this.stream('DriverList', [{ t: 0, data: driverMap }]),
      this.stream('TimingData', [...positionEvents, ...intervalEvents, ...lapEvents, ...pitEvents]),
      this.stream('TimingAppData', stintEvents),
      this.stream('LapCount', lapCountEvents),
      this.stream('RaceControlMessages', raceControlEvents),
      this.stream('TrackStatus', [{ t: 0, data: { Status: '1' } }, ...trackEvents]),
      this.stream('WeatherData', weatherEvents),
      this.stream('TeamRadio', radioEvents),
    ].filter((stream) => stream.lines.length > 0);
  }

  clear() {
    this.cache.clear();
  }
}
