-- Create a role for read-write access
CREATE ROLE read_write_role;

-- Create a role for read-only access
CREATE ROLE read_only_role;

-- existing tables read-write and read-only
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename <> '_prisma_migrations'
  LOOP
    -- Read-write role
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO read_write_role;', r.tablename);
    -- Read-only role
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO read_only_role;', r.tablename);
  END LOOP;
END$$;


-- Future tables (read-write)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO read_write_role;

-- Future tables (read-only)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
GRANT SELECT ON TABLES TO read_only_role;

-- Optional: revoke on _prisma_migrations if it exists
REVOKE ALL ON TABLE public._prisma_migrations FROM read_write_role;
REVOKE ALL ON TABLE public._prisma_migrations FROM read_only_role;

-- Grant usage on schema, only then they can access the tables/views
GRANT USAGE ON SCHEMA public TO read_write_role;
GRANT USAGE ON SCHEMA public TO read_only_role;

-- Read-write user
CREATE USER rw_user WITH PASSWORD 'strongPassword%123';
GRANT read_write_role TO rw_user;

-- Read-only user
CREATE USER ro_user WITH PASSWORD 'strongPassword%123';
GRANT read_only_role TO ro_user;

