import pool from '@/data/heroPool.json';

// The clips the landing hero rotates through. They are made from licensed stock
// footage by scripts/hero-ingest.mjs, which writes src/data/heroPool.json.
export interface HeroClip {
  id: string;
  scenario: string;
  video: string;
  poster: string;
  width: number;
  height: number;
  seconds: number;
  source: { title: string; itemUrl: string; license: string };
}

const CLIPS = pool as HeroClip[];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days since the Unix epoch, in UTC, so everyone sees the same clip on a given day. */
export function dayNumber(now: Date = new Date()): number {
  return Math.floor(now.getTime() / DAY_MS);
}

export function hasClips(scenario: string): boolean {
  return CLIPS.some((c) => c.scenario === scenario);
}

// A small stable hash, so scenarios do not all step through their clips in lockstep.
function offset(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** The clip a scenario shows on a given day; it advances by one each day and wraps. */
export function clipForDay(scenario: string, day: number): HeroClip | null {
  const list = CLIPS.filter((c) => c.scenario === scenario);
  if (list.length === 0) return null;
  return list[(day + offset(scenario)) % list.length];
}
