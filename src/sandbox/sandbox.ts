import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { applyMigrations, type MigrationReport } from "./migrations.js";
import { NATIVE_EXTENSIONS, SUPABASE_SHIM_SQL } from "./supabase-shim.js";

/** Who a query runs as, mirroring the roles PostgREST switches to. */
export type Actor =
  | { role: "anon" }
  | { role: "authenticated"; userId: string; email?: string }
  | { role: "service_role" };

export type QueryOutcome =
  | { ok: true; rows: Record<string, unknown>[]; affectedRows: number }
  | { ok: false; error: string; code?: string };

export interface NewUser {
  email: string;
  id?: string;
  userMetadata?: Record<string, unknown>;
  appMetadata?: Record<string, unknown>;
}

/** An isolated, in-memory Postgres that behaves like a fresh Supabase project. */
export class Sandbox {
  private constructor(readonly db: PGlite) {}

  static async create(): Promise<Sandbox> {
    const db = await PGlite.create({ extensions: { citext, pg_trgm, pgcrypto, uuid_ossp } });
    await db.exec(SUPABASE_SHIM_SQL);
    for (const ext of NATIVE_EXTENSIONS) await db.exec(`create extension if not exists "${ext}" with schema extensions`);
    await db.exec(`alter database postgres set search_path = public, extensions`);
    await db.exec(`set search_path = public, extensions`);
    return new Sandbox(db);
  }

  applyMigrations(dir: string): Promise<MigrationReport> {
    return applyMigrations(this.db, dir);
  }

  /** Inserts into auth.users as the platform would, so signup triggers fire. */
  async createUser(user: NewUser): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data)
       values (coalesce($1::uuid, gen_random_uuid()), $2, $3::jsonb, coalesce($4::jsonb, '{"provider":"email","providers":["email"]}'::jsonb))
       returning id`,
      [user.id ?? null, user.email, JSON.stringify(user.userMetadata ?? {}), user.appMetadata ? JSON.stringify(user.appMetadata) : null],
    );
    return rows[0].id;
  }

  /**
   * Runs one statement as `actor`, with the JWT claims PostgREST would set.
   * Changes are rolled back unless `commit` is true, so probes leave no trace.
   */
  async runAs(actor: Actor, sql: string, params: unknown[] = [], { commit = false } = {}): Promise<QueryOutcome> {
    const claims =
      actor.role === "authenticated"
        ? { sub: actor.userId, role: "authenticated", aud: "authenticated", email: actor.email ?? null }
        : { role: actor.role };

    try {
      return await this.db.transaction(async (tx) => {
        await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
        await tx.exec(`set local role ${actor.role}`);
        const result = await tx.query<Record<string, unknown>>(sql, params);
        const outcome: QueryOutcome = { ok: true, rows: result.rows, affectedRows: result.affectedRows ?? 0 };
        if (!commit) await tx.rollback();
        return outcome;
      });
    } catch (err) {
      const e = err as { message?: string; code?: string };
      return { ok: false, error: e.message ?? String(err), code: e.code };
    }
  }

  close(): Promise<void> {
    return this.db.close();
  }
}
