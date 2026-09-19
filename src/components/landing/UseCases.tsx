'use client';

import { useState } from 'react';
import { Card, CardBody, CardTitle, PrimaryButton, SecondaryButton } from './primitives';

export interface UseCaseTemplate {
  id: string;
  label: string;
  description: string;
}

export interface UseCaseGroup {
  id: string;
  label: string;
  blurb: string;
  templates: UseCaseTemplate[];
}

/** Tabbed picker over the built-in agent templates, grouped by what the caller is trying to do. */
export function UseCasePicker({ groups }: { groups: UseCaseGroup[] }) {
  const [active, setActive] = useState(groups[0]?.id);
  const group = groups.find((g) => g.id === active) ?? groups[0];
  if (!group) return null;

  return (
    <div className="mt-14 md:mt-16">
      <div role="tablist" aria-label="Use cases" className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const selected = g.id === group.id;
          return (
            <button
              key={g.id}
              role="tab"
              id={`usecase-tab-${g.id}`}
              aria-selected={selected}
              aria-controls={`usecase-panel-${g.id}`}
              onClick={() => setActive(g.id)}
              className={`rounded-full border px-4 py-2 text-[14px] font-medium tracking-[-0.01em] transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                selected
                  ? 'border-[#00122e] bg-[#00122e] text-white'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-[#1a1d29]'
              }`}
            >
              {g.label}
              <span className={`ml-2 tabular-nums ${selected ? 'text-white/60' : 'text-gray-400'}`}>{g.templates.length}</span>
            </button>
          );
        })}
      </div>

      <div id={`usecase-panel-${group.id}`} role="tabpanel" aria-labelledby={`usecase-tab-${group.id}`}>
        <p className="mt-6 max-w-[620px] text-[16px] leading-[1.5] text-gray-500">{group.blurb}</p>
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {group.templates.map((t) => (
            <Card key={t.id} className="h-full">
              <CardTitle>{t.label}</CardTitle>
              <CardBody>{t.description}</CardBody>
            </Card>
          ))}
        </div>
      </div>

      <div className="mt-10 flex flex-wrap gap-3">
        <PrimaryButton href="/auth/login">Start from a template</PrimaryButton>
        <SecondaryButton href="/demo">Hear a demo first</SecondaryButton>
      </div>
    </div>
  );
}
