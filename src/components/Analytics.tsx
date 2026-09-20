'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let started = false;

function start() {
  if (started || !KEY || typeof window === 'undefined') return;
  started = true;
  posthog.init(KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: 'identified_only',
    disable_session_recording: true,
    autocapture: false,
  });
}

function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();

  useEffect(() => { start(); }, []);

  useEffect(() => {
    if (!KEY) return;
    posthog.capture('$pageview', { $current_url: window.location.href });
  }, [pathname, params]);

  const email = session?.user?.email;
  useEffect(() => {
    if (KEY && email) posthog.identify(email, { email });
  }, [email]);

  return null;
}

export function Analytics() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (KEY && started) posthog.capture(event, props);
}
