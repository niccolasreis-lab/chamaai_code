-- When the serial-manager catalog receives a new product version, refresh all
-- linked licenses without changing the version originally assigned to a serial.

CREATE OR REPLACE FUNCTION public.sync_license_latest_product_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE licenses
  SET
    product_latest_version = public.chamaai_latest_product_version(NEW.versions),
    updated_at = now()
  WHERE product_id = NEW.id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_license_latest_product_version ON products;
CREATE TRIGGER sync_license_latest_product_version
AFTER UPDATE OF versions ON products
FOR EACH ROW
EXECUTE FUNCTION public.sync_license_latest_product_version();

REVOKE EXECUTE ON FUNCTION public.sync_license_latest_product_version() FROM PUBLIC;
