-- Transfer Success Rate / Transfer Wait Time (2026-09-18) — Retell's own
-- disconnection_reason distinguishes transfer_bridged (succeeded) from
-- transfer_cancelled (failed), so that's derivable for retell-engine calls
-- with no new capture needed on their side. poc-engine calls need real new
-- tracking: transfer_status here is set from Twilio's own <Dial
-- action=...> callback (DialCallStatus), and transfer_wait_ms is computed
-- from the gap between initiating the transfer and that callback firing,
-- minus the answered portion's own duration.
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS transfer_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS transfer_wait_ms INT;
