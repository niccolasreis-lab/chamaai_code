/**
 * CHAMA AÍ - Edge Function de Ativação de Licença
 * FASE 5C
 *
 * Valida a chave de licença, vincula ao installation_id e
 * provisiona o device_token (retornado puro).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { crypto } from "https://deno.land/std@0.168.0/crypto/mod.ts";
import { encode as base64urlEncode } from "https://deno.land/std@0.168.0/encoding/base64url.ts";

const allowedOriginsStr = Deno.env.get("ALLOWED_ADMIN_ORIGINS") || "";

function getCorsHeaders(reqOrigin: string) {
  let allowedOrigin = "";
  // Electron empacotado usa origem file://; ela não pode ser pré-cadastrada
  // como um domínio HTTP, mas precisa passar pelo preflight da função.
  if (reqOrigin === "null" || reqOrigin.startsWith("file://")) {
    allowedOrigin = reqOrigin;
  } else if (allowedOriginsStr === "*") {
    allowedOrigin = "*";
  } else if (allowedOriginsStr) {
    const list = allowedOriginsStr.split(",").map(o => o.trim());
    if (list.includes(reqOrigin)) {
      allowedOrigin = reqOrigin;
    }
  }
  return {
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  };
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateDeviceToken(): string {
  // 32 bytes de aleatoriedade forte em base64url
  const randomBuffer = new Uint8Array(32);
  crypto.getRandomValues(randomBuffer);
  return base64urlEncode(randomBuffer);
}

serve(async (req) => {
  const reqOrigin = req.headers.get("origin") || "";
  const corsHeaders = getCorsHeaders(reqOrigin);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    const body = await req.json();
    const { license_key, installation_id, app_version, db_version, hostname, local_ip } = body;
    const normalizedLicenseKey = typeof license_key === 'string'
      ? license_key.trim().replace(/\s+/g, '').toUpperCase()
      : '';

    if (!normalizedLicenseKey || !installation_id) {
      return new Response(JSON.stringify({ error: 'license_key e installation_id são obrigatórios.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

    if (!supabaseServiceKey) {
      return new Response(JSON.stringify({ error: 'Erro de configuração no servidor.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // 1. Validar a licença
    const { data: license, error: licenseError } = await adminClient
      .from('licenses')
      .select('*')
      .ilike('license_key', normalizedLicenseKey)
      .single();

    if (licenseError || !license) {
      return new Response(JSON.stringify({ error: 'Licença não encontrada.' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (license.status !== 'active') {
      return new Response(JSON.stringify({ error: 'Licença inativa ou bloqueada.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (license.expires_at && new Date(license.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'Licença expirada.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!license.tenant_id || !license.store_id) {
      return new Response(JSON.stringify({ error: 'Licença não está vinculada a nenhuma loja.' }), {
        status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 2. Localizar/Registrar Device
    let deviceId = null;

    // Busca devices vinculados a esta store
    const { data: devicesData } = await adminClient
      .from('devices')
      .select('id, installation_id')
      .eq('store_id', license.store_id);

    const existingDevice = devicesData?.find(d => d.installation_id === installation_id);

    if (existingDevice) {
      deviceId = existingDevice.id;
      // Atualizar dispositivo existente
      await adminClient.from('devices').update({
        app_version: app_version || null,
        db_version: db_version || null,
        hostname: hostname || null,
        local_ip: local_ip || null,
        status: 'online',
        last_seen_at: new Date().toISOString()
      }).eq('id', deviceId);
    } else {
      // Verificar limite de dispositivos se desejado.
      // Por ora, apenas registra.
      const { data: newDevice, error: createDevError } = await adminClient.from('devices').insert({
        tenant_id: license.tenant_id,
        store_id: license.store_id,
        installation_id: installation_id,
        type: 'master',
        status: 'online',
        app_version: app_version || null,
        db_version: db_version || null,
        hostname: hostname || null,
        local_ip: local_ip || null,
        last_seen_at: new Date().toISOString()
      }).select().single();

      if (createDevError) {
        return new Response(JSON.stringify({ error: 'Falha ao registrar dispositivo.' }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }
      deviceId = newDevice.id;
    }

    // 3. Revogar tokens antigos deste installation_id
    await adminClient.from('device_tokens')
      .update({ status: 'revoked' })
      .eq('installation_id', installation_id);

    // 4. Gerar novo device_token
    const deviceToken = generateDeviceToken();
    const tokenHash = await sha256(deviceToken); // TODO em Prod: usar HMAC SHA-256 com secret

    const { error: insertTokenError } = await adminClient.from('device_tokens').insert({
      tenant_id: license.tenant_id,
      store_id: license.store_id,
      device_id: deviceId,
      installation_id: installation_id,
      token_hash: tokenHash,
      status: 'active'
    });

    if (insertTokenError) {
      return new Response(JSON.stringify({ error: 'Erro ao gerar credenciais de acesso.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 5. Atualizar datas de uso da licença
    const nowIso = new Date().toISOString();
    await adminClient.from('licenses')
      .update({
        activated_at: license.activated_at || nowIso,
        last_checkin_at: nowIso
      }).eq('id', license.id);

    // 5.5 Obter portal_public_token se existir
    const { data: portalRow } = await adminClient
      .from('store_public_portals')
      .select('portal_public_token')
      .eq('tenant_id', license.tenant_id)
      .eq('store_id', license.store_id)
      .eq('enabled', true)
      .limit(1)
      .maybeSingle();

    // 6. Retornar SUCESSO (Retornando o device_token em texto claro uma única vez)
    return new Response(JSON.stringify({
      ok: true,
      tenant_id: license.tenant_id,
      store_id: license.store_id,
      device_id: deviceId,
      installation_id: installation_id,
      device_token: deviceToken,
      portal_public_token: portalRow?.portal_public_token || null,
      license: {
        status: license.status,
        plan: license.plan,
        modules: license.modules || {},
        expires_at: license.expires_at,
        product: {
          id: license.product_id || null,
          serial_version: license.serial_version || null,
          latest_version: license.product_latest_version || null,
          license_type: license.license_type || null
        }
      },
      next_checkin_seconds: 3600
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    console.error("Exceção:", error);
    return new Response(JSON.stringify({ error: 'Erro interno no servidor de ativação.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
