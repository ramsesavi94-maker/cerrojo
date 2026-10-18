# Cerrojo

**Check the access rules of your own Supabase app before you ship it.**

Apps built with Lovable, v0, Bolt and similar tools usually store data in Supabase, where Row Level Security (RLS) policies decide who can see and change each row. A missing or loose policy can expose customer data, and it is easy to miss when the code was generated for you.

Cerrojo (Spanish for "deadbolt") reads your project's `supabase/migrations`, rebuilds the database in an isolated in-memory sandbox, and checks that each user can only reach their own data. When an access rule does not hold, it shows the evidence, proposes a migration that fixes it, and re-runs the checks to confirm the fix without breaking legitimate access.

> Status: in active development for the Nebius x NVIDIA Global AI Hackathon (October 2026).

## Scope and responsible use

- Cerrojo works **only on migration files in a repository you own or are authorized to review**.
- It never connects to a live database or a deployed app. All checks run against a throwaway Postgres instance ([PGlite](https://pglite.dev)) in memory.
- Reports are meant for the project's owners, to fix issues before they reach users.

## What it checks

| Area | Example rule |
|---|---|
| Tables without RLS | Visitors cannot read `orders` |
| Over-broad policies | `using (true)` does not expose private columns |
| Privilege escalation | Users cannot update columns such as `is_admin` |
| `security definer` functions | Functions do not return other users' rows |
| Storage | Users can only read files in their own folder |

## How it works

1. **Rebuild**: apply your migrations to a sandbox that mirrors a fresh Supabase project (roles, default grants, `auth.*`, `storage.*`).
2. **Check**: run access checks as a visitor, as different signed-in users and as the service role.
3. **Fix**: an NVIDIA Nemotron model on Nebius Token Factory writes a corrective migration.
4. **Verify**: apply the fix to a new sandbox, confirm every rule holds and that legitimate access still works.

## Try it

Requires Node.js 22 or later.

```bash
npm install
npm test
npx tsx scripts/apply-migrations.ts path/to/your-app/supabase/migrations
```

`fixtures/demo-shop` is a fictional app with five common misconfigurations, plus the migration that fixes them. The tests show each rule failing before the fix and holding after it.

## License

[MIT](LICENSE)
