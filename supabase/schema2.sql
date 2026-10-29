create extension if not exists vector with schema extensions;

-- Tickets: allow system-created tickets, and track response/resolution times
alter table public.tickets alter column created_by drop not null;
alter table public.tickets
  add column if not exists source text not null default 'user',
  add column if not exists first_response_at timestamptz,
  add column if not exists resolved_at timestamptz;

create or replace function public.track_ticket_times() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status in ('resolved','closed') and old.status not in ('resolved','closed') then
    new.resolved_at := now();
  elsif new.status not in ('resolved','closed') then
    new.resolved_at := null;
  end if;
  return new;
end; $$;
create trigger ticket_times before update on public.tickets
  for each row execute function public.track_ticket_times();

-- Comments: internal notes are visible to staff only
alter table public.ticket_comments
  add column if not exists is_internal boolean not null default false;
drop policy if exists "comments follow ticket access" on public.ticket_comments;
drop policy if exists "comment on visible tickets" on public.ticket_comments;

create policy "read comments" on public.ticket_comments for select using (
  public.is_staff() or (not is_internal and exists (
    select 1 from public.tickets t where t.id = ticket_id and t.created_by = auth.uid())));
create policy "add comments" on public.ticket_comments for insert with check (
  author = auth.uid() and (public.is_staff() or (not is_internal and exists (
    select 1 from public.tickets t where t.id = ticket_id and t.created_by = auth.uid()))));

-- First staff reply sets first_response_at
create or replace function public.track_first_response() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not new.is_internal and exists (
    select 1 from public.profiles p where p.id = new.author
      and p.role in ('technician','it_admin','sys_admin')) then
    update public.tickets set first_response_at = now()
      where id = new.ticket_id and first_response_at is null;
  end if;
  return new;
end; $$;
create trigger comment_first_response after insert on public.ticket_comments
  for each row execute function public.track_first_response();

-- Knowledge base with embeddings (768 dimensions)
create table public.kb_articles (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null,
  category text,
  source_ticket_id bigint references public.tickets(id) on delete set null,
  created_by uuid references public.profiles(id),
  embedding extensions.vector(768),
  created_at timestamptz default now()
);
alter table public.kb_articles enable row level security;
create policy "signed-in read kb" on public.kb_articles
  for select using (auth.uid() is not null);
create policy "staff manage kb" on public.kb_articles
  for all using (public.is_staff()) with check (public.is_staff());
create index on public.kb_articles using hnsw (embedding extensions.vector_cosine_ops);

create or replace function public.match_kb(
  query_embedding extensions.vector(768),
  match_count int default 3,
  min_similarity float default 0.5
) returns table (id bigint, title text, body text, similarity float)
language sql stable set search_path = public, extensions as $$
  select id, title, body, 1 - (embedding <=> query_embedding) as similarity
  from kb_articles
  where 1 - (embedding <=> query_embedding) >= min_similarity
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Monitoring
create table public.metrics (
  id bigint generated always as identity primary key,
  host text not null,
  cpu real, memory real, disk real, uptime_s bigint,
  created_at timestamptz default now()
);
create index on public.metrics (host, created_at desc);

create table public.alert_rules (
  id bigint generated always as identity primary key,
  metric text not null unique,
  threshold real not null,
  urgency text not null default 'high',
  enabled boolean not null default true
);
insert into public.alert_rules (metric, threshold, urgency) values
  ('cpu', 90, 'high'), ('memory', 90, 'high'), ('disk', 90, 'critical');

create table public.alerts (
  id bigint generated always as identity primary key,
  host text not null,
  metric text not null,
  value real, threshold real,
  status text not null default 'open',
  ticket_id bigint references public.tickets(id) on delete set null,
  created_at timestamptz default now(),
  resolved_at timestamptz
);

alter table public.metrics enable row level security;
alter table public.alert_rules enable row level security;
alter table public.alerts enable row level security;
create policy "staff read metrics" on public.metrics for select using (public.is_staff());
create policy "staff read alerts" on public.alerts for select using (public.is_staff());
create policy "staff read rules" on public.alert_rules for select using (public.is_staff());
create policy "admin manage rules" on public.alert_rules for all
  using (public.is_it_admin()) with check (public.is_it_admin());