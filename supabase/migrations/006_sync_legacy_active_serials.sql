-- Synchronize every eligible legacy CRM serial with the ChamaAí multi-tenant
-- license model. This replaces the client-specific bootstrap in
-- 20260720190212_bootstrap_legacy_chamaai_cloud.sql for existing projects.
--
-- Safe to run more than once: it only creates missing tenants, stores,
-- licenses and public portals; existing license status is never reactivated.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS legacy_client_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_legacy_client
  ON tenants (legacy_client_id)
  WHERE legacy_client_id IS NOT NULL;

WITH eligible_serials AS (
  SELECT DISTINCT s.client_id
  FROM serials s
  JOIN products p ON p.id = s.product_id
  WHERE s.status = 'Active'
    AND s.expiration_date > now()
    AND NULLIF(btrim(s.code), '') IS NOT NULL
    AND (p.name = 'ChamaAí' OR p.prefix = 'CA')
)
INSERT INTO tenants (name, document, status, legacy_client_id)
SELECT c.company_name, c.cnpj, 'active', c.id
FROM clients c
JOIN eligible_serials es ON es.client_id = c.id
ON CONFLICT (legacy_client_id) WHERE legacy_client_id IS NOT NULL
DO UPDATE SET
  name = EXCLUDED.name,
  document = EXCLUDED.document,
  updated_at = now();

INSERT INTO stores (tenant_id, name, status)
SELECT t.id, t.name, 'active'
FROM tenants t
WHERE t.legacy_client_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM stores s
    WHERE s.tenant_id = t.id
  );

INSERT INTO licenses (
  tenant_id,
  store_id,
  license_key,
  status,
  plan,
  modules,
  expires_at
)
SELECT
  t.id,
  st.id,
  btrim(s.code),
  'active',
  'professional',
  '{"queue": true, "portal": true, "products": true}'::jsonb,
  s.expiration_date
FROM serials s
JOIN products p ON p.id = s.product_id
JOIN tenants t ON t.legacy_client_id = s.client_id
JOIN LATERAL (
  SELECT id
  FROM stores
  WHERE tenant_id = t.id
  ORDER BY created_at ASC
  LIMIT 1
) st ON true
WHERE s.status = 'Active'
  AND s.expiration_date > now()
  AND NULLIF(btrim(s.code), '') IS NOT NULL
  AND (p.name = 'ChamaAí' OR p.prefix = 'CA')
ON CONFLICT (license_key) DO UPDATE SET
  -- Preserve a manual block/inactivation of an existing ChamaAí license.
  tenant_id = EXCLUDED.tenant_id,
  store_id = EXCLUDED.store_id,
  modules = EXCLUDED.modules,
  expires_at = EXCLUDED.expires_at,
  updated_at = now();

INSERT INTO store_public_portals (
  tenant_id,
  store_id,
  portal_public_token,
  enabled,
  allowed_features
)
SELECT
  s.tenant_id,
  s.id,
  encode(gen_random_bytes(32), 'hex'),
  true,
  '{"products": true}'::jsonb
FROM stores s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.legacy_client_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM store_public_portals p
    WHERE p.store_id = s.id
      AND p.enabled = true
  );

-- Validation query (read-only; run after this migration in the SQL editor):
-- SELECT s.code, l.status, l.expires_at, t.name AS tenant, st.name AS store
-- FROM serials s
-- JOIN products p ON p.id = s.product_id
-- LEFT JOIN licenses l ON l.license_key = btrim(s.code)
-- LEFT JOIN tenants t ON t.id = l.tenant_id
-- LEFT JOIN stores st ON st.id = l.store_id
-- WHERE s.status = 'Active'
--   AND s.expiration_date > now()
--   AND (p.name = 'ChamaAí' OR p.prefix = 'CA')
-- ORDER BY s.expiration_date;
