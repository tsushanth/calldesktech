'use client';

import { useSyncExternalStore } from 'react';
import { dayNumber } from '@/lib/heroPool';

const subscribeNever = () => () => undefined;

/**
 * Today's date as a day number, known only in the browser: null while rendering on
 * the server, so a pre-rendered page stays valid whatever day it is served.
 */
export function useToday(): number | null {
  return useSyncExternalStore(subscribeNever, () => dayNumber(), () => null);
}
