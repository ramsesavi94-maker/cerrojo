import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { type Actor, type QueryOutcome, Sandbox } from "../src/sandbox/sandbox.js";

const FIXTURE = join(import.meta.dirname, "..", "fixtures", "demo-shop");

interface Users {
  alice: string;
  bob: string;
}

/** An access rule the app should satisfy, expressed as a query that must find nothing. */
interface Expectation {
  rule: string;
  actor: (u: Users) => Actor;
  sql: string;
  params?: (u: Users) => unknown[];
}

const EXPECTATIONS: Expectation[] = [
  {
    rule: "visitors cannot read profile contact details",
    actor: () => ({ role: "anon" }),
    sql: `select email, phone from public.profiles`,
  },
  {
    rule: "users cannot make themselves admin",
    actor: (u) => ({ role: "authenticated", userId: u.alice }),
    sql: `update public.profiles set is_admin = true where id = $1`,
    params: (u) => [u.alice],
  },
  {
    rule: "visitors cannot read orders",
    actor: () => ({ role: "anon" }),
    sql: `select id from public.orders`,
  },
  {
    rule: "get_orders does not return another user's orders",
    actor: (u) => ({ role: "authenticated", userId: u.bob }),
    sql: `select id from public.get_orders($1)`,
    params: (u) => [u.alice],
  },
  {
    rule: "users cannot read another user's invoices",
    actor: (u) => ({ role: "authenticated", userId: u.bob }),
    sql: `select name from storage.objects where bucket_id = 'invoices' and name like $1`,
    params: (u) => [`${u.alice}/%`],
  },
];

/** Access the app needs; must keep working after the fix. */
const LEGITIMATE: Expectation[] = [
  { rule: "owner reads own profile", actor: (u) => ({ role: "authenticated", userId: u.alice }), sql: `select id from public.profiles where id = $1`, params: (u) => [u.alice] },
  { rule: "owner renames self", actor: (u) => ({ role: "authenticated", userId: u.alice }), sql: `update public.profiles set display_name = 'Ali' where id = $1`, params: (u) => [u.alice] },
  { rule: "owner reads own orders", actor: (u) => ({ role: "authenticated", userId: u.alice }), sql: `select id from public.orders` },
  { rule: "owner calls get_orders for self", actor: (u) => ({ role: "authenticated", userId: u.alice }), sql: `select id from public.get_orders($1)`, params: (u) => [u.alice] },
  { rule: "owner reads own invoice", actor: (u) => ({ role: "authenticated", userId: u.alice }), sql: `select name from storage.objects where bucket_id = 'invoices'` },
];

const foundNothing = (r: QueryOutcome) => !r.ok || (r.rows.length === 0 && r.affectedRows === 0);

async function setup(withFix: boolean): Promise<{ sandbox: Sandbox; users: Users }> {
  const sandbox = await Sandbox.create();
  for (const dir of withFix ? ["migrations", "fix"] : ["migrations"]) {
    const report = await sandbox.applyMigrations(join(FIXTURE, dir));
    assert.deepEqual(report.skipped, [], `${dir} applies cleanly`);
  }
  const alice = await sandbox.createUser({ email: "alice@demo.test", userMetadata: { name: "Alice" } });
  const bob = await sandbox.createUser({ email: "bob@demo.test", userMetadata: { name: "Bob" } });
  await sandbox.db.query(`insert into public.orders (user_id, total_cents, shipping_address) values ($1, 4200, 'Calle Falsa 123')`, [alice]);
  await sandbox.db.query(`insert into storage.objects (bucket_id, name, owner) values ('invoices', $1, $2), ('invoices', $3, $4)`, [
    `${alice}/inv-1.pdf`, alice, `${bob}/inv-2.pdf`, bob,
  ]);
  return { sandbox, users: { alice, bob } };
}

const run = (s: Sandbox, u: Users, e: Expectation) => s.runAs(e.actor(u), e.sql, e.params?.(u) ?? []);

describe("demo shop as shipped", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  before(async () => (ctx = await setup(false)));
  after(() => ctx?.sandbox.close());

  for (const e of EXPECTATIONS) {
    test(`violates: ${e.rule}`, async () => {
      assert.equal(foundNothing(await run(ctx.sandbox, ctx.users, e)), false);
    });
  }
});

describe("demo shop after the fix", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  before(async () => (ctx = await setup(true)));
  after(() => ctx?.sandbox.close());

  for (const e of EXPECTATIONS) {
    test(`holds: ${e.rule}`, async () => {
      assert.equal(foundNothing(await run(ctx.sandbox, ctx.users, e)), true);
    });
  }
  for (const e of LEGITIMATE) {
    test(`still works: ${e.rule}`, async () => {
      assert.equal(foundNothing(await run(ctx.sandbox, ctx.users, e)), false);
    });
  }
});
