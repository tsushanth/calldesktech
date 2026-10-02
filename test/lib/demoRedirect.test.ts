import { describe, it, expect, vi } from 'vitest';

const redirect = vi.fn((to: string): never => { throw new Error(`NEXT_REDIRECT:${to}`); });
vi.mock('next/navigation', () => ({ redirect }));

describe('unknown /demo pages', () => {
  it('send the visitor to the demo index', async () => {
    const { default: Page } = await import('@/app/demo/[...slug]/page');
    expect(() => Page()).toThrow('NEXT_REDIRECT:/demo');
    expect(redirect).toHaveBeenCalledWith('/demo');
  });
});
