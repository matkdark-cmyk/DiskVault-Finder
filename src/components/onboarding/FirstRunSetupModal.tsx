import { useEffect, useState, type FormEvent } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FolderSearch,
  HardDrive,
  Loader2,
  Server,
  X,
} from 'lucide-react';
import type { PathValidationInfo } from '../../types';
import { formatBytes } from '../../utils/format';
import {
  extractErrorMessage,
  pickFolderDialog,
  validateNasOrLocalPath,
} from '../../utils/tauri';

interface FirstRunSetupModalProps {
  isOpen: boolean;
  isFirstRun: boolean;
  isTauri: boolean;
  onClose: () => void;
  onSubmitRoot: (name: string, path: string) => Promise<void>;
  onOpenSmbConnect?: (initialPath: string) => void;
}

export function FirstRunSetupModal({
  isOpen,
  isFirstRun,
  isTauri,
  onClose,
  onSubmitRoot,
  onOpenSmbConnect,
}: FirstRunSetupModalProps) {
  const [pathInput, setPathInput] = useState<string>('');
  const [nameInput, setNameInput] = useState<string>('');
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [validation, setValidation] = useState<PathValidationInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setPathInput('');
      setNameInput('');
      setValidation(null);
      setErrorMsg(null);
      setIsChecking(false);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  if (!isOpen) {
    return null;
  }

  const runValidation = async (targetPath: string): Promise<PathValidationInfo | null> => {
    const trimmed = targetPath.trim();
    if (!trimmed) {
      setErrorMsg('Escribe o selecciona la ruta de una carpeta del NAS o disco local.');
      setValidation(null);
      return null;
    }
    setIsChecking(true);
    setErrorMsg(null);
    try {
      const info = await validateNasOrLocalPath(trimmed);
      setValidation(info);
      setPathInput(info.normalized_path);
      if (!nameInput.trim() && info.suggested_name) {
        setNameInput(info.suggested_name);
      }
      if (!info.is_accessible) {
        setErrorMsg(info.message);
      }
      return info;
    } catch (err) {
      setValidation(null);
      setErrorMsg(extractErrorMessage(err));
      return null;
    } finally {
      setIsChecking(false);
    }
  };

  const handleBrowseFolder = async (): Promise<void> => {
    setErrorMsg(null);
    try {
      const picked = await pickFolderDialog();
      if (picked) {
        setPathInput(picked);
        await runValidation(picked);
      }
    } catch (err) {
      setErrorMsg(extractErrorMessage(err));
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setErrorMsg(null);

    const trimmedPath = pathInput.trim();
    if (!trimmedPath) {
      setErrorMsg('Debes indicar la ruta de la carpeta que deseas agregar.');
      return;
    }

    setIsSubmitting(true);
    try {
      let currentValidation = validation;
      if (!currentValidation || currentValidation.normalized_path !== trimmedPath) {
        currentValidation = await runValidation(trimmedPath);
      }
      if (!currentValidation || !currentValidation.is_accessible) {
        return;
      }

      const finalName = nameInput.trim() || currentValidation.suggested_name;
      await onSubmitRoot(finalName, currentValidation.normalized_path);
    } catch (err) {
      setErrorMsg(extractErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 dark:bg-black/65 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="setup-modal-title"
    >
      <div className="w-full max-w-lg rounded-lg bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#EAEAEA] dark:border-[#333333] flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <img
              src="/icon.svg"
              alt="DiskVault Finder"
              className="w-8 h-8 mt-0.5 shrink-0"
            />
            <div>
              <h2
                id="setup-modal-title"
                className="text-[15.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] leading-snug"
              >
                {isFirstRun
                  ? 'Bienvenido a DiskVault Finder'
                  : 'Agregar carpeta del NAS o disco local'}
              </h2>
              <p className="text-[12.5px] text-[#5C5C5C] dark:text-[#A6A6A6] mt-0.5">
                {isFirstRun
                  ? 'Conecta tu primera carpeta en red o disco de respaldo para mantener su índice siempre listo.'
                  : 'Registra una ruta UNC de red, unidad mapeada o carpeta local.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar ventana"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-[#F0F0F0] dark:hover:bg-[#333333] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form body */}
        <form onSubmit={(e) => void handleSubmit(e)} className="p-5 space-y-4">
          {!isTauri && (
            <div className="rounded-md bg-[#F7F9FC] dark:bg-[#1E2A36] border border-[#D4E3F3] dark:border-[#2E465E] px-3 py-2.5 text-[12px] text-[#1E4B7A] dark:text-[#93D5FF]">
              Estás viendo la interfaz web previa. Para examinar carpetas reales del NAS y guardarlas en SQLite, ejecuta el proyecto en Windows con Tauri.
            </div>
          )}

          {/* Path input */}
          <div className="space-y-1.5">
            <label
              htmlFor="root-path-input"
              className="block text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA]"
            >
              Ruta de carpeta del NAS o disco local
            </label>
            <div className="flex items-center gap-2">
              <input
                id="root-path-input"
                type="text"
                value={pathInput}
                onChange={(e) => {
                  setPathInput(e.target.value);
                  setValidation(null);
                  setErrorMsg(null);
                }}
                placeholder="\\192.168.1.50\Respaldos o Z:\Videos"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D2D2D2] dark:border-[#3D3D3D] font-mono text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3] placeholder:text-[#848484] dark:placeholder:text-[#767676] focus:outline-none focus:border-[#0067C0] dark:focus:border-[#60CDFF]"
              />
              <button
                type="button"
                onClick={() => void handleBrowseFolder()}
                disabled={isChecking || isSubmitting}
                className="h-9 px-3 rounded-md bg-[#F5F5F5] dark:bg-[#2F2F2F] border border-[#D4D4D4] dark:border-[#404040] hover:bg-[#ECECEC] dark:hover:bg-[#383838] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-50"
              >
                <FolderSearch className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF]" />
                <span>Examinar...</span>
              </button>
            </div>
            <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#6E6E6E] dark:text-[#989898]">
              <span>Ejemplos: \\192.168.1.50\Compartido, Z:\, D:\Respaldos</span>
              <button
                type="button"
                disabled={isChecking || !pathInput.trim()}
                onClick={() => void runValidation(pathInput)}
                className="text-[#0067C0] dark:text-[#60CDFF] hover:underline font-medium disabled:opacity-50 cursor-pointer whitespace-nowrap"
              >
                {isChecking ? 'Verificando...' : 'Verificar conexión'}
              </button>
            </div>
          </div>

          {/* Live validation panel */}
          {validation && validation.is_accessible && (
            <div className="rounded-md bg-[#F4FAF5] dark:bg-[#1B2B21] border border-[#C5E4CC] dark:border-[#2C4D38] p-3 space-y-1.5">
              <div className="flex items-center gap-2 text-[12.5px] font-medium text-[#166534] dark:text-[#6EE7B7]">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>{validation.message}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-[#3F5947] dark:text-[#A7D7B8] pl-6">
                <span className="inline-flex items-center gap-1">
                  {validation.is_network ? (
                    <Server className="w-3.5 h-3.5" />
                  ) : (
                    <HardDrive className="w-3.5 h-3.5" />
                  )}
                  {validation.is_network ? 'Ubicación de red (NAS)' : 'Disco local'}
                </span>
                {validation.free_bytes !== null && validation.total_bytes !== null && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      Libre: {formatBytes(validation.free_bytes)} de{' '}
                      {formatBytes(validation.total_bytes)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMsg && (
            <div className="rounded-md bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] px-3 py-2.5 space-y-1.5 text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="leading-snug">{errorMsg}</span>
              </div>
              {onOpenSmbConnect && pathInput.trim().startsWith('\\\\') && (
                <div className="pl-6">
                  <button
                    type="button"
                    onClick={() => onOpenSmbConnect(pathInput.trim())}
                    className="text-[12px] font-semibold text-[#0067C0] dark:text-[#60CDFF] hover:underline cursor-pointer"
                  >
                    ¿Requiere usuario y contraseña SMB? Conectar credenciales...
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Friendly display name */}
          <div className="space-y-1.5">
            <label
              htmlFor="root-name-input"
              className="block text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA]"
            >
              Nombre visible en el panel izquierdo
            </label>
            <input
              id="root-name-input"
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="Ej. NAS Principal, Videos 4K o Respaldo Familiar"
              autoComplete="off"
              className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D2D2D2] dark:border-[#3D3D3D] text-[13px] text-[#1A1A1A] dark:text-[#F3F3F3] placeholder:text-[#848484] dark:placeholder:text-[#767676] focus:outline-none focus:border-[#0067C0] dark:focus:border-[#60CDFF]"
            />
          </div>

          {/* Actions */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-[#EAEAEA] dark:border-[#333333]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-9 px-4 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D6D6D6] dark:border-[#424242] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] hover:bg-[#E8E8E8] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer"
            >
              {isFirstRun ? 'Configurar después' : 'Cancelar'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isChecking || !pathInput.trim()}
              className="h-9 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-2 transition-colors disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>{isSubmitting ? 'Guardando...' : 'Agregar ubicación'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
