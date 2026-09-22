import { describe, it, expect } from 'vitest';
import { BUILT_IN_FIELDS, parseAnalysisFields, type AnalysisField } from '@/lib/postCallAnalysis';

// Note: buildSchema() and degradedBuiltIn() are not exported from
// postCallAnalysis.ts, and this task's hard constraint forbids modifying
// application code (including adding an `export`) to make them directly
// testable. buildSchema's behavior is exercised only indirectly — through
// extractCallAnalysis, which itself is explicitly out of scope here because
// it makes a live Claude API call. So buildSchema and degradedBuiltIn are
// covered only to the extent parseAnalysisFields/BUILT_IN_FIELDS reach them;
// this is a known, deliberate gap — see the final report.

describe('BUILT_IN_FIELDS', () => {
  it('has exactly the 4 expected built-in fields with correct types', () => {
    expect(BUILT_IN_FIELDS.map((f) => f.name).sort()).toEqual(
      ['call_successful', 'call_summary', 'in_voicemail', 'user_sentiment'].sort()
    );
    const byName = Object.fromEntries(BUILT_IN_FIELDS.map((f) => [f.name, f]));
    expect(byName.call_summary.type).toBe('text');
    expect(byName.call_successful.type).toBe('boolean');
    expect(byName.in_voicemail.type).toBe('boolean');
    expect(byName.user_sentiment.type).toBe('enum');
    expect(byName.user_sentiment.options).toEqual(['positive', 'neutral', 'negative']);
  });
});

describe('parseAnalysisFields', () => {
  it('returns [] for non-array / missing input', () => {
    expect(parseAnalysisFields(undefined)).toEqual([]);
    expect(parseAnalysisFields(null)).toEqual([]);
    expect(parseAnalysisFields({})).toEqual([]);
    expect(parseAnalysisFields({ fields: 'not-an-array' })).toEqual([]);
  });

  it('rejects malformed fields: missing/blank name, bad type, enum with no options', () => {
    const raw = {
      fields: [
        { name: '', type: 'text' },
        { name: '   ', type: 'text' },
        { type: 'text' }, // no name
        { name: 'bad_type', type: 'not-a-type' },
        { name: 'empty_enum', type: 'enum', options: [] },
        { name: 123, type: 'text' }, // non-string name
        null,
        'not-an-object',
      ],
    };
    expect(parseAnalysisFields(raw)).toEqual([]);
  });

  it('rejects a custom field whose name collides with a BUILT_IN_FIELD name', () => {
    const raw = {
      fields: [
        { name: 'call_summary', type: 'text', description: 'shadowing a built-in' },
        { name: 'user_sentiment', type: 'enum', options: ['a', 'b'] },
      ],
    };
    expect(parseAnalysisFields(raw)).toEqual([]);
  });

  it('accepts valid custom fields of every type and trims/normalizes them', () => {
    const raw = {
      fields: [
        { name: '  favorite_color  ', type: 'text', description: 'A color' },
        { name: 'is_qualified', type: 'boolean' },
        { name: 'deal_size', type: 'number', description: 'USD' },
        { name: 'priority', type: 'enum', description: 'How urgent', options: ['low', 'high'] },
      ],
    };
    const parsed = parseAnalysisFields(raw);
    expect(parsed).toHaveLength(4);
    const byName = Object.fromEntries(parsed.map((f) => [f.name, f]));
    expect(byName['favorite_color']).toBeDefined(); // trimmed
    expect(byName['favorite_color'].description).toBe('A color');
    expect(byName['is_qualified'].type).toBe('boolean');
    expect(byName['deal_size'].type).toBe('number');
    expect(byName['priority'].options).toEqual(['low', 'high']);
  });

  it('filters non-string enum options and drops fields left with none', () => {
    const raw = {
      fields: [{ name: 'rating', type: 'enum', options: [1, null, 'good', '', 'bad'] }],
    };
    const parsed = parseAnalysisFields(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].options).toEqual(['good', 'bad']);
  });

  it('defaults description to empty string when not a string', () => {
    const raw: { fields: Partial<AnalysisField>[] } = { fields: [{ name: 'no_desc', type: 'text' }] };
    const parsed = parseAnalysisFields(raw);
    expect(parsed[0].description).toBe('');
  });
});
