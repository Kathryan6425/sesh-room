-- ============================================================
-- The Sesh Room — one-time database setup (public version)
--
-- Creates the three tables the site uses (posts, comments,
-- room messages) and opens them for public read + add, the
-- same append-only spirit as the private prototype: anyone
-- can read and post, nobody can edit or delete through the
-- public keys. Likes go through a tiny function so a like can
-- only ever add +1.
--
-- Run this ONCE: Supabase project → SQL Editor → New query →
-- paste this whole file → Run. "Success. No rows returned" is good!
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- posts (the feed) ----------
create table if not exists public.sesh_posts (
  id          uuid primary key default gen_random_uuid(),
  author_name text not null default 'Guest',
  content     text not null,
  tag         text not null default 'General',
  likes       integer not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- comments on posts ----------
create table if not exists public.sesh_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.sesh_posts (id) on delete cascade,
  author_name text not null default 'Guest',
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sesh_comments_post_idx on public.sesh_comments (post_id, created_at);

-- ---------- chat room messages ----------
create table if not exists public.sesh_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     text not null,
  author_name text not null default 'Guest',
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists sesh_messages_room_idx on public.sesh_messages (room_id, created_at);

-- ---------- row level security: public read + add only ----------
alter table public.sesh_posts    enable row level security;
alter table public.sesh_comments enable row level security;
alter table public.sesh_messages enable row level security;

drop policy if exists "sesh posts are public to read" on public.sesh_posts;
create policy "sesh posts are public to read" on public.sesh_posts
  for select using (true);
drop policy if exists "anyone can add a sesh post" on public.sesh_posts;
create policy "anyone can add a sesh post" on public.sesh_posts
  for insert with check (true);

drop policy if exists "sesh comments are public to read" on public.sesh_comments;
create policy "sesh comments are public to read" on public.sesh_comments
  for select using (true);
drop policy if exists "anyone can add a sesh comment" on public.sesh_comments;
create policy "anyone can add a sesh comment" on public.sesh_comments
  for insert with check (true);

drop policy if exists "sesh messages are public to read" on public.sesh_messages;
create policy "sesh messages are public to read" on public.sesh_messages
  for select using (true);
drop policy if exists "anyone can add a sesh message" on public.sesh_messages;
create policy "anyone can add a sesh message" on public.sesh_messages
  for insert with check (true);

-- ---------- likes: +1 only, through this function ----------
create or replace function public.increment_sesh_likes(p_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.sesh_posts set likes = likes + 1 where id = p_id returning likes;
$$;
