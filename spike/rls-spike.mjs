// Spike: ¿PGlite aplica RLS con roles y claims estilo Supabase?
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();

await db.exec(`
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated;

  create table public.orders (id serial primary key, user_id uuid not null, total int);
  insert into public.orders (user_id, total) values
    ('11111111-1111-1111-1111-111111111111', 100),
    ('22222222-2222-2222-2222-222222222222', 200);
  grant select on public.orders to anon, authenticated;
`);

async function asUser(sub, sql) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role: "authenticated" })]);
  await db.exec("set role authenticated");
  const r = await db.query(sql);
  await db.exec("reset role");
  return r.rows;
}

const userA = "11111111-1111-1111-1111-111111111111";
console.log("Sin RLS, A ve:", (await asUser(userA, "select * from orders")).length, "filas");

await db.exec(`
  alter table public.orders enable row level security;
  create policy own_orders on public.orders for select using (user_id = auth.uid());
`);
console.log("Con RLS, A ve:", (await asUser(userA, "select * from orders")).length, "filas");
