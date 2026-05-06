-- Manual migration: audit schema + DB roles. Idempotent.

-- 1. Create audit schema if not exists
CREATE SCHEMA IF NOT EXISTS audit;

-- 2. Create app role (only INSERT on audit.* allowed)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'cnp_app') THEN
    CREATE ROLE cnp_app WITH LOGIN PASSWORD 'cnp_app_pwd';
  END IF;
END $$;

-- 3. Grant on public schema (业务表) — full DML for now
GRANT USAGE ON SCHEMA public TO cnp_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cnp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO cnp_app;

-- 4. Grant on audit schema — INSERT + SELECT only(无 UPDATE / DELETE)
GRANT USAGE ON SCHEMA audit TO cnp_app;
GRANT INSERT, SELECT ON ALL TABLES IN SCHEMA audit TO cnp_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT INSERT, SELECT ON TABLES TO cnp_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA audit
  GRANT USAGE, SELECT ON SEQUENCES TO cnp_app;
