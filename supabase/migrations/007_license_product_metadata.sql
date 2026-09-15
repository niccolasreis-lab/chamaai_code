-- Keep ChamaAí cloud licenses aligned with the serial-manager catalog.
-- `serial_version` is the version assigned to the serial; `product_latest_version`
-- is calculated from the versions currently registered for its product.

ALTER TABLE licenses
  ADD COLUMN IF NOT EXISTS source_serial_id uuid REFERENCES serials(id),
  ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES products(id),
  ADD COLUMN IF NOT EXISTS serial_version text,
  ADD COLUMN IF NOT EXISTS product_latest_version text,
  ADD COLUMN IF NOT EXISTS license_type text;

CREATE INDEX IF NOT EXISTS idx_licenses_source_serial_id
  ON licenses(source_serial_id);
CREATE INDEX IF NOT EXISTS idx_licenses_product_id
  ON licenses(product_id);

CREATE OR REPLACE FUNCTION public.chamaai_latest_product_version(versions text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT version
  FROM unnest(coalesce(versions, '{}'::text[])) AS version
  WHERE nullif(regexp_replace(version, '[^0-9.]', '', 'g'), '') IS NOT NULL
  ORDER BY string_to_array(regexp_replace(version, '[^0-9.]', '', 'g'), '.')::integer[] DESC,
           version DESC
  LIMIT 1;
$$;

UPDATE licenses l
SET
  source_serial_id = s.id,
  product_id = p.id,
  serial_version = s.version,
  product_latest_version = public.chamaai_latest_product_version(p.versions),
  license_type = s.license_type,
  updated_at = now()
FROM serials s
JOIN products p ON p.id = s.product_id
WHERE l.license_key = btrim(s.code);

CREATE OR REPLACE FUNCTION public.sync_license_product_metadata_from_serial()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE licenses l
  SET
    source_serial_id = NEW.id,
    product_id = NEW.product_id,
    serial_version = NEW.version,
    product_latest_version = (
      SELECT public.chamaai_latest_product_version(p.versions)
      FROM products p
      WHERE p.id = NEW.product_id
    ),
    license_type = NEW.license_type,
    updated_at = now()
  WHERE l.license_key = btrim(NEW.code);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_license_product_metadata_from_serial ON serials;
CREATE TRIGGER sync_license_product_metadata_from_serial
AFTER INSERT OR UPDATE OF code, product_id, version, license_type ON serials
FOR EACH ROW
EXECUTE FUNCTION public.sync_license_product_metadata_from_serial();

REVOKE EXECUTE ON FUNCTION public.sync_license_product_metadata_from_serial() FROM PUBLIC;
