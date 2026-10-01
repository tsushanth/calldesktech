// Who may see the investor deck. Pure so it is testable; the /investors page just applies it.
//  - a code is always required (?t=...), 3-64 chars of [A-Za-z0-9_-]
//  - outside production anything with a code renders (local preview)
//  - in production the deck refuses to render while TODO(...) placeholders remain, EXCEPT for the private
//    preview code (INVESTOR_PREVIEW_TOKEN), so the founders can review the real hosted draft before it is final
export function canServeInvestorDeck(opts: { t: string | undefined; nodeEnv: string | undefined; previewToken: string | undefined; todoCount: number }): boolean {
  const { t, nodeEnv, previewToken, todoCount } = opts;
  if (!t || !/^[A-Za-z0-9_-]{3,64}$/.test(t)) return false;
  if (nodeEnv !== 'production') return true;
  if (previewToken && previewToken.length >= 12 && t === previewToken) return true;
  return todoCount === 0;
}
