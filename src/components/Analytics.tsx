'use client';

import { Suspense, useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import posthog from 'posthog-js';

const KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY;
let started = false;

// Where replay may run: agent builder, onboarding and the demo setup. A match is necessary, not sufficient:
// internal (staff) accounts are never recorded either.
const RECORDED_ROUTES = /^\/(dashboard\/agents|onboarding|demo)(\/|$)/;

function start() {
  if (started || !KEY || typeof window === 'undefined') return;
  started = true;
  posthog.init(KEY, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://us.i.posthog.com',
    capture_pageview: false,
    capture_pageleave: true,
    person_profiles: 'identified_only',
    // Session replay stays off by default and is switched on only for the builder and setup routes (see
    // RECORDED_ROUTES), never for call logs, transcripts or billing. Every input and textarea is masked, so
    // prompts, phone numbers and keys typed into forms never leave the browser.
    disable_session_recording: true,
    session_recording: { maskAllInputs: true, maskTextSelector: '[data-ph-mask]' },
    autocapture: false,
  });
}

function Tracker() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { data: session } = useSession();

  useEffect(() => { start(); }, []);

  useEffect(() => {
    // Internal admin pages (dashboards we built for ourselves, e.g. /admin/usage,
    // /admin/outreach) aren't visitor traffic — capturing them pollutes the
    // pageview signal we actually care about (real prospects hitting the site).
    if (!KEY || pathname?.startsWith('/admin')) return;
    posthog.capture('$pageview', { $current_url: window.location.href });
  }, [pathname, params]);

  const email = session?.user?.email;
  const internal = !!session?.user?.isInternal;
  useEffect(() => {
    if (!KEY || !email) return;
    posthog.identify(email, { email, internal });
    // Super property: every later event carries it, so reports can filter staff out with one condition.
    posthog.register({ internal });
  }, [email, internal]);

  useEffect(() => {
    if (!KEY || !started) return;
    const wanted = RECORDED_ROUTES.test(pathname || '') && !internal;
    if (wanted) posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  }, [pathname, internal]);

  return null;
}

export function Analytics() {
  return <Suspense fallback={null}><Tracker /></Suspense>;
}

export function track(event: string, props?: Record<string, unknown>) {
  if (KEY && started) posthog.capture(event, props);
}
