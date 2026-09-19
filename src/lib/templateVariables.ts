// {{placeholder}} helpers shared by template install, the Retell converter and
// the templates listing. Dependency-free on purpose.

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/gi;

/** Replaces {{name}} with variables[name] for non-empty configured values only; unknown placeholders stay as-is. */
export function substituteVariables(text: string, variables?: Record<string, string>): string {
  if (!variables) return text;
  return text.replace(PLACEHOLDER, (whole, name: string) => {
    const v = variables[name] ?? variables[name.toLowerCase()];
    return typeof v === 'string' && v.trim() !== '' ? v : whole;
  });
}

/** Deep-copies a JSON-like value, substituting placeholders in every string. */
export function substituteDeep<T>(value: T, variables?: Record<string, string>): T {
  if (!variables || !Object.keys(variables).length) return value;
  if (typeof value === 'string') return substituteVariables(value, variables) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => substituteDeep(v, variables)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, substituteDeep(v, variables)])) as T;
  }
  return value;
}

/** Names of all {{placeholders}} found in any string inside the value. */
export function collectPlaceholders(value: unknown, into = new Set<string>()): Set<string> {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER)) into.add(m[1].toLowerCase());
  } else if (Array.isArray(value)) value.forEach((v) => collectPlaceholders(v, into));
  else if (value && typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => collectPlaceholders(v, into));
  return into;
}
