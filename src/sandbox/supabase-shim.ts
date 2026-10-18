// Recreates the parts of a Supabase Postgres instance that app migrations and
// RLS policies depend on: roles, default grants, auth.*, storage.*, and no-op
// stand-ins for platform extensions PGlite cannot load (pgmq, pg_cron, vault, pg_net).

/** Extensions PGlite can load for real; installed into the `extensions` schema. */
export const NATIVE_EXTENSIONS = ["uuid-ossp", "pgcrypto", "pg_trgm", "citext"] as const;

/** Platform extensions replaced by stubs; `create extension` for them is skipped. */
export const STUBBED_EXTENSIONS = ["pgmq", "pg_cron", "supabase_vault", "pg_net", "pgsodium", "pg_graphql", "pg_stat_statements", "pgjwt", "plpgsql"] as const;

export const SUPABASE_SHIM_SQL = /* sql */ `
-- Roles -----------------------------------------------------------------
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create role authenticator noinherit;
create role supabase_admin superuser;
create role supabase_auth_admin noinherit;
create role supabase_storage_admin noinherit;
create role supabase_realtime_admin noinherit;
create role supabase_replication_admin;
create role supabase_read_only_user;
create role dashboard_user;
create role pgbouncer;
grant anon, authenticated, service_role to authenticator;

-- Schemas and default privileges (same as a fresh Supabase project) ------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- auth ---------------------------------------------------------------------
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

create table auth.users (
  instance_id uuid,
  id uuid primary key default gen_random_uuid(),
  aud varchar(255) default 'authenticated',
  role varchar(255) default 'authenticated',
  email varchar(255) unique,
  encrypted_password varchar(255),
  email_confirmed_at timestamptz default now(),
  confirmed_at timestamptz default now(),
  last_sign_in_at timestamptz,
  raw_app_meta_data jsonb default '{"provider":"email","providers":["email"]}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  is_super_admin boolean,
  is_anonymous boolean not null default false,
  phone text unique,
  banned_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
grant select on auth.users to service_role;

create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create function auth.email() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

grant execute on all functions in schema auth to anon, authenticated, service_role;

-- storage ------------------------------------------------------------------
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;

create table storage.buckets (
  id text primary key,
  name text not null unique,
  owner uuid,
  owner_id text,
  public boolean default false,
  avif_autodetection boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  owner_id text,
  metadata jsonb,
  user_metadata jsonb,
  path_tokens text[] generated always as (string_to_array(name, '/')) stored,
  version text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  last_accessed_at timestamptz default now(),
  unique (bucket_id, name)
);

alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;

create function storage.foldername(name text) returns text[] language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end
$$;

create function storage.filename(name text) returns text language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[array_length(_parts, 1)];
end
$$;

create function storage.extension(name text) returns text language plpgsql immutable as $$
declare _parts text[]; _filename text;
begin
  select string_to_array(name, '/') into _parts;
  select _parts[array_length(_parts, 1)] into _filename;
  return reverse(split_part(reverse(_filename), '.', 1));
end
$$;

grant execute on all functions in schema storage to anon, authenticated, service_role;

-- realtime -----------------------------------------------------------------
create publication supabase_realtime;

-- Stand-ins for platform extensions ----------------------------------------
create schema pgmq;
create function pgmq.create(queue_name text) returns void language plpgsql as $$ begin end $$;
create function pgmq.send(queue_name text, msg jsonb, delay integer default 0) returns setof bigint language plpgsql as $$ begin return next 1; end $$;
create function pgmq.read(queue_name text, vt integer, qty integer)
  returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, visible_at timestamptz, message jsonb)
  language plpgsql as $$ begin return; end $$;
create function pgmq.delete(queue_name text, msg_id bigint) returns boolean language plpgsql as $$ begin return true; end $$;
create function pgmq.archive(queue_name text, msg_id bigint) returns boolean language plpgsql as $$ begin return true; end $$;

create schema cron;
create function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$ begin return 1; end $$;
create function cron.schedule(schedule text, command text) returns bigint language plpgsql as $$ begin return 1; end $$;
create function cron.unschedule(job_name text) returns boolean language plpgsql as $$ begin return true; end $$;
create function cron.unschedule(job_id bigint) returns boolean language plpgsql as $$ begin return true; end $$;

create schema vault;
create table vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text not null default '',
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
  returns uuid language sql as $$
  insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id
$$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
  returns void language sql as $$
  update vault.secrets set
    secret = coalesce(new_secret, secret),
    name = coalesce(new_name, name),
    description = coalesce(new_description, description),
    updated_at = now()
  where id = secret_id
$$;

create schema net;
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
  returns bigint language plpgsql as $$ begin return 1; end $$;
create function net.http_get(url text, params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds integer default 5000)
  returns bigint language plpgsql as $$ begin return 1; end $$;
`;
