-- Migration: Revoke Anon Table Grants and Default Privileges
-- Revokes all table privileges on schema public from role anon
-- Preserves authenticated and service_role grants intact

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- Revoke default privileges for future tables created in public schema
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
