import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_TOOL_GROUPS } from '@/lib/mcp/toolDocs';
import { TIER_IDS } from '@/lib/pricingTiers';

// The docs page lists the MCP tools from toolDocs.ts; this keeps that list identical to what tools.ts actually registers.
const registered = [...readFileSync(join(process.cwd(), 'src/lib/mcp/tools.ts'), 'utf8').matchAll(/registerTool\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
const documented = MCP_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name));

describe('MCP tool docs', () => {
  it('finds the registered tools', () => { expect(registered.length).toBeGreaterThan(30); });
  it('documents every registered tool', () => { expect(registered.filter((n) => !documented.includes(n))).toEqual([]); });
  it('documents no tool that is not registered', () => { expect(documented.filter((n) => !registered.includes(n))).toEqual([]); });
  it('has no duplicates and a real summary for each', () => {
    expect(new Set(documented).size).toBe(documented.length);
    for (const g of MCP_TOOL_GROUPS) for (const t of g.tools) expect(t.summary.length).toBeGreaterThan(10);
  });
  it('the model tools are documented', () => { expect(documented).toContain('list_model_options'); expect(documented).toContain('publish_agent_version'); });
  it('the pricing tier tool is registered and documented, and publish_agent_version takes a tier', () => {
    expect(registered).toContain('list_pricing_tiers');
    expect(documented).toContain('list_pricing_tiers');
    const src = readFileSync(join(process.cwd(), 'src/lib/mcp/tools.ts'), 'utf8');
    const publish = src.slice(src.indexOf("registerTool('publish_agent_version'"), src.indexOf("registerTool('list_pricing_tiers'"));
    expect(publish).toMatch(/tier: z\.enum\(\['lite', 'standard', 'pro'\]\)/);
    expect(MCP_TOOL_GROUPS.flatMap((g) => g.tools).find((t) => t.name === 'publish_agent_version')!.summary).toMatch(/tier/);
  });
  it('the tier ids the MCP tool accepts are exactly the tier ids in pricingTiers.ts', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/mcp/tools.ts'), 'utf8');
    const m = src.match(/tier: z\.enum\(\[([^\]]+)\]\)/)!;
    expect(m[1].split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...TIER_IDS]);
  });
  it('the docs page covers pricing tiers and the advanced model section', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/docs/page.tsx'), 'utf8');
    expect(page).toContain('id="pricing-tiers"');
    expect(page).toContain('Advanced: choose models yourself');
  });
});
