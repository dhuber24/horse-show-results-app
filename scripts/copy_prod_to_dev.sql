/*
  Copy production data down into the dev branch, so a show created on
  gaitdesk.com can be opened and tested locally.

  RUN IT CONNECTED TO DEV. It writes to the database it runs on and reads the
  one named by PROD_DATABASE_URL. It refuses to run on the production endpoint,
  and refuses a source that is the same endpoint it is running on.

  On Windows, run it through the wrapper, which finds dev in .env, asks for
  the production connection string without echoing it, and guards the target
  the way database/migrate.ps1 does:

    powershell -ExecutionPolicy Bypass -File scripts/copy-prod-to-dev.ps1

  Or drive psql yourself from the repo root, in Git Bash (\getenv needs psql
  15+, hence postgres:17):

    DEV=$(grep '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/+asyncpg//')
    read -rsp 'Production connection string: ' PROD; echo
    MSYS_NO_PATHCONV=1 docker run --rm -e PROD_DATABASE_URL="$PROD" \
      -v "$PWD/scripts:/s" postgres:17-alpine \
      psql "$DEV" -X -v ON_ERROR_STOP=1 -f /s/copy_prod_to_dev.sql

  The production connection string is Neon console -> production branch ->
  Connect. A -pooler host is rewritten to the direct one.

  WHAT IT DOES
  - Additive only. A row is copied when dev has no row with its primary key.
    Nothing in dev is updated or deleted, so rows both branches share keep
    dev's version, and dev-only test data survives.
  - A production row dev deleted comes back.
  - Parents are copied before children (foreign-key order), and a child whose
    parent is still missing is held back rather than failing the run.
  - Columns are matched by name, so dev being a migration or two ahead of
    production is fine. _migrations is never copied.
  - One statement, one transaction: it all lands or none of it does. The
    postgres_fdw server, user mapping and foreign tables are created and
    dropped inside that transaction, so the production password is never
    committed to dev's catalog.

  READING THE REPORT
  - copied: rows inserted into dev.
  - left_behind: production rows still not in dev. Either dev already holds
    the same thing under a different id (a unique key other than the primary
    key matched), or a parent row was left behind. Expect some on
    exhibitor_competition_cards: migration 134 backfilled those with random
    ids on each branch separately, so the same card has two ids.
  - note: a table that was skipped or errored, and why.
*/

\set QUIET on
\getenv source_url PROD_DATABASE_URL
\if :{?source_url}
\else
  \echo 'PROD_DATABASE_URL is not set. See the header of this file.'
  \quit
\endif

SET prod_copy.source_url = :'source_url';
\unset source_url
\set QUIET off

DO $copy$
DECLARE
  /* SHA-256 of the production branch's Neon endpoint id. Hashed rather than
     written down for the same reason as database/production-hosts.sha256:
     the repo is public. */
  production_endpoints constant text[] := ARRAY[
    'cbde8680c947541b1f424f22fe9abb600f192076b4f584535743ec613280cb8b'
  ];

  src_url     text := current_setting('prod_copy.source_url', true);
  parts       text[];
  target_ep   text := current_setting('neon.endpoint_id', true);
  source_ep   text;
  had_fdw     boolean;

  remaining   oid[];
  ready       oid[];
  ordered     oid[] := '{}';
  tbl         oid;
  tname       text;
  src_tbl     regclass;

  cols        text;
  sel         text;
  fk_filter   text;
  pk_match    text;
  missing_req text;
  insert_sql  text[] := '{}';
  count_sql   text[] := '{}';

  n           bigint;
  pass_total  bigint;
  pass        int := 0;
BEGIN
  PERFORM set_config('prod_copy.source_url', '', false);
  PERFORM set_config('client_min_messages', 'warning', true);

  IF target_ep IS NULL THEN
    RAISE EXCEPTION 'This session is not on a Neon compute, so it cannot tell whether it is production. Refusing.';
  END IF;
  IF encode(sha256(convert_to(target_ep, 'UTF8')), 'hex') = ANY (production_endpoints) THEN
    RAISE EXCEPTION 'This session is connected to PRODUCTION (%). Connect to the dev branch: this script writes to the database it runs on.', target_ep;
  END IF;

  parts := regexp_match(
    src_url,
    '^postgres(?:ql)?(?:\+asyncpg)?://([^:/@]+):([^@]+)@([^/:?]+)(?::([0-9]+))?/([^?]+)'
  );
  IF parts IS NULL THEN
    RAISE EXCEPTION 'PROD_DATABASE_URL is not a postgresql://user:password@host/dbname connection string.';
  END IF;

  /* The link to the source. */
  had_fdw := EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgres_fdw');
  CREATE EXTENSION IF NOT EXISTS postgres_fdw;
  DROP SCHEMA IF EXISTS prod_copy_src CASCADE;
  DROP SERVER IF EXISTS prod_copy_src CASCADE;
  EXECUTE format(
    'CREATE SERVER prod_copy_src FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host %L, port %L, dbname %L, sslmode %L)',
    replace(parts[3], '-pooler.', '.'), coalesce(parts[4], '5432'), parts[5], 'require'
  );
  EXECUTE format(
    'CREATE USER MAPPING FOR CURRENT_USER SERVER prod_copy_src OPTIONS (user %L, password %L)',
    parts[1], parts[2]
  );
  CREATE SCHEMA prod_copy_src;

  /* Which endpoint the source really is, asked of the source itself. */
  IMPORT FOREIGN SCHEMA pg_catalog LIMIT TO (pg_settings) FROM SERVER prod_copy_src INTO prod_copy_src;
  SELECT setting INTO source_ep FROM prod_copy_src.pg_settings WHERE name = 'neon.endpoint_id';
  IF source_ep IS NOT DISTINCT FROM target_ep THEN
    RAISE EXCEPTION 'PROD_DATABASE_URL points at this same endpoint (%). Point it at production.', target_ep;
  END IF;

  IMPORT FOREIGN SCHEMA public FROM SERVER prod_copy_src INTO prod_copy_src;

  CREATE TEMP TABLE IF NOT EXISTS prod_copy_report (
    position    int,
    table_name  text,
    copied      bigint,
    left_behind bigint,
    note        text
  );
  TRUNCATE prod_copy_report;
  INSERT INTO prod_copy_report VALUES (
    0, '(endpoints)', NULL, NULL,
    format('%s -> %s%s', source_ep, target_ep,
      CASE WHEN encode(sha256(convert_to(coalesce(source_ep, ''), 'UTF8')), 'hex') = ANY (production_endpoints)
           THEN ' (from production)'
           ELSE ' (WARNING: source is not the production endpoint)' END)
  );

  /* Foreign-key order: a table goes after every table it references. A cycle,
     should one ever appear, is taken as it stands and finished by the repeat
     passes below. */
  remaining := ARRAY(
    SELECT c.oid FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND c.relkind = 'r'
      AND c.relname <> '_migrations'
    ORDER BY c.relname
  );
  WHILE cardinality(remaining) > 0 LOOP
    ready := ARRAY(
      SELECT r FROM unnest(remaining) WITH ORDINALITY AS u(r, i)
      WHERE NOT EXISTS (
        SELECT 1 FROM pg_constraint k
        WHERE k.contype = 'f' AND k.conrelid = u.r
          AND k.confrelid <> u.r AND k.confrelid = ANY (remaining)
      )
      ORDER BY i
    );
    IF cardinality(ready) = 0 THEN
      ready := remaining;
    END IF;
    ordered := ordered || ready;
    remaining := ARRAY(
      SELECT r FROM unnest(remaining) WITH ORDINALITY AS u(r, i)
      WHERE NOT u.r = ANY (ready)
      ORDER BY i
    );
  END LOOP;

  /* One INSERT and one left-behind count per table. */
  FOR pos IN 1 .. cardinality(ordered) LOOP
    tbl := ordered[pos];
    tname := (SELECT relname FROM pg_class WHERE oid = tbl);
    src_tbl := to_regclass(format('prod_copy_src.%I', tname));
    insert_sql := insert_sql || NULL::text;
    count_sql := count_sql || NULL::text;
    INSERT INTO prod_copy_report VALUES (pos, tname, 0, NULL, NULL);

    IF src_tbl IS NULL THEN
      UPDATE prod_copy_report SET note = 'not in production (a newer dev migration)' WHERE position = pos;
      CONTINUE;
    END IF;

    SELECT string_agg(a.attname, ', ') INTO missing_req
    FROM pg_attribute a
    WHERE a.attrelid = tbl AND a.attnum > 0 AND NOT a.attisdropped
      AND a.attnotnull AND NOT a.atthasdef
      AND NOT EXISTS (
        SELECT 1 FROM pg_attribute r
        WHERE r.attrelid = src_tbl AND r.attname = a.attname AND r.attnum > 0 AND NOT r.attisdropped
      );
    IF missing_req IS NOT NULL THEN
      UPDATE prod_copy_report
      SET note = format('skipped: dev requires %s, which production does not have', missing_req)
      WHERE position = pos;
      CONTINUE;
    END IF;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY a.attnum),
           string_agg(format('s.%I', a.attname), ', ' ORDER BY a.attnum)
    INTO cols, sel
    FROM pg_attribute a
    WHERE a.attrelid = tbl AND a.attnum > 0 AND NOT a.attisdropped AND a.attgenerated = ''
      AND EXISTS (
        SELECT 1 FROM pg_attribute r
        WHERE r.attrelid = src_tbl AND r.attname = a.attname AND r.attnum > 0 AND NOT r.attisdropped
      );

    /* A row is held back while any parent it names is not in dev yet.
       MATCH SIMPLE: a key with a NULL in it references nothing. */
    SELECT string_agg(format('(%s OR EXISTS (SELECT 1 FROM %s p WHERE %s))', f.nulls, k.confrelid::regclass, f.matches), ' AND ')
    INTO fk_filter
    FROM pg_constraint k
    CROSS JOIN LATERAL (
      SELECT string_agg(format('s.%I IS NULL', la.attname), ' OR ') AS nulls,
             string_agg(format('p.%I = s.%I', pa.attname, la.attname), ' AND ') AS matches,
             bool_and(EXISTS (
               SELECT 1 FROM pg_attribute r
               WHERE r.attrelid = src_tbl AND r.attname = la.attname AND r.attnum > 0 AND NOT r.attisdropped
             )) AS all_in_source
      FROM unnest(k.conkey, k.confkey) AS u(lk, pk)
      JOIN pg_attribute la ON la.attrelid = k.conrelid AND la.attnum = u.lk
      JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = u.pk
    ) f
    WHERE k.contype = 'f' AND k.conrelid = tbl AND f.all_in_source;

    SELECT string_agg(format('d.%I = s.%I', a.attname, a.attname), ' AND ')
    INTO pk_match
    FROM pg_constraint k
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
    WHERE k.contype = 'p' AND k.conrelid = tbl;

    IF pk_match IS NULL THEN
      UPDATE prod_copy_report SET note = 'skipped: no primary key to tell a copied row from a new one' WHERE position = pos;
      CONTINUE;
    END IF;

    insert_sql[pos] := format(
      'INSERT INTO public.%I (%s) SELECT %s FROM prod_copy_src.%I s WHERE NOT EXISTS (SELECT 1 FROM public.%I d WHERE %s) AND %s ON CONFLICT DO NOTHING',
      tname, cols, sel, tname, tname, pk_match, coalesce(fk_filter, 'true')
    );
    count_sql[pos] := format(
      'SELECT count(*) FROM prod_copy_src.%I s WHERE NOT EXISTS (SELECT 1 FROM public.%I d WHERE %s)',
      tname, tname, pk_match
    );
  END LOOP;

  /* Repeat until a pass copies nothing. Without a cycle the second pass is
     only the confirmation. */
  LOOP
    pass := pass + 1;
    pass_total := 0;
    FOR pos IN 1 .. cardinality(ordered) LOOP
      CONTINUE WHEN insert_sql[pos] IS NULL;
      BEGIN
        EXECUTE insert_sql[pos];
        GET DIAGNOSTICS n = ROW_COUNT;
        pass_total := pass_total + n;
        UPDATE prod_copy_report SET copied = copied + n WHERE position = pos;
      EXCEPTION WHEN OTHERS THEN
        UPDATE prod_copy_report SET note = 'error: ' || SQLERRM WHERE position = pos;
        insert_sql[pos] := NULL;
      END;
    END LOOP;
    EXIT WHEN pass_total = 0 OR pass >= 25;
  END LOOP;

  FOR pos IN 1 .. cardinality(ordered) LOOP
    CONTINUE WHEN count_sql[pos] IS NULL;
    EXECUTE count_sql[pos] INTO n;
    UPDATE prod_copy_report SET left_behind = n WHERE position = pos;
  END LOOP;

  DROP SCHEMA prod_copy_src CASCADE;
  DROP SERVER prod_copy_src CASCADE;
  IF NOT had_fdw THEN
    DROP EXTENSION postgres_fdw;
  END IF;
END
$copy$;

SELECT table_name, copied, left_behind, note
FROM (
  SELECT position, table_name, copied, left_behind, note
  FROM prod_copy_report
  WHERE copied > 0 OR left_behind > 0 OR note IS NOT NULL
  UNION ALL
  SELECT 2147483647, 'TOTAL', sum(copied), sum(left_behind), NULL
  FROM prod_copy_report
) r
ORDER BY position;
