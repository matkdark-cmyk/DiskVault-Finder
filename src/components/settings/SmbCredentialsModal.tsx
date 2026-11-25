import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { PathValidationInfo } from '../../types';
import { formatBytes } from '../../utils/format';
import { connectSmbShare, extractErrorMessage } from '../../utils/tauri';

interface SmbCredentialsModalProps {
  isOpen: boolean;
  initialPath?: string;
  onClose: () => void;
  onConnected?: (info: PathValidationInfo, addAsRoot: boolean, alias: string) => Promise<void>;
}

export function SmbCredentialsModal({
  isOpen,
  initialPath = '',
  onClose,
  onConnected,
}: SmbCredentialsModalProps) {
  const pathRef = useRef<HTMLInputElement | null>(null);
  const [uncPath, setUncPath] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberInWindows, setRememberInWindows] = useState(true);
  const [addAsRoot, setAddAsRoot] = useState(true);
  const [alias, setAlias] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<PathValidationInfo | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setUncPath(initialPath);
    setUsername('');
    setPassword('');
    setShowPassword(false);
    setRememberInWindows(true);
    setAddAsRoot(true);
    setAlias('');
    setIsConnecting(false);
    setErrorMsg(null);
    setSuccessInfo(null);

    const frame = window.requestAnimationFrame(() => {
      pathRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, initialPath]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isConnecting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isConnecting, onClose]);

  if (!isOpen) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedPath = uncPath.trim();
    if (!trimmedPath) {
      setErrorMsg('Escribe la ruta de red UNC del NAS, por ejemplo \\\\192.168.1.50\\Compartido.');
      return;
    }

    setIsConnecting(true);
    setErrorMsg(null);
    setSuccessInfo(null);

    try {
      const info = await connectSmbShare(
        trimmedPath,
        username.trim(),
        password,
        rememberInWindows,
      );
      setSuccessInfo(info);
      setPassword(''); // Limpiar inmediatamente de memoria React tras enviar a Windows

      if (onConnected) {
        await onConnected(info, addAsRoot, alias.trim() || info.suggested_name);
        onClose();
      }
    } catch (err) {
      setErrorMsg(extractErrorMessage(err));
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isConnecting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="smb-modal-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <KeyRound className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <h2
              id="smb-modal-title"
              className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Conectar recurso compartido SMB
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isConnecting}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="p-5 space-y-4">
          {/* Security guarantee */}
          <div className="p-3 rounded-lg bg-[#F4F8FC] dark:bg-[#1E2A36] border border-[#D4E3F3] dark:border-[#2E465E] flex items-start gap-2.5 text-[11.5px] text-[#1E4B7A] dark:text-[#93D5FF] leading-relaxed">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              DiskVault Finder <strong>nunca guarda contraseñas</strong> en SQLite ni en archivos locales. La autenticación se delega directamente a Windows Credential Manager.
            </span>
          </div>

          <div>
            <label
              htmlFor="smb-unc-path"
              className="block text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] mb-1"
            >
              Ruta de red UNC del NAS
            </label>
            <input
              ref={pathRef}
              id="smb-unc-path"
              type="text"
              value={uncPath}
              onChange={(event) => {
                setUncPath(event.target.value);
                setErrorMsg(null);
              }}
              placeholder="\\192.168.1.50\Respaldos"
              disabled={isConnecting}
              spellCheck={false}
              autoComplete="off"
              className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none font-mono text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="smb-username"
                className="block text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] mb-1"
              >
                Usuario
              </label>
              <input
                id="smb-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Ej. admin o NAS\usuario"
                disabled={isConnecting}
                autoComplete="username"
                className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3]"
              />
            </div>

            <div>
              <label
                htmlFor="smb-password"
                className="block text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] mb-1"
              >
                Contraseña
              </label>
              <div className="relative">
                <input
                  id="smb-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  disabled={isConnecting}
                  autoComplete="current-password"
                  className="w-full h-9 pl-3 pr-9 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 inline-flex items-center justify-center rounded text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                >
                  {showPassword ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-2 pt-0.5">
            <label className="flex items-start gap-2 text-[12px] text-[#333333] dark:text-[#D4D4D4] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberInWindows}
                onChange={(event) => setRememberInWindows(event.target.checked)}
                disabled={isConnecting}
                className="mt-0.5 accent-[#0067C0]"
              />
              <span>
                Recordar credenciales en Windows Credential Manager (reconecta al reiniciar Windows)
              </span>
            </label>

            {onConnected && (
              <>
                <label className="flex items-start gap-2 text-[12px] text-[#333333] dark:text-[#D4D4D4] cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={addAsRoot}
                    onChange={(event) => setAddAsRoot(event.target.checked)}
                    disabled={isConnecting}
                    className="mt-0.5 accent-[#0067C0]"
                  />
                  <span>
                    Agregar automáticamente esta carpeta a mis ubicaciones vigiladas
                  </span>
                </label>

                {addAsRoot && (
                  <div className="pl-6">
                    <input
                      type="text"
                      value={alias}
                      onChange={(event) => setAlias(event.target.value)}
                      placeholder="Nombre visible opcional (ej. NAS Principal)"
                      disabled={isConnecting}
                      className="w-full h-8 px-2.5 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none text-[12px] text-[#1A1A1A] dark:text-[#F3F3F3]"
                    />
                  </div>
                )}
              </>
            )}
          </div>

          {successInfo && (
            <div className="p-2.5 rounded-lg bg-[#F4FAF5] dark:bg-[#1B2B21] border border-[#C5E4CC] dark:border-[#2C4D38] flex items-start gap-2 text-[12px] text-[#166534] dark:text-[#6EE7B7]">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">{successInfo.message}</p>
                {successInfo.free_bytes !== null && (
                  <p className="mt-0.5 text-[11.5px] tabular-nums">
                    Espacio disponible: {formatBytes(successInfo.free_bytes)}
                  </p>
                )}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="p-2.5 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span className="leading-snug">{errorMsg}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isConnecting}
              className="h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isConnecting || !uncPath.trim()}
              className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
            >
              {isConnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isConnecting ? 'Conectando...' : 'Conectar SMB'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
