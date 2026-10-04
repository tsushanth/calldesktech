import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { syncVoicePriceForTenant, ensureTierItemForTenant, ensureExpertBackupItemForTenant } from '@/lib/stripe';
import { tierBillingConfigured } from '@/lib/tierBilling';
import type { FlowNode, TtsBackend } from '@/types';
import { authorizeResource } from '@/lib/authz';
import { normalizeLanguage, LANGUAGE_VALUES, AGENT_LANGUAGES } from '@/lib/languages';
import { tierVoiceIsEnglishOnly } from '@/lib/pricingTiers';
import { validateModelChoice } from '@/lib/modelCatalog';
import { resolveTierForPublish } from '@/lib/pricingTiers';
import { TIER_OVERRIDE_FIELDS } from '@/lib/versionCarryOver';
import { resolveExpertBackupForPublish, expertBackupBillingConfigured } from '@/lib/expertBackup';

// For every 'subflow_ref' node, snapshot the referenced subflow's current
// nodes straight into that node's own params — server.js executes purely
// off this embedded snapshot at call time, never a live subflow lookup, so
// editing or deleting a subflow later can't break an already-published
// version. Node ids are prefixed per subflow_ref instance
// (__sf_{subflowRefNodeId}__{originalId}) so two different subflow_ref
// nodes — or a subflow node id that happens to collide with a parent-flow
// node id — never collide inside the one published flow's combined id
// space; edge targets are rewritten to match.
async function embedSubflowSnapshots(
  nodes: FlowNode[],
  tenantId: string
): Promise<{ nodes: FlowNode[]; error?: string }> {
  const refNodes = nodes.filter((n) => n.type === 'subflow_ref' && n.params?.subflowId);
  if (refNodes.length === 0) return { nodes };

  const supabase = getSupabaseAdmin();
  const subflowIds = [...new Set(refNodes.map((n) => n.params!.subflowId))];
  const { data: subflows, error } = await supabase
    .from('calldesk_subflows')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('id', subflowIds);
  if (error) return { nodes, error: error.message };

  const byId = new Map((subflows || []).map((s) => [s.id, s]));
  const result = nodes.map((node) => {
    if (node.type !== 'subflow_ref' || !node.params?.subflowId) return node;
    const subflow = byId.get(node.params.subflowId);
    if (!subflow || !Array.isArray(subflow.nodes) || subflow.nodes.length === 0 || !subflow.start_node_id) {
      return node;
    }
    const prefix = `__sf_${node.id}__`;
    const rewriteId = (id: string) => `${prefix}${id}`;
    const embeddedNodes = (subflow.nodes as FlowNode[]).map((n: FlowNode) => ({
      ...n,
      id: rewriteId(n.id),
      edges: n.edges.map((e) => ({ ...e, target: rewriteId(e.target) })),
    }));
    return {
      ...node,
      params: {
        ...node.params,
        subflowNodes: JSON.stringify(embeddedNodes),
        subflowStartNodeId: rewriteId(subflow.start_node_id),
      },
    };
  });
  return { nodes: result };
}

// GET /api/agents/[id]/versions — list an agent's versions, newest first
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('calldesk_agent_versions')
    .select('*')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ versions: data });
}

// POST /api/agents/[id]/versions — create a new, immutable version.
// Always creates a fresh calldesk_conversation_flows row (a version pins to
// one flow snapshot) plus the version row referencing it, auto-incrementing
// version_number. Mirrors the flow MCP server's create_agent_version tool —
// this is the UI path to the same operation, not a separate one.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const __auth = await authorizeResource(request, 'calldesk_agents', (await params).id);
  if (!__auth.ok) return __auth.response;

  const { id: agentId } = await params;
  const supabase = getSupabaseAdmin();
  const body = await request.json();
  // Canvas-only 'note' nodes (and any edges pointing at them) must never
  // reach the engine — strip server-side too, not just in the builder.
  if (Array.isArray(body.nodes)) {
    const noteIds = new Set((body.nodes as FlowNode[]).filter((n) => n?.type === 'note').map((n) => n.id));
    if (noteIds.size) {
      body.nodes = (body.nodes as FlowNode[])
        .filter((n) => n.type !== 'note')
        .map((n) => ({ ...n, edges: (n.edges || []).filter((e) => !noteIds.has(e.target)) }));
    }
  }
  const {
    flowName,
    startNodeId,
    nodes,
    globalSettings,
    voiceEngine,
    retellAgentId,
    retellLlmId,
    voiceId,
    ttsBackend: requestedTtsBackend,
    llmModel: requestedLlmModel,
    ttsModel: requestedTtsModel,
    tier: requestedTier,
    tierOverrides: requestedTierOverrides,
    acceptLowerQuality,
    routingMode: requestedRoutingMode,
    acceptExpertBackup,
    wizardConfig,
  } = body as {
    flowName: string;
    startNodeId: string;
    nodes: FlowNode[];
    globalSettings?: Record<string, unknown>;
    voiceEngine: 'retell' | 'poc';
    retellAgentId?: string;
    retellLlmId?: string;
    voiceId?: string;
    ttsBackend?: TtsBackend;
    llmModel?: string;
    ttsModel?: string;
    tier?: unknown;
    tierOverrides?: unknown;
    acceptLowerQuality?: boolean;
    routingMode?: unknown;
    acceptExpertBackup?: unknown;
    wizardConfig?: Record<string, unknown>;
  };

  if (!flowName || !startNodeId || !Array.isArray(nodes) || nodes.length === 0) {
    return NextResponse.json(
      { error: 'flowName, startNodeId, and at least one node are required' },
      { status: 400 }
    );
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!nodeIds.has(startNodeId)) {
    return NextResponse.json({ error: `startNodeId "${startNodeId}" is not one of the provided nodes' ids` }, { status: 400 });
  }
  for (const node of nodes) {
    for (const edge of node.edges) {
      if (!nodeIds.has(edge.target)) {
        return NextResponse.json(
          { error: `node "${node.id}" has an edge targeting unknown node "${edge.target}"` },
          { status: 400 }
        );
      }
    }
  }

  // Optional pricing tier (src/lib/pricingTiers.ts): validated here (an unknown tier, or Lite while it is coming soon, is a 400) and
  // turned into the models the engine should use. Anything the caller set explicitly wins and is recorded in tier_overrides.
  // With no tier this is a pass-through, so the request behaves exactly as it did before tiers existed.
  const tierResult = resolveTierForPublish({ tier: requestedTier, voiceEngine, llmModel: requestedLlmModel, ttsModel: requestedTtsModel, ttsBackend: requestedTtsBackend, acceptLowerQuality });
  if (!tierResult.ok) return NextResponse.json({ error: tierResult.error }, { status: 400 });
  const { llmModel, ttsModel, ttsBackend, tier } = tierResult;
  // A version rebuilt from an older one (restore, Copilot accept) passes the original's tier_overrides, which replace the ones derived
  // above: the tier's stack may have changed since, and comparing the old models to the new stack would mislabel them as overrides.
  const tierOverrides: string[] = tier && Array.isArray(requestedTierOverrides)
    ? requestedTierOverrides.filter((f): f is string => typeof f === 'string' && (TIER_OVERRIDE_FIELDS as readonly string[]).includes(f))
    : tierResult.overrides;

  // A tiered agent must never run unbilled: if this tier's Stripe price is not configured, refuse before anything is written.
  if (tier && !tierBillingConfigured(tier)) {
    return NextResponse.json(
      { error: `Billing for the ${tier} tier is not yet available, so a version cannot be published on it. Publish without a tier, or try again later.`, code: 'tier_billing_not_configured' },
      { status: 503 }
    );
  }

  // Optional routing mode (src/lib/expertBackup.ts): 'expert_backup' needs the poc engine, a Lite or Standard tier and explicit acceptance of its
  // per-minute price. Absent or null is standard routing and touches nothing.
  const routing = resolveExpertBackupForPublish({ routingMode: requestedRoutingMode, acceptExpertBackup, voiceEngine, tier });
  if (!routing.ok) return NextResponse.json({ error: routing.error, code: routing.code, ...(routing.terms ? { terms: routing.terms } : {}) }, { status: routing.status });
  const routingMode = routing.routingMode;
  // Expert backup must never run unbilled: refuse before anything is written when its Stripe price is not configured.
  if (routingMode && !expertBackupBillingConfigured()) {
    return NextResponse.json(
      { error: 'Expert backup is not available yet, so a version cannot be published with it. Publish without it, or try again later.', code: 'expert_backup_not_configured' },
      { status: 503 }
    );
  }

  // Language (globalSettings.language): validate, and pin the voice backend a non-English language
  // needs (the default voice is English-only) so the stored tts_backend, and the billing price synced
  // from it below, match what the engine will really use. An explicit ttsBackend other than kokoro wins.
  let effectiveTtsBackend = ttsBackend;
  if (globalSettings && 'language' in globalSettings) {
    const lang = normalizeLanguage(globalSettings.language);
    if (!lang) {
      return NextResponse.json({ error: `Unsupported language "${String(globalSettings.language)}". Supported: ${LANGUAGE_VALUES.join(', ')}` }, { status: 400 });
    }
    if (lang === 'en') delete globalSettings.language;
    else {
      globalSettings.language = lang;
      // An English-only voice (Lite's Piper voice, or Piper chosen directly) cannot speak another language: the agent would listen in that
      // language and answer in an English voice. A multilingual voice costs more per minute than Lite sells for, so Lite does not switch
      // voices silently; the caller is told to pick Standard or Pro instead.
      if (voiceEngine === 'poc' && ((tier && tierVoiceIsEnglishOnly(tier)) || effectiveTtsBackend === 'piper')) {
        const label = AGENT_LANGUAGES.find((a) => a.code === lang)?.label ?? lang;
        return NextResponse.json(
          { error: `${label} needs a multilingual voice. ${tier && tierVoiceIsEnglishOnly(tier) ? 'Lite uses an English-only voice, so choose Standard or Pro for this language.' : 'The Piper voice is English only, so choose another voice backend for this language.'}`, code: 'language_needs_multilingual_voice' },
          { status: 400 }
        );
      }
      if (voiceEngine === 'poc' && (!effectiveTtsBackend || effectiveTtsBackend === 'kokoro')) effectiveTtsBackend = 'elevenlabs';
    }
  }

  // Optional model choice (src/lib/modelCatalog.ts): the language model, and the voice model within the (possibly language-pinned) backend.
  const modelError = validateModelChoice({ voiceEngine, llmModel, ttsModel, ttsBackend: effectiveTtsBackend });
  if (modelError) return NextResponse.json({ error: modelError }, { status: 400 });

  const { data: agent, error: agentError } = await supabase
    .from('calldesk_agents')
    .select('tenant_id')
    .eq('id', agentId)
    .single();
  if (agentError || !agent) {
    return NextResponse.json({ error: agentError?.message || 'Agent not found' }, { status: 404 });
  }

  // Tiered publish: make sure the subscription has a line for the tier's price BEFORE saving anything. The add is idempotent and a metered
  // line with no usage costs nothing, so this order makes a failure cleanly retryable: no version exists until the line does, and
  // publishing again simply repeats the call. (Tenants with no subscription yet are skipped, as the voice sync skips them.)
  if (tier) {
    try {
      await ensureTierItemForTenant(agent.tenant_id, tier);
    } catch (err) {
      console.error('Failed to ensure tier subscription item', { tenantId: agent.tenant_id, tier }, err);
      return NextResponse.json(
        { error: `Could not set up billing for the ${tier} tier, so nothing was saved. No charge was made; publishing again is safe.`, code: 'tier_billing_failed', retryable: true },
        { status: 502 }
      );
    }
  }

  // Expert backup: the same rule, its own metered line (added once per subscription, never removed on publish: see ensureExpertBackupItemForTenant).
  if (routingMode) {
    try {
      await ensureExpertBackupItemForTenant(agent.tenant_id);
    } catch (err) {
      console.error('Failed to ensure expert backup subscription item', { tenantId: agent.tenant_id }, err);
      return NextResponse.json(
        { error: 'Could not set up billing for expert backup, so nothing was saved. No charge was made; publishing again is safe.', code: 'expert_backup_billing_failed', retryable: true },
        { status: 502 }
      );
    }
  }

  const { nodes: embeddedNodes, error: embedError } = await embedSubflowSnapshots(nodes, agent.tenant_id);
  if (embedError) return NextResponse.json({ error: embedError }, { status: 500 });

  const { data: flow, error: flowError } = await supabase
    .from('calldesk_conversation_flows')
    .insert({
      tenant_id: agent.tenant_id,
      agent_id: agentId,
      name: flowName,
      nodes: embeddedNodes,
      global_settings: { allowInterruptions: true, returnToFlow: true, startNodeId, ...globalSettings },
      is_active: false,
    })
    .select()
    .single();
  if (flowError) return NextResponse.json({ error: flowError.message }, { status: 500 });

  const { data: latest } = await supabase
    .from('calldesk_agent_versions')
    .select('version_number')
    .eq('agent_id', agentId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle();
  const versionNumber = (latest?.version_number || 0) + 1;

  const { data: version, error: versionError } = await supabase
    .from('calldesk_agent_versions')
    .insert({
      agent_id: agentId,
      version_number: versionNumber,
      voice_engine: voiceEngine || 'retell',
      flow_id: flow.id,
      retell_agent_id: retellAgentId || null,
      retell_llm_id: retellLlmId || null,
      voice_id: voiceId || (tier ? tierResult.voiceId : undefined) || null,
      tts_backend: effectiveTtsBackend || null,
      llm_model: llmModel || null,
      tts_model: ttsModel || null,
      // Only sent when a tier was chosen, so publishing without one never touches the (migration 064) tier columns and keeps working
      // on a database where that migration has not been applied yet.
      ...(tier ? { tier, tier_overrides: tierOverrides.length ? tierOverrides : null } : {}),
      // Same for the (migration 071) routing_mode column: only written when expert backup is on.
      ...(routingMode ? { routing_mode: routingMode } : {}),
      wizard_config: wizardConfig || null,
    })
    .select()
    .single();
  if (versionError) {
    // Migration 071 not applied yet: only a publish with expert backup touches the column, so say so plainly instead of a raw database error.
    if (routingMode && (versionError.code === '42703' || /routing_mode/.test(versionError.message || ''))) {
      return NextResponse.json({ error: 'Expert backup is not available yet, so this version was not saved.', code: 'expert_backup_not_configured' }, { status: 503 });
    }
    return NextResponse.json({ error: versionError.message }, { status: 500 });
  }

  // A version published with a tier does not touch the subscription's voice price: the tier's voice backend is an engine detail, and
  // syncing it would bill the legacy voice rate for it. Billing by tier is separate work (docs/pricing-tier-migration-notes.md).
  if (voiceEngine === 'poc' && effectiveTtsBackend && !tier) {
    // Best-effort — a Stripe hiccup here shouldn't fail creating the agent
    // version itself, just leave the subscription's voice price as-is.
    await syncVoicePriceForTenant(agent.tenant_id, effectiveTtsBackend).catch((err) =>
      console.error('Failed to sync voice price for tenant', agent.tenant_id, err)
    );
  }

  return NextResponse.json({ version, flow }, { status: 201 });
}
