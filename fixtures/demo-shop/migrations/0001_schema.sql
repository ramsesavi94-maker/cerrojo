-- Demo Shop: a fictional app used to test Cerrojo.
-- It contains five common Supabase misconfigurations, each marked "MISCONFIG".
-- Do not copy this schema into a real project; see ../fix/ for the corrected version.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  email text,
  phone text,
  is_admin boolean not null default false
);
alter table public.profiles enable row level security;

-- MISCONFIG 1: every profile, including email and phone, is readable by anyone.
create policy "profiles are public" on public.profiles for select using (true);

-- MISCONFIG 2: owners may update their whole row, including is_admin.
create policy "owners update profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email)
  values (new.id, new.raw_user_meta_data ->> 'name', new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- MISCONFIG 3: row level security is never enabled on orders.
create table public.orders (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id),
  total_cents integer not null,
  shipping_address text not null,
  created_at timestamptz not null default now()
);

-- MISCONFIG 4: security definer function returns any user's orders, ignoring the caller.
create function public.get_orders(p_user_id uuid) returns setof public.orders
language sql security definer set search_path = public as $$
  select * from public.orders where user_id = p_user_id
$$;

-- MISCONFIG 5: any signed-in user can read every file in the private invoices bucket.
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false);
create policy "signed-in users read invoices" on storage.objects for select to authenticated
  using (bucket_id = 'invoices');
