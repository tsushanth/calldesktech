import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { authorizeTenant } from '@/lib/authz';

// Uploads the LOA/utility-bill document a real Twilio PortIn submission
// requires (see migration 055_phone_number_ports.sql and
// .../port/route.ts). Two steps, both real, neither swallowed on failure:
//   1. Store the raw file in Supabase Storage (private bucket
//      'porting-documents') — our own durable copy, independent of Twilio.
//   2. Upload it to Twilio's Documents API to get back a document sid, which
//      is what Twilio's PortIn create call actually needs.
// A row in phone_number_port_documents tracks both steps so the port submit
// route can verify a client-supplied documentSid really belongs to this
// tenant (see belongsToTenant() pattern in src/lib/authz.ts) instead of
// trusting an opaque string from the client.
//
// Twilio endpoint/fields: verified live via Twilio's own docs
// (https://www.twilio.com/docs/phone-numbers/document-apis) at the time this
// was written —
//   POST https://numbers-upload.twilio.com/v1/Documents
//   multipart/form-data: document_type=utility_bill, File=<binary>,
//   friendly_name=<optional>
// Note this is a DIFFERENT host (numbers-upload.twilio.com) than both
// api.twilio.com (used by src/lib/smsProvider.ts) and numbers.twilio.com
// (used by .../port/route.ts for PortIn) — Twilio splits its number-related
// REST surface across several hosts. Confidence: high on the endpoint/host
// and multipart field names (confirmed via a live docs fetch just before
// writing this file, not from training-data recall alone); if Twilio has
// since renamed a field, the fetch below will surface Twilio's real 4xx
// message rather than silently failing, same principle as the rest of this
// port flow.
const TWILIO_DOCUMENTS_API = 'https://numbers-upload.twilio.com/v1/Documents';
const BUCKET = 'porting-documents';
const MAX_FILE_BYTES = 10 * 1024 * 1024; // Twilio's own stated limit for this endpoint

function twilioAuthHeader(): string | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!accountSid || !authToken) return null;
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`;
}

// Creates the private bucket on first use if it doesn't exist yet — mirrors
// ensureBucket() in scripts/generate-vertical-sample.mjs (that script's
// 'outreach-samples' bucket), the only other place in this repo that
// provisions a Storage bucket. Never creates it public.
async function ensureBucket(): Promise<string | null> {
  const supabase = getSupabaseAdmin();
  const { data: existing, error: getErr } = await supabase.storage.getBucket(BUCKET);
  if (existing) {
    if (existing.public) return `Storage bucket '${BUCKET}' exists but is PUBLIC; it must be private. Fix it in the Supabase dashboard.`;
    return null;
  }
  if (getErr && !/not found/i.test(getErr.message)) return getErr.message;
  const { error: createErr } = await supabase.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_FILE_BYTES });
  if (createErr) return createErr.message;
  return null;
}

// POST /api/tenants/[id]/phone-numbers/port/documents — upload one LOA
// document (multipart/form-data, field 'file'; optional 'documentType',
// 'friendlyName'). Matches the multipart convention this repo already uses
// for file uploads (src/app/api/knowledge-bases/[id]/documents/route.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data with a "file" field' }, { status: 400 });
  }
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const documentType = (formData.get('documentType') as string) || 'utility_bill';
  const friendlyName = (formData.get('friendlyName') as string) || undefined;

  if (!file) return NextResponse.json({ error: 'file is required' }, { status: 400 });
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: `File exceeds the ${MAX_FILE_BYTES / 1024 / 1024}MB limit Twilio's Documents API enforces` }, { status: 400 });
  }

  const bucketErr = await ensureBucket();
  if (bucketErr) return NextResponse.json({ error: `Storage bucket setup failed: ${bucketErr}` }, { status: 500 });

  const supabase = getSupabaseAdmin();
  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${tenantId}/${randomUUID()}-${file.name}`;

  // Row inserted up front (before either external write) so a partial
  // failure is always visible locally — same pattern as phone_number_ports'
  // draft row in .../port/route.ts.
  const { data: docRow, error: insertError } = await supabase
    .from('phone_number_port_documents')
    .insert({
      tenant_id: tenantId,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      file_name: file.name,
      mime_type: file.type || null,
      document_type: documentType,
      friendly_name: friendlyName ?? null,
      status: 'pending_storage',
    })
    .select()
    .single();
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, fileBuffer, { contentType: file.type || 'application/octet-stream' });
  if (uploadError) {
    await supabase
      .from('phone_number_port_documents')
      .update({ status: 'twilio_upload_failed', last_error: `Supabase Storage upload failed: ${uploadError.message}` })
      .eq('id', docRow.id);
    return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
  }
  await supabase.from('phone_number_port_documents').update({ status: 'stored' }).eq('id', docRow.id);

  const authHeader = twilioAuthHeader();
  if (!authHeader) {
    await supabase
      .from('phone_number_port_documents')
      .update({ status: 'twilio_upload_failed', last_error: 'Twilio credentials not configured' })
      .eq('id', docRow.id);
    return NextResponse.json({ error: 'Twilio credentials not configured', document: { ...docRow, status: 'twilio_upload_failed' } }, { status: 500 });
  }

  try {
    const twilioForm = new FormData();
    twilioForm.set('document_type', documentType);
    if (friendlyName) twilioForm.set('friendly_name', friendlyName);
    twilioForm.set('File', new Blob([new Uint8Array(fileBuffer)], { type: file.type || 'application/octet-stream' }), file.name);

    const res = await fetch(TWILIO_DOCUMENTS_API, {
      method: 'POST',
      headers: { Authorization: authHeader },
      body: twilioForm,
    });
    const responseBody = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = (responseBody as { message?: string }).message || `Twilio document upload failed: ${res.status}`;
      await supabase
        .from('phone_number_port_documents')
        .update({ status: 'twilio_upload_failed', last_error: msg, last_twilio_response: responseBody })
        .eq('id', docRow.id);
      return NextResponse.json({ error: msg, document: { ...docRow, status: 'twilio_upload_failed', last_error: msg } }, { status: 502 });
    }

    const data = responseBody as { sid?: string; mime_type?: string };
    const { data: updated, error: updateError } = await supabase
      .from('phone_number_port_documents')
      .update({
        twilio_document_sid: data.sid ?? null,
        status: 'uploaded',
        last_twilio_response: responseBody,
        last_error: null,
      })
      .eq('id', docRow.id)
      .select()
      .single();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ document: updated, documentSid: data.sid ?? null }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Twilio document upload failed';
    await supabase
      .from('phone_number_port_documents')
      .update({ status: 'twilio_upload_failed', last_error: msg })
      .eq('id', docRow.id);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

// GET /api/tenants/[id]/phone-numbers/port/documents — list this tenant's
// uploaded port documents, so the dashboard can show prior uploads/status.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeTenant(request, (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: tenantId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('phone_number_port_documents')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ documents: data });
}
