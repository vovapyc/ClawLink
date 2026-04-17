-- Agent Chat App — initial schema
-- Run this in your Supabase SQL editor after creating the project.

create extension if not exists "pgcrypto";

-- Rooms ---------------------------------------------------------------
create table if not exists rooms (
  id              uuid primary key default gen_random_uuid(),
  invite_code     text not null unique,
  room_channel_id text not null unique,
  max_turns       int  not null check (max_turns > 0),
  current_turns   int  not null default 0,
  status          text not null default 'waiting'
                  check (status in ('waiting','active','completed')),
  created_at      timestamptz not null default now()
);

create index if not exists rooms_invite_code_idx on rooms(invite_code);

-- Participants --------------------------------------------------------
create table if not exists room_participants (
  id               uuid primary key default gen_random_uuid(),
  room_id          uuid not null references rooms(id) on delete cascade,
  user_label       text not null check (user_label in ('agent_a','agent_b')),
  agent_token_hash text not null,
  joined_at        timestamptz not null default now(),
  unique (room_id, user_label)
);

create index if not exists room_participants_token_hash_idx
  on room_participants(agent_token_hash);

-- Messages ------------------------------------------------------------
create table if not exists messages (
  id         uuid primary key default gen_random_uuid(),
  room_id    uuid not null references rooms(id) on delete cascade,
  sender     text not null check (sender in ('agent_a','agent_b')),
  content    text not null,
  turn_index int  not null,
  created_at timestamptz not null default now(),
  unique (room_id, turn_index)
);

create index if not exists messages_room_id_idx on messages(room_id, turn_index);

-- Atomic turn advance -------------------------------------------------
-- Returns the new current_turns + status if the advance succeeded.
-- Returns zero rows if current_turns >= max_turns (room already full).
create or replace function advance_room_turn(p_room_id uuid)
returns table (current_turns int, status text, max_turns int) as $$
  update rooms
     set current_turns = current_turns + 1,
         status = case
                    when current_turns + 1 >= max_turns then 'completed'
                    else status
                  end
   where id = p_room_id
     and status = 'active'
     and current_turns < max_turns
   returning current_turns, status, max_turns;
$$ language sql;

-- RLS -----------------------------------------------------------------
alter table rooms             enable row level security;
alter table room_participants enable row level security;
alter table messages          enable row level security;

drop policy if exists "anon read rooms" on rooms;
create policy "anon read rooms"
  on rooms for select using (true);

drop policy if exists "anon read messages" on messages;
create policy "anon read messages"
  on messages for select using (true);

-- room_participants: no select policy for anon. Only service role reads it.
