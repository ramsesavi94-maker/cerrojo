-- Corrected access rules for Demo Shop. Applied after ../migrations/.

-- Fix 1: users read only their own profile.
drop policy "profiles are public" on public.profiles;
create policy "owners read profile" on public.profiles for select using (id = auth.uid());

-- Fix 2: owners may update only the columns they are meant to change.
revoke update on public.profiles from anon, authenticated;
grant update (display_name, phone) on public.profiles to authenticated;

-- Fix 3: orders are private to their owner.
alter table public.orders enable row level security;
create policy "owners read orders" on public.orders for select using (user_id = auth.uid());
create policy "owners create orders" on public.orders for insert with check (user_id = auth.uid());

-- Fix 4: keep the signature the app calls, but only return the caller's orders.
create or replace function public.get_orders(p_user_id uuid) returns setof public.orders
language sql security definer set search_path = public as $$
  select * from public.orders where user_id = p_user_id and user_id = auth.uid()
$$;
revoke execute on function public.get_orders(uuid) from public, anon;

-- Fix 5: each user reads only files under a folder named after their user id.
drop policy "signed-in users read invoices" on storage.objects;
create policy "owners read invoices" on storage.objects for select to authenticated
  using (bucket_id = 'invoices' and (storage.foldername(name))[1] = auth.uid()::text);
