// Feed topics have different, evolving JSON shapes; preserve unrecognized fields.
export type FeedData = any;
export interface FeedUpdate {
  topic: string;
  data: FeedData;
  timestamp: string;
}
export interface ReplayMetadata {
  path: string;
  name: string;
  speed: number;
  paused: boolean;
  loading: boolean;
  startOffsetMs?: number;
}
export interface ReplayProgress extends ReplayMetadata {
  offsetMs: number;
  durationMs: number;
}
export interface LiveState {
  topics: Record<string, FeedData>;
  status: string;
  simulated: boolean;
  replay: ReplayMetadata | null;
  lastFeedAt: number | null;
  subscribers: number;
  error: string | null;
}
export interface Subscriber {
  onUpdate: (update: FeedUpdate) => void;
  onStatus?: (status: { status: string; error: string | null; simulated: boolean }) => void;
  onReplay?: (progress: ReplayProgress | null) => void;
  onSnapshot?: () => void;
  onShutdown?: () => void;
}
export interface ArchiveLine {
  t: number;
  raw: string;
}
export interface ArchiveStream {
  topic: string;
  lines: ArchiveLine[];
  idx: number;
}
export interface Replay {
  streams: ArchiveStream[];
  virtualMs: number;
  durationMs: number;
  speed: number;
  paused: boolean;
  interval: NodeJS.Timeout;
  lastTickAt: number;
}
export interface SimSector {
  value: number;
  pb: boolean;
  ob: boolean;
}
export interface SimStint {
  Compound: string;
  New: string;
  TotalLaps: number;
  StartLaps: number;
}
