import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { splitSql, stripComments } from "./split-sql.js";
import { NATIVE_EXTENSIONS, STUBBED_EXTENSIONS } from "./supabase-shim.js";

export interface SkippedStatement {
  file: string;
  index: number;
  statement: string;
  reason: "extension" | "error";
  error?: string;
}

export interface MigrationReport {
  files: string[];
  applied: number;
  skipped: SkippedStatement[];
}

const CREATE_EXTENSION = /^\s*create\s+extension\s+(?:if\s+not\s+exists\s+)?"?([\w-]+)"?/i;
const HANDLED_EXTENSIONS = new Set<string>([...NATIVE_EXTENSIONS, ...STUBBED_EXTENSIONS]);

/**
 * Applies every `*.sql` file in `dir`, in filename order, one statement at a
 * time inside a savepoint. A statement that fails is rolled back and recorded
 * instead of aborting the run, so one unsupported feature does not hide the
 * rest of the schema. Function bodies are not validated, as in `pg_dump`.
 */
export async function applyMigrations(db: PGlite, dir: string): Promise<MigrationReport> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const report: MigrationReport = { files, applied: 0, skipped: [] };

  await db.exec(`set check_function_bodies = off`);
  try {
    for (const file of files) {
      const statements = splitSql(await readFile(join(dir, file), "utf8"));
      await db.transaction(async (tx) => {
        for (const [index, statement] of statements.entries()) {
          const body = stripComments(statement).trim();
          if (/^(begin|commit|start\s+transaction)\b/i.test(body)) continue;

          const ext = CREATE_EXTENSION.exec(body)?.[1]?.toLowerCase();
          if (ext && HANDLED_EXTENSIONS.has(ext)) continue;
          if (ext) {
            report.skipped.push({ file, index, statement: preview(statement), reason: "extension" });
            continue;
          }

          await tx.exec(`savepoint stmt`);
          try {
            await tx.exec(statement);
            await tx.exec(`release savepoint stmt`);
            report.applied++;
          } catch (err) {
            await tx.exec(`rollback to savepoint stmt`);
            report.skipped.push({ file, index, statement: preview(statement), reason: "error", error: (err as Error).message });
          }
        }
      });
    }
  } finally {
    await db.exec(`set check_function_bodies = on; set search_path = public, extensions; reset role`);
  }
  return report;
}

function preview(statement: string): string {
  const flat = statement.replace(/\s+/g, " ").trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}...` : flat;
}
