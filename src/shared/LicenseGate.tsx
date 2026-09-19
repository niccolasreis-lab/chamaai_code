import { useState, useEffect } from 'react';
import { validateLicense } from './supabaseClient';
import { Lock, AlertTriangle, KeyRound, Loader2, CheckCircle2 } from 'lucide-react';
import { Input, Button } from './components';

interface LicenseGateProps {
  children: React.ReactNode;
}

export default function LicenseGate({ children }: LicenseGateProps) {
  // Se NÃO está rodando no Electron (browser puro), libera direto sem verificar licença
  const isElectron = !!(window as any).api;

  const [isLocked, setIsLocked] = useState(isElectron); // browser = false (desbloqueado)
  const [isValidating, setIsValidating] = useState(isElectron); // browser = false (pronto)
  const [serialCode, setSerialCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Se for browser, não precisa verificar licença
    if (!isElectron) return;

    async function checkSavedLicense() {
      const savedKey = localStorage.getItem('app_license_key');
      
      if (!savedKey) {
        setIsValidating(false);
        return;
      }

      // Cache diário: se já validou hoje, liberar sem consultar o Supabase
      const today = new Date().toLocaleDateString('sv-SE'); // "2026-05-05"
      const lastCheck = localStorage.getItem('license_last_check');

      if (lastCheck === today) {
        // Já validou hoje, liberar direto
        setIsLocked(false);
        setIsValidating(false);
        return;
      }

      // Validar no Supabase (1x por dia)
      const result = await validateLicense(savedKey);
      
      if (result.isValid) {
        setIsLocked(false);
        localStorage.setItem('license_last_check', today);
        localStorage.setItem('license_last_success', today);
      } else {
        if (result.isNetworkError) {
          const lastSuccess = localStorage.getItem('license_last_success');
          if (lastSuccess) {
            const lastSuccessDate = new Date(lastSuccess).getTime();
            const todayDate = new Date(today).getTime();
            const diffDays = Math.floor((todayDate - lastSuccessDate) / (1000 * 3600 * 24));
            
            if (diffDays <= 7) {
              // Grace period: permite uso offline por até 7 dias sem internet
              console.warn(`[LicenseGate] Offline. Grace period ativo. Última validação com sucesso: ${diffDays} dias atrás.`);
              setIsLocked(false);
              setIsValidating(false);
              return;
            }
          }
        }
        setError(result.message || 'Licença inválida.');
        localStorage.removeItem('app_license_key');
        localStorage.removeItem('license_last_check');
      }
      setIsValidating(false);
    }

    checkSavedLicense();
  }, []);

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serialCode.trim()) return;

    setLoading(true);
    setError('');

    localStorage.removeItem('license_last_check');
    const normalizedKey = serialCode.trim().replace(/\s+/g, '').toUpperCase();
    const result = await validateLicense(normalizedKey);

    if (result.isValid) {
      const today = new Date().toLocaleDateString('sv-SE');
      localStorage.setItem('app_license_key', normalizedKey);
      localStorage.setItem('license_last_check', today);
      localStorage.setItem('license_last_success', today);
      setIsLocked(false);
    } else {
      setError(result.message || 'Falha na ativação da licença.');
    }

    setLoading(false);
  };

  if (isValidating) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center font-sans">
        <Loader2 className="animate-spin text-primary h-12 w-12 mb-4" />
        <p className="text-ink-variant font-bold tracking-widest uppercase animate-pulse text-xs">Verificando Licença...</p>
      </div>
    );
  }

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center font-sans relative overflow-hidden p-4">
      {/* Background Decorativo */}
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-primary/20 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] bg-secondary/20 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-lg bg-surface backdrop-blur-md border border-outline-variant rounded-2xl p-10 shadow-lg relative z-10 flex flex-col items-center">
        <div className="w-20 h-20 bg-error/10 rounded-2xl flex items-center justify-center mb-6">
          <Lock className="text-error h-10 w-10" />
        </div>
        
        <h1 className="font-sans text-3xl font-bold text-ink uppercase tracking-widest text-center mb-2">Sistema Bloqueado</h1>
        <p className="text-ink-variant font-medium text-center text-sm mb-8">
          Por favor, insira uma chave de licença válida para liberar o uso do aplicativo.
        </p>

        {error && (
          <div className="w-full bg-error-container border border-error/20 text-error text-xs font-bold p-4 rounded-xl text-center mb-6 flex items-center justify-center gap-2 uppercase tracking-wider">
            <AlertTriangle className="h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleActivate} className="w-full flex flex-col gap-5">
          <Input
            label="Serial Key"
            type="text"
            value={serialCode}
            onChange={(e) => setSerialCode(e.target.value)}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            leadingIcon={<KeyRound className="h-5 w-5" />}
            required
            autoFocus
            className="uppercase"
          />

          <Button
            type="submit"
            disabled={loading || !serialCode.trim()}
            className="w-full mt-2 h-12 text-sm tracking-widest uppercase font-bold flex justify-center items-center"
          >
            {loading ? (
              <Loader2 className="animate-spin h-5 w-5" />
            ) : (
              <>
                Ativar Sistema
                <CheckCircle2 className="h-5 w-5 ml-2" />
              </>
            )}
          </Button>
        </form>
        
        <div className="mt-8 text-center text-ink-variant text-xs font-bold uppercase tracking-widest">
          <p>
            Dúvidas?{' '}
            <a href="https://chamaai-nine.vercel.app/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary-hover underline decoration-primary/30 underline-offset-4 transition-colors">
              Acesse nosso suporte
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
