/** The checks a rewrite must pass before it can stay approved. Exported for the test. */
export function checkPriceLed(subject: string, body: string): string | null {
  const all = `${subject}\n${body}`;
  if (!/2 cents a minute|2 cents per minute|2¢/i.test(body)) return 'no Calldesk per-minute price in the body';
  if (!/\$0\.004/.test(body) || !/\$0\.11/.test(body)) return 'no speech API prices in the body';
  if (!/2 cents|\$0\.004|\$0\.11/i.test(subject)) return 'subject does not carry a price';
  if (/cheapest|cheaper than|better than|best price|lowest price/i.test(all)) return 'comparative price claim';
  if (/elevenlabs|deepgram|cartesia|groq|openai/i.test(all)) return 'names a competitor';
  if (body.split(/\s+/).length > 190) return 'too long';
  if (/[^\x00-\x7F]/.test(all.replace(/[’‘“”]/g, "'"))) return 'non-ASCII characters';
  return null;
}
