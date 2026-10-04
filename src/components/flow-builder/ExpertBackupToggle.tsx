'use client';

import { EXPERT_BACKUP, expertBackupAllowedOnTier, expertBackupTerms, expertBackupToggleLabel } from '@/lib/expertBackup';

// The Expert backup extra (src/lib/expertBackup.ts) under the tier picker. Shown only where it can be sold: the in-house voice engine and a
// Lite or Standard tier. Every figure and sentence is derived from the constants, never typed here. Switching it on needs an explicit
// acceptance of the price (the API enforces the same with acceptExpertBackup).
export function expertBackupEligible(voiceEngine: string, tier: string): boolean {
  return voiceEngine === 'poc' && expertBackupAllowedOnTier(tier);
}

export default function ExpertBackupToggle({
  voiceEngine,
  tier,
  enabled,
  accepted,
  onEnabledChange,
  onAcceptedChange,
}: {
  voiceEngine: string;
  tier: string;
  enabled: boolean;
  accepted: boolean;
  onEnabledChange: (next: boolean) => void;
  onAcceptedChange: (next: boolean) => void;
}) {
  if (!expertBackupEligible(voiceEngine, tier)) return null;
  return (
    <div className="space-y-2 rounded-xl border border-gray-200 bg-white p-3" data-testid="expert-backup">
      <label className="flex items-start gap-2 text-[13px] font-medium text-[#1a1d29]">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => { onEnabledChange(e.target.checked); if (!e.target.checked) onAcceptedChange(false); }}
          className="mt-0.5"
          data-testid="expert-backup-toggle"
        />
        <span>{expertBackupToggleLabel()}</span>
      </label>
      <p className="text-[11.5px] leading-[1.45] text-gray-500">{EXPERT_BACKUP.description}</p>
      {enabled && (
        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[12px] leading-[1.45] text-amber-900" data-testid="expert-backup-accept">
          <input type="checkbox" checked={accepted} onChange={(e) => onAcceptedChange(e.target.checked)} className="mt-0.5" />
          <span>{expertBackupTerms()} I accept this extra charge.</span>
        </label>
      )}
    </div>
  );
}
