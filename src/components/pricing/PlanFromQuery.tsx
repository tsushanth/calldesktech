'use client';

import { useEffect } from 'react';
import { parsePlan, storePlan } from '@/lib/planSelection';

// Remembers /pricing?plan=lite|standard|pro (for example after a sign-in round trip). Junk values are ignored. Renders nothing.
export function PlanFromQuery() {
  useEffect(() => {
    const plan = parsePlan(new URLSearchParams(window.location.search).get('plan'));
    if (plan) storePlan(plan);
  }, []);
  return null;
}
