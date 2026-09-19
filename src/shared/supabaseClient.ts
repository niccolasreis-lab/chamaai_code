import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://npfqnsgjicmxwmurwosu.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5wZnFuc2dqaWNteHdtdXJ3b3N1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3ODQyNDQsImV4cCI6MjA5MjM2MDI0NH0.wLIFMxZkE9rjGQjZF7eFi0dyDioOGQfg1jfhRy32O90';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export interface LicenseValidationResult {
  isValid: boolean;
  message?: string;
  data?: any;
  isNetworkError?: boolean;
}

function getInstallationId(): string {
  const storageKey = 'chamaai_license_installation_id';
  const savedId = localStorage.getItem(storageKey);
  if (savedId) return savedId;

  const installationId = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `web-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  localStorage.setItem(storageKey, installationId);
  return installationId;
}

export async function validateLicense(serialCode: string): Promise<LicenseValidationResult> {
  const normalizedKey = serialCode.trim().replace(/\s+/g, '').toUpperCase();
  try {
    const response = await fetch(`${SUPABASE_URL}/functions/v1/chamaai-activate-license`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        license_key: normalizedKey,
        installation_id: getInstallationId()
      })
    });

    const data = await response.json().catch(() => ({}));

    if (response.ok && data.ok) {
      return { isValid: true, data };
    }

    if (response.status === 404) {
      return { isValid: false, message: 'Serial inválido ou inexistente.' };
    }

    if (response.status === 403) {
      return { isValid: false, message: data.error || 'Esta licença está inativa ou bloqueada no servidor.' };
    }

    if (response.status === 409) {
      return { isValid: false, message: data.error || 'Esta licença ainda não está vinculada a uma loja.' };
    }

    return { isValid: false, message: data.error || 'Não foi possível validar a licença.' };
  } catch (err) {
    console.error('Erro ao validar licença:', err);
    return { isValid: false, message: 'Erro de comunicação com o servidor de licenças. Verifique sua conexão com a internet.', isNetworkError: true };
  }
}
