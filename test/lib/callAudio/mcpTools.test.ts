import { describe, it, expect, vi } from 'vitest';
import { registerTools } from '@/lib/mcp/tools';

type Handler = (args: Record<string, unknown>) => Promise<{ isError?: boolean; content: Array<{ text: string }> }>;

function setup() {
  const tools = new Map<string, { config: { description: string; annotations?: Record<string, boolean>; inputSchema: Record<string, unknown> }; handler: Handler }>();
  const server = { registerTool: (name: string, config: never, handler: Handler) => tools.set(name, { config, handler }) };
  const api = vi.fn(async () => ({ ok: true }));
  registerTools(server, api, async () => 'tenant-1');
  return { tools, api };
}

describe('sound tools on the hosted MCP server', () => {
  it('registers list_sounds, create_jingle, create_sound_effect, delete_sound (jingle/sound-effect wording, no combined "call audio" noun)', () => {
    const { tools } = setup();
    for (const n of ['list_sounds', 'create_jingle', 'create_sound_effect', 'delete_sound']) expect(tools.has(n), n).toBe(true);
    for (const [name, t] of tools) if (name.includes('sound') || name.includes('jingle')) expect(t.config.description).not.toMatch(/call audio/i);
  });

  it('list_sounds GETs the tenant\'s sounds and is read-only', async () => {
    const { tools, api } = setup();
    await tools.get('list_sounds')!.handler({});
    expect(api).toHaveBeenCalledWith('GET', '/tenants/tenant-1/call-audio');
    expect(tools.get('list_sounds')!.config.annotations).toMatchObject({ readOnlyHint: true });
  });

  it('create_jingle POSTs type=jingle with a default name, no description, and a default length', async () => {
    const { tools, api } = setup();
    await tools.get('create_jingle')!.handler({ prompt: 'an upbeat bell jingle' });
    expect(api).toHaveBeenCalledWith('POST', '/tenants/tenant-1/call-audio', { type: 'jingle', name: 'intro', description: '', prompt: 'an upbeat bell jingle', durationSec: 4 });
  });

  it('create_sound_effect POSTs type=sound_effect with its name, the when-to-play description, and a default length', async () => {
    const { tools, api } = setup();
    await tools.get('create_sound_effect')!.handler({ name: 'booking_chime', description: 'After a booking is confirmed', prompt: 'a soft chime' });
    expect(api).toHaveBeenCalledWith('POST', '/tenants/tenant-1/call-audio', { type: 'sound_effect', name: 'booking_chime', description: 'After a booking is confirmed', prompt: 'a soft chime', durationSec: 2 });
  });

  it('an explicit length is passed through', async () => {
    const { tools, api } = setup();
    await tools.get('create_jingle')!.handler({ prompt: 'p', durationSec: 7 });
    expect(api).toHaveBeenCalledWith('POST', expect.any(String), expect.objectContaining({ durationSec: 7 }));
  });

  it('delete_sound DELETEs by id and is marked destructive', async () => {
    const { tools, api } = setup();
    await tools.get('delete_sound')!.handler({ soundId: 'abc' });
    expect(api).toHaveBeenCalledWith('DELETE', '/tenants/tenant-1/call-audio/abc');
    expect(tools.get('delete_sound')!.config.annotations).toMatchObject({ destructiveHint: true });
  });

  it('the creating tools are flagged as spending money, and their descriptions say so and explain the Retell exclusion', () => {
    const { tools } = setup();
    for (const n of ['create_jingle', 'create_sound_effect']) {
      const c = tools.get(n)!.config;
      expect(c.annotations).toMatchObject({ readOnlyHint: false, openWorldHint: true });
      expect(c.description).toMatch(/credits|costs|spends/i);
      expect(c.description).toMatch(/retell/i);
    }
  });

  it('a failing API call comes back as an MCP error, not a thrown exception', async () => {
    const { tools, api } = setup();
    api.mockRejectedValueOnce(new Error('A tenant can have at most 10 enabled sound effects'));
    const res = await tools.get('create_sound_effect')!.handler({ name: 'x', description: 'd', prompt: 'p' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/at most 10/);
  });
});
