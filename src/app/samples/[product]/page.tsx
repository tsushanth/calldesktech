import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getSupabaseAdmin } from '@/lib/supabase';
import { getPublishedSample, productFromSlug, verifySampleToken, type TranscriptLine } from '@/lib/outreach/samples';
import { recordSampleEvent } from '@/lib/outreach/sampleEvents';
import { supabaseEventDeps } from '@/lib/outreach/sampleEventsDb';
import SamplePlayer from './SamplePlayer';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sample call | Calldesk',
  robots: { index: false, follow: false },
};

const BUCKET = 'outreach-samples';

async function signedAudioUrl(audioPath: string | null): Promise<string | null> {
  if (!audioPath) return null;
  try {
    const { data, error } = await getSupabaseAdmin().storage.from(BUCKET).createSignedUrl(audioPath, 3600);
    return error || !data?.signedUrl ? null : data.signedUrl;
  } catch {
    return null;
  }
}

export default async function SamplePage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }> | { product: string };
  searchParams: Promise<{ t?: string | string[] }> | { t?: string | string[] };
}) {
  const { product: slug } = await params;
  const sp = await searchParams;
  const product = productFromSlug(slug);
  if (!product) notFound();

  let supabase;
  try {
    supabase = getSupabaseAdmin();
  } catch {
    notFound();
  }
  const sample = await getPublishedSample(supabase, product);
  if (!sample) notFound();

  const rawToken = Array.isArray(sp.t) ? sp.t[0] : sp.t;
  let token: string | null = null;
  try {
    token = rawToken && verifySampleToken(rawToken) ? rawToken : null;
  } catch {
    token = null;
  }
  if (token) {
    const ua = (await headers()).get('user-agent');
    await recordSampleEvent(supabaseEventDeps(supabase), { token, event: 'view', userAgent: ua, sampleId: sample.id, product });
  }

  const audioUrl = await signedAudioUrl(sample.audio_path);
  const transcript: TranscriptLine[] = (Array.isArray(sample.transcript) ? sample.transcript : []).filter(
    (l) => l && (l.speaker === 'caller' || l.speaker === 'agent') && typeof l.text === 'string' && l.text.trim() !== '',
  );
  const business = sample.business_name || 'a demo business';
  const disclosure = `This is a recording of an AI test caller talking to a Calldesk demo agent for a fictional ${business}. It is a sample, not a real customer call.`;

  return (
    <main className="min-h-screen bg-[#f7f8fa] text-[#1a1d29]">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <p className="text-[13px] font-semibold uppercase tracking-wider text-gray-400">Calldesk</p>
        <h1 className="mt-1 text-2xl font-semibold leading-tight sm:text-3xl">{sample.title || 'Sample call'}</h1>

        <div role="note" className="mt-5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[14px] leading-relaxed text-amber-900">
          {disclosure}
        </div>

        {audioUrl && (
          <div className="mt-6 rounded-xl border border-gray-200 bg-white p-4">
            <SamplePlayer src={audioUrl} token={token} />
          </div>
        )}

        <h2 className="mt-8 text-[15px] font-semibold">Transcript</h2>
        <ol className="mt-3 space-y-3" aria-label="Call transcript">
          {transcript.map((l, i) => {
            const agent = l.speaker === 'agent';
            return (
              <li key={i} className={`flex ${agent ? 'justify-start' : 'justify-end'}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed ${
                    agent ? 'rounded-bl-sm border border-gray-200 bg-white' : 'rounded-br-sm bg-blue-600 text-white'
                  }`}
                >
                  <p className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wider ${agent ? 'text-gray-400' : 'text-blue-100'}`}>
                    {agent ? 'Calldesk agent' : 'AI test caller'}
                  </p>
                  {l.text}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-10 border-t border-gray-200 pt-6 text-[14px] leading-relaxed text-gray-600">
          Questions, or want to hear it on your own line? Just reply to the email that brought you here, or visit{' '}
          <a href="https://calldesk.tech" className="text-blue-600 underline">calldesk.tech</a>.
        </p>
      </div>
    </main>
  );
}
