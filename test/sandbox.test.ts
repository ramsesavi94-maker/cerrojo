import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { Sandbox } from "../src/sandbox/sandbox.js";

const MIGRATION_1 = `
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;

create table public.profiles (id uuid primary key references auth.users (id), display_name text);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for select to authenticated using (id = auth.uid());

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name) values (new.id, new.raw_user_meta_data ->> 'name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Leaky on purpose: RLS never enabled.
create table public.orders (id serial primary key, user_id uuid not null, total int);

select cron.schedule('nightly', '0 3 * * *', 'select 1');
alter publication supabase_realtime add table public.orders;
`;

const MIGRATION_2 = `
select this_function_does_not_exist();
insert into storage.buckets (id, name, public) values ('art', 'art', false);
create policy "own folder" on storage.objects for select to authenticated
  using (bucket_id = 'art' and (storage.foldername(name))[1] = auth.uid()::text);
`;

let sandbox: Sandbox;
let alice: string;
let bob: string;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "cerrojo-"));
  await writeFile(join(dir, "001_init.sql"), MIGRATION_1);
  await writeFile(join(dir, "002_storage.sql"), MIGRATION_2);

  sandbox = await Sandbox.create();
  const report = await sandbox.applyMigrations(dir);
  assert.equal(report.skipped.length, 1, JSON.stringify(report.skipped));
  assert.match(report.skipped[0].error ?? "", /this_function_does_not_exist/);

  alice = await sandbox.createUser({ email: "alice@example.com", userMetadata: { name: "Alice" } });
  bob = await sandbox.createUser({ email: "bob@example.com", userMetadata: { name: "Bob" } });
  await sandbox.db.query(`insert into public.orders (user_id, total) values ($1, 100), ($2, 200)`, [alice, bob]);
  await sandbox.db.query(`insert into storage.objects (bucket_id, name, owner) values ('art', $1, $2), ('art', $3, $4)`, [
    `${alice}/a.jpg`, alice, `${bob}/b.jpg`, bob,
  ]);
});

after(() => sandbox?.close());

test("signup trigger runs, and RLS limits profiles to the owner", async () => {
  const r = await sandbox.runAs({ role: "authenticated", userId: alice }, `select display_name from public.profiles`);
  assert.deepEqual(r.ok && r.rows, [{ display_name: "Alice" }]);
});

test("anon cannot read a table protected by RLS", async () => {
  const r = await sandbox.runAs({ role: "anon" }, `select * from public.profiles`);
  assert.deepEqual(r.ok && r.rows, []);
});

test("a table without RLS leaks every row to anon, as on real Supabase", async () => {
  const r = await sandbox.runAs({ role: "anon" }, `select user_id from public.orders`);
  assert.equal(r.ok && r.rows.length, 2);
});

test("service_role bypasses RLS", async () => {
  const r = await sandbox.runAs({ role: "service_role" }, `select * from public.profiles`);
  assert.equal(r.ok && r.rows.length, 2);
});

test("storage policies see only the user's own folder", async () => {
  const r = await sandbox.runAs({ role: "authenticated", userId: bob }, `select name from storage.objects`);
  assert.deepEqual(r.ok && r.rows, [{ name: `${bob}/b.jpg` }]);
});

test("probes roll back by default", async () => {
  const del = await sandbox.runAs({ role: "anon" }, `delete from public.orders`);
  assert.equal(del.ok && del.affectedRows, 2);
  const { rows } = await sandbox.db.query(`select count(*)::int as n from public.orders`);
  assert.deepEqual(rows, [{ n: 2 }]);
});

test("errors are returned, not thrown", async () => {
  const r = await sandbox.runAs({ role: "anon" }, `select * from auth.users`);
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : "", /permission denied/);
});
