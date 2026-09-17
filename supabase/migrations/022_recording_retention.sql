-- recording_sid is needed to actually DELETE a Twilio recording once its
-- retention window passes (see call-loop-poc's enforceRecordingRetention) —
-- recording_url alone isn't enough to target Twilio's DELETE
-- /Recordings/{Sid}.json endpoint without string-parsing the URL.
ALTER TABLE calldesk_call_logs
  ADD COLUMN IF NOT EXISTS recording_sid VARCHAR(64);
