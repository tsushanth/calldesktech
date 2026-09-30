-- Per-tenant jingle + sound-effect assets for live calls handled by call-loop-poc.
-- See realtime-tts docs/superpowers/specs/2026-09-29-call-audio-jingle-sfx-design.md.
--
-- Assets are generated ONCE at configuration time (ReadAloudAI sound-effects/music API), converted
-- to mu-law@8kHz mono, and stored in the private `call-audio-assets` bucket at
-- `<tenant_id>/<asset_id>.raw`. call-loop-poc loads a tenant's enabled rows at call start
-- (tenantLookup.js fetchCallAudioAssets) — nothing is ever generated during a live call.
--
-- No versioning: the dashboard creates a fresh row and disables the old one rather than
-- overwriting a storage object, so a row id's audio is immutable (call-loop-poc caches by id).

CREATE TABLE IF NOT EXISTS tenant_call_audio_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES calldesk_tenants(id) ON DELETE CASCADE,
  asset_type text NOT NULL CHECK (asset_type IN ('jingle', 'sound_effect')),
  -- Short slug; also the play_sound_effect tool's enum value, so no spaces.
  name text NOT NULL CHECK (name ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- Surfaced to the LLM as the description of this effect in the tool's parameter, so it can
  -- decide when to use it. Unused for jingles (they play on connect).
  description text NOT NULL DEFAULT '',
  mulaw8k_storage_path text NOT NULL,
  source_readaloud_job_id text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The runtime's only query: a tenant's enabled assets, oldest first.
CREATE INDEX IF NOT EXISTS tenant_call_audio_assets_tenant_enabled_idx
  ON tenant_call_audio_assets (tenant_id, created_at)
  WHERE enabled;

-- An effect's name must be unique among a tenant's enabled effects (it's the tool enum value —
-- two enabled rows with one name would make the tool ambiguous). A disabled row can share a name
-- with its replacement. "At most one enabled jingle" is enforced at the application layer per the
-- spec, not here.
CREATE UNIQUE INDEX IF NOT EXISTS tenant_call_audio_assets_enabled_effect_name_uniq
  ON tenant_call_audio_assets (tenant_id, name)
  WHERE enabled AND asset_type = 'sound_effect';

-- Service-role only (dashboard API routes + call-loop-poc), same shape as 058 — no end-user
-- query path, so RLS on with no policies.
ALTER TABLE tenant_call_audio_assets ENABLE ROW LEVEL SECURITY;

-- Private bucket; only the service role reads/writes it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('call-audio-assets', 'call-audio-assets', false)
ON CONFLICT (id) DO NOTHING;
