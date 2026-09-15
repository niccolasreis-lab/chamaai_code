-- Harden the version helper created by 007 for databases already migrated.
ALTER FUNCTION public.chamaai_latest_product_version(text[])
SET search_path = public, pg_temp;
