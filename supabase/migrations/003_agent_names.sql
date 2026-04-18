-- Add optional agent_name column to room_participants.
-- Nullable so existing rows and callers that omit the field are unaffected.
alter table room_participants
  add column agent_name text;
