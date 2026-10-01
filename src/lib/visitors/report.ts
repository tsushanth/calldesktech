import { adminEmails } from '@/lib/outreach/config';
import { queryPostHog } from './posthog';
import { classifyVisitor, parseList, type ClassifiedVisitor, type VisitorRow } from './classify';

const INTEREST_EVENTS = [
  '$pageview', 'hero_demo_started', 'demo_call_requested', 'demo_call_connected',
  'tenant_created', 'agent_created', 'agent_version_created', 'phone_number_routed',
];

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

/** One row per network address that visited in the last `days` days, classified. */
export async function loadVisitors(days: number): Promise<ClassifiedVisitor[]> {
  const n = Math.max(1, Math.min(90, Math.floor(days)));
  const events = INTEREST_EVENTS.map((e) => `'${e}'`).join(', ');
  const { results } = await queryPostHog(`
    SELECT
      toString(properties.$ip) AS ip,
      any(properties.$geoip_country_code) AS country,
      any(properties.$geoip_city_name) AS city,
      any(properties.$os) AS os,
      any(properties.$device_type) AS device,
      any(properties.$browser) AS browser,
      any(properties.$raw_user_agent) AS ua,
      any(properties.$referring_domain) AS referrer,
      countIf(event = '$pageview') AS pageviews,
      groupUniqArrayIf(properties.$pathname, event = '$pageview') AS paths,
      countIf(event = 'hero_demo_started') AS hero_started,
      countIf(event IN ('demo_call_requested', 'demo_call_connected')) AS demo_calls,
      countIf(event IN ('tenant_created', 'agent_created', 'agent_version_created', 'phone_number_routed')) AS setup_actions,
      any(person.properties.email) AS email,
      min(timestamp) AS first_seen,
      max(timestamp) AS last_seen,
      minIf(timestamp, event = '$pageview') AS first_pv,
      maxIf(timestamp, event = '$pageview') AS last_pv
    FROM events
    WHERE timestamp >= now() - INTERVAL ${n} DAY AND event IN (${events})
    GROUP BY ip
    ORDER BY last_seen DESC
    LIMIT 800`);

  const cfg = {
    internalIps: parseList(process.env.ANALYTICS_INTERNAL_IPS),
    botIps: parseList(process.env.ANALYTICS_BOT_IPS),
    adminEmails: adminEmails(),
  };
  return results.map((r): ClassifiedVisitor => {
    const row: VisitorRow = {
      ip: String(r[0] ?? ''),
      country: str(r[1]), city: str(r[2]), os: str(r[3]), device: str(r[4]), browser: str(r[5]),
      userAgent: str(r[6]), referrer: str(r[7]),
      pageviews: Number(r[8]) || 0,
      paths: Array.isArray(r[9]) ? (r[9] as unknown[]).map(String) : [],
      heroStarted: Number(r[10]) || 0, demoCalls: Number(r[11]) || 0, setupActions: Number(r[12]) || 0,
      email: str(r[13]),
      firstSeen: String(r[14]), lastSeen: String(r[15]),
      firstPageview: str(r[16]), lastPageview: str(r[17]),
    };
    return classifyVisitor(row, cfg);
  });
}
