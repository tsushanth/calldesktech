import path from 'node:path';
import { loadLibrary, type Library } from '@/lib/seoLibrary/load';

export const FIXTURE_DIR = path.join(process.cwd(), 'test', 'fixtures', 'seo-library');
/** Fixed clock so freshness checks do not depend on the day the tests run. */
export const NOW = new Date('2026-10-10T12:00:00Z');

export function fixtureLibrary(): Library {
  return loadLibrary(FIXTURE_DIR);
}

/** A deep copy so a test can edit it. */
export function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
