import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StatusView, StatusUnavailable } from '@/components/status/StatusView';
import { allOperational, justStarted, withDegradedDayAndIncident, activeIncidentPartialOutage } from '../helpers/statusFixtures';
import type { StatusSnapshot } from '@/lib/status/types';

const html = (s: StatusSnapshot) => renderToStaticMarkup(createElement(StatusView, { snapshot: s }));

describe('status page honesty', () => {
  it('shows no uptime percentage with under 7 days of data, and says why', () => {
    const out = html(justStarted());
    expect(out).not.toMatch(/\d+(\.\d+)?% of checks passed/);
    expect(out).toContain('Monitoring just started');
    expect(out).toContain('no uptime percentage until at least 7 days');
    expect(out).toContain('Monitoring since');
  });

  it('empty days are rendered gray "no data", never green', () => {
    const out = html(justStarted());
    const bars = [...out.matchAll(/role="img" aria-label="Last 90 days[^"]*"[^>]*>(.*?)<\/div><div class="mt-1\.5/g)].map((m) => m[1]);
    expect(bars).toHaveLength(4);
    for (const bar of bars) {
      expect((bar.match(/bg-gray-200/g) ?? []).length).toBe(89);
      expect((bar.match(/bg-green-500/g) ?? []).length).toBe(1); // only today has data
    }
    expect(out).toContain('89 with no data');
  });

  it('with 90 days of data shows the percentage and the all-operational banner', () => {
    const out = html(allOperational());
    expect(out).toContain('All systems operational');
    expect(out).toContain('100% of checks passed');
  });

  it('renders degraded day, incident and does not claim an SLA', () => {
    const out = html(withDegradedDayAndIncident());
    expect(out).toContain('bg-amber-400');
    expect(out).toContain('Slower voice responses');
    expect(out).toContain('not a service level agreement');
    expect(out).not.toMatch(/SLA guarantee|SOC ?2|HIPAA|guaranteed uptime/i);
    expect(out).not.toContain('activeCalls');
  });

  it('active incident and partial outage show up top', () => {
    const out = html(activeIncidentPartialOutage());
    expect(out).toContain('Partial outage');
    expect(out).toContain('Active incidents');
    expect(out).toContain('Call engine not responding');
  });

  it('links to support and includes accessible summaries', () => {
    const out = html(allOperational());
    expect(out).toContain('mailto:support@calldesk.tech');
    expect(out).toMatch(/role="img" aria-label="Last 90 days: 90 days operational/);
  });

  it('unavailable state makes no health claim', () => {
    const out = renderToStaticMarkup(createElement(StatusUnavailable));
    expect(out).toContain('temporarily unavailable');
    expect(out).not.toContain('All systems operational');
  });
});
