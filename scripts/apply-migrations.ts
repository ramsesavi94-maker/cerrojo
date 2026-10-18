// Applies a folder of Supabase migrations to a fresh sandbox and prints what
// was skipped and which public tables end up without RLS.
// Usage: npx tsx scripts/apply-migrations.ts <path/to/supabase/migrations>
import { Sandbox } from "../src/sandbox/sandbox.js";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: tsx scripts/apply-migrations.ts <migrations dir>");
  process.exit(1);
}

const started = Date.now();
const sandbox = await Sandbox.create();
const report = await sandbox.applyMigrations(dir);

console.log(`${report.files.length} files, ${report.applied} statements applied, ${report.skipped.length} skipped (${Date.now() - started} ms)`);
for (const s of report.skipped) {
  console.log(`- ${s.file} #${s.index} [${s.reason}] ${s.error ?? ""}\n    ${s.statement}`);
}

const { rows: tables } = await sandbox.db.query<{ table: string; rls: boolean; policies: number }>(`
  select c.relname as table, c.relrowsecurity as rls,
         (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policies
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  order by c.relname`);
console.log(`\nPublic tables (${tables.length}):`);
for (const t of tables) console.log(`  ${t.rls ? "RLS " : "NO-RLS"}  ${String(t.policies).padStart(2)} policies  ${t.table}`);

await sandbox.close();
