import assert from "node:assert/strict";
import { test } from "node:test";
import { splitSql } from "../src/sandbox/split-sql.js";

test("splits plain statements and drops empty ones", () => {
  assert.deepEqual(splitSql("select 1; ; select 2;\n"), ["select 1", "select 2"]);
});

test("keeps semicolons inside dollar-quoted bodies", () => {
  const sql = `create function f() returns void language plpgsql as $$ begin perform 1; perform 2; end $$;
create function g() returns int language sql as $body$ select 1; $body$; select 3`;
  const parts = splitSql(sql);
  assert.equal(parts.length, 3);
  assert.match(parts[0], /perform 2; end \$\$$/);
  assert.match(parts[1], /\$body\$$/);
});

test("ignores semicolons in strings, identifiers and comments", () => {
  const sql = `insert into t values ('a;b', 'it''s; ok'); -- trailing; comment
select "weird;name" from t /* block; /* nested; */ still */; select E'esc\\'; still';`;
  assert.deepEqual(
    splitSql(sql).map((s) => s.split("\n")[0]),
    ["insert into t values ('a;b', 'it''s; ok')", `-- trailing; comment`, "select E'esc\\'; still'"],
  );
  assert.equal(splitSql(sql).length, 3);
});

test("treats $1 parameters as plain text", () => {
  assert.deepEqual(splitSql("select $1; select $2"), ["select $1", "select $2"]);
});

test("drops comment-only chunks", () => {
  assert.deepEqual(splitSql("select 1; -- the end\n"), ["select 1"]);
});
