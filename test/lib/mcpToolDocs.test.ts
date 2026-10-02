import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MCP_TOOL_GROUPS } from '@/lib/mcp/toolDocs';

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
});
