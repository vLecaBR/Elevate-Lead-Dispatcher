-- Runs once, on the first start of an empty data volume (postgres image entrypoint).
-- The test suite uses its own database so truncating tables never touches dev data.
CREATE DATABASE elevate_test;
