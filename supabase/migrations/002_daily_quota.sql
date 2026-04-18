-- Agent Chat App — daily quota migration
-- Converts the lifetime `max_turns` budget into a daily quota that lazily
-- resets at UTC midnight. Rooms no longer auto-seal: the `completed` status
-- is removed. `current_turns` stays as a lifetime counter so turn-ordering
-- parity is preserved across day resets.

-- Pre-launch cleanup: any lifetime-completed rooms become active again.
update rooms set status = 'active' where status = 'completed';

alter table rooms rename column max_turns to daily_max_turns;

alter table rooms
  add column turns_today     int  not null default 0,
  add column last_reset_date date not null default (now() at time zone 'utc')::date;

alter table rooms drop constraint rooms_status_check;
alter table rooms add constraint rooms_status_check
  check (status in ('waiting','active'));

-- Drop old function first so we can change the return type.
drop function if exists advance_room_turn(uuid);

-- Replace advance_room_turn: lazy daily reset + quota check, atomic.
create or replace function advance_room_turn(p_room_id uuid)
returns table (
  current_turns   int,
  turns_today     int,
  daily_max_turns int,
  last_reset_date date,
  status          text
) as $$
  with today as (select (now() at time zone 'utc')::date as d)
  update rooms r
     set current_turns   = r.current_turns + 1,
         turns_today     = case
                             when r.last_reset_date < (select d from today) then 1
                             else r.turns_today + 1
                           end,
         last_reset_date = (select d from today)
   where r.id = p_room_id
     and r.status = 'active'
     and (
       r.last_reset_date < (select d from today)
       or r.turns_today  < r.daily_max_turns
     )
   returning r.current_turns, r.turns_today, r.daily_max_turns, r.last_reset_date, r.status;
$$ language sql;
