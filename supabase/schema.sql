create type app_role as enum
  ('employee','technician','it_admin','sys_admin','management');
create type ticket_status as enum ('open','assigned','in_progress','resolved','closed');

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text,
  role app_role not null default 'employee',
  team text  -- e.g. 'network', 'hardware', 'software', 'accounts'
);

create table tickets (
  id bigint generated always as identity primary key,
  title text not null,
  description text not null,
  created_by uuid not null references profiles(id) default auth.uid(),
  assigned_to uuid references profiles(id),
  status ticket_status not null default 'open',
  -- AI fields
  category text,
  urgency text check (urgency in ('low','medium','high','critical')),
  affected_service text,
  routed_team text,
  ai_confidence real,
  ai_summary text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table ticket_comments (
  id bigint generated always as identity primary key,
  ticket_id bigint references tickets(id) on delete cascade,
  author uuid references profiles(id) default auth.uid(),
  body text not null,
  created_at timestamptz default now()
);

-- Auto-create a profile on signup
create function handle_new_user() returns trigger as $$
begin
  insert into profiles(id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end; $$ language plpgsql security definer;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- Helper: is the current user IT staff?
create function is_staff() returns boolean as $$
  select exists (select 1 from profiles
    where id = auth.uid() and role in ('technician','it_admin','sys_admin','management'));
$$ language sql security definer stable;

-- Row Level Security
alter table profiles enable row level security;
alter table tickets enable row level security;
alter table ticket_comments enable row level security;

create policy "read own or staff profiles" on profiles
  for select using (id = auth.uid() or is_staff());

create policy "employees see own tickets, staff see all" on tickets
  for select using (created_by = auth.uid() or is_staff());
create policy "authenticated users create tickets" on tickets
  for insert with check (created_by = auth.uid());
create policy "staff update tickets" on tickets
  for update using (is_staff());

create policy "comments follow ticket access" on ticket_comments
  for select using (exists (select 1 from tickets t where t.id = ticket_id
    and (t.created_by = auth.uid() or is_staff())));
create policy "comment on visible tickets" on ticket_comments
  for insert with check (author = auth.uid());