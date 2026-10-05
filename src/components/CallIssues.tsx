'use client';

import { issuesFromAnalysis, type IssueSeverity } from '@/lib/callIssues';

const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  high: 'bg-red-50 text-red-700',
  medium: 'bg-amber-50 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
};

export function IssueSeverityBadge({ severity }: { severity: IssueSeverity }) {
  return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${SEVERITY_STYLE[severity] ?? SEVERITY_STYLE.low}`}>{severity}</span>;
}

/** Small count badge for the calls list; renders nothing when the call has no issues. */
export function IssueCountBadge({ analysis }: { analysis: unknown }) {
  const issues = issuesFromAnalysis(analysis);
  if (issues.length === 0) return null;
  const high = issues.some((i) => i.severity === 'high');
  return (
    <span
      title={issues.map((i) => i.message).join('\n')}
      className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${high ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}
    >
      {issues.length} issue{issues.length === 1 ? '' : 's'}
    </span>
  );
}

/** "Issues found" panel for the call detail page: severity, what happened, the evidence quote and the proposed fix. */
export function IssuesPanel({ analysis }: { analysis: unknown }) {
  const issues = issuesFromAnalysis(analysis);
  if (issues.length === 0) return null;
  return (
    <div className="rounded-xl border border-red-100 bg-white p-5">
      <h2 className="mb-3.5 text-[14px] font-semibold text-[#1a1d29]">Issues found ({issues.length})</h2>
      <div className="space-y-4">
        {issues.map((issue, idx) => (
          <div key={`${issue.code}-${idx}`} className={idx > 0 ? 'border-t border-gray-100 pt-4' : ''}>
            <div className="mb-1 flex items-center gap-2">
              <IssueSeverityBadge severity={issue.severity} />
              <span className="font-mono text-[11.5px] text-gray-400">{issue.code}</span>
            </div>
            <p className="text-[13.5px] text-[#1a1d29]">{issue.message}</p>
            {Array.isArray(issue.evidence) && issue.evidence.length > 0 && (
              <div className="mt-2 space-y-1">
                {issue.evidence.map((quote, i) => (
                  <blockquote key={i} className="border-l-2 border-gray-200 pl-3 text-[12.5px] italic text-gray-600">{quote}</blockquote>
                ))}
              </div>
            )}
            {issue.fix && (
              <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[12.5px] text-blue-900">
                <span className="font-medium">Proposed fix: </span>{issue.fix}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
