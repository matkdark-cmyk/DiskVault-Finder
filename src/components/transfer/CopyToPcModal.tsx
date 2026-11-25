import { useEffect, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Download,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Monitor,
  X,
} from 'lucide-react';
import type {
  ActiveEntryTarget,
  ConflictPolicy,
  CopyPreflightDto,
  PcQuickFoldersDto,
} from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import { formatBytes } from '../../utils/format';
import {
  extractErrorMessage,
  getPcQuickFolders,
  pickFolderDialog,
  preflightCopyToPc,
} from '../../utils/tauri';

interface CopyToPcModalProps {
  target: ActiveEntryTarget | null;
  isTauri: boolean;
  hasRunningTransfer: boolean;
  onClose: () => void;
  onStartCopy: (
    sourcePaths: string[],
    destDir: string,
    conflictPolicy: ConflictPolicy,
  ) => void;
}

export function CopyToPcModal({
  target,
  isTauri,
  hasRunningTransfer,
  onClose,
  onStartCopy,
}: CopyToPcModalProps) {
  const [quickFolders, setQuickFolders] = useState<PcQuickFoldersDto>({
    desktop_dir: null,
    downloads_dir: null,
    documents_dir: null,
  });
  const [destDir, setDestDir] = useState('');
  const [conflictPolicy, setConflictPolicy] =
    useState<ConflictPolicy>('KeepBoth');
  const [preflight, setPreflight] = useState<CopyPreflightDto | null>(null);
  const [isLoadingPreflight, setIsLoadingPreflight] = useState(false);
  const [preflightError, setPreflightError] = useState<string | null>(null);

  // Cargar carpetas rápidas del PC al abrir el modal
  useEffect(() => {
    if (!target) {
      setPreflight(null);
      setPreflightError(null);
      setDestDir('');
      setConflictPolicy('KeepBoth');
      return;
    }

    let cancelled = false;
    void getPcQuickFolders()
      .then((folders) => {
        if (cancelled) {
          return;
        }
        setQuickFolders(folders);
        const defaultDest =
          folders.desktop_dir ??
          folders.downloads_dir ??
          folders.documents_dir ??
          '';
        setDestDir(defaultDest);
      })
      .catch(() => {
        // Si falla la consulta de carpetas rápidas, el usuario puede elegir manualmente
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  // Ejecutar preflight cada vez que cambia el destino
  useEffect(() => {
    if (!target || !destDir.trim()) {
      setPreflight(null);
      return;
    }

    let cancelled = false;
    setIsLoadingPreflight(true);
    setPreflightError(null);

    void preflightCopyToPc([target.full_path], destDir.trim())
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPreflight(result);
        setQuickFolders(result.quick_folders);
        setIsLoadingPreflight(false);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setPreflight(null);
        setPreflightError(extractErrorMessage(err));
        setIsLoadingPreflight(false);
      });

    return () => {
      cancelled = true;
    };
  }, [target, destDir]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, onClose]);

  if (!target) {
    return null;
  }

  const handleBrowseFolder = async (): Promise<void> => {
    try {
      const picked = await pickFolderDialog(
        'Seleccionar carpeta de destino en el PC',
      );
      if (picked) {
        setDestDir(picked);
      }
    } catch (err) {
      setPreflightError(extractErrorMessage(err));
    }
  };

  const quickButtons: Array<{
    id: string;
    label: string;
    path: string | null;
    icon: typeof Monitor;
  }> = [
    {
      id: 'desktop',
      label: 'Escritorio',
      path: quickFolders.desktop_dir,
      icon: Monitor,
    },
    {
      id: 'downloads',
      label: 'Descargas',
      path: quickFolders.downloads_dir,
      icon: Download,
    },
    {
      id: 'documents',
      label: 'Documentos',
      path: quickFolders.documents_dir,
      icon: FileText,
    },
  ];

  const hasEnoughSpace = preflight ? preflight.has_enough_space : true;
  const canStart =
    !hasRunningTransfer &&
    !isLoadingPreflight &&
    destDir.trim().length > 0 &&
    preflight !== null &&
    hasEnoughSpace &&
    preflightError === null;

  const handleConfirm = (): void => {
    if (!canStart) {
      return;
    }
    onStartCopy([target.full_path], destDir.trim(), conflictPolicy);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-pc-title"
        className="w-full max-w-lg rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Download className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <h2
              id="copy-pc-title"
              className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Copiar al PC
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Source item card */}
          <div className="p-3 rounded-lg bg-[#F7F7F7] dark:bg-[#1E1E1E] border border-[#E5E5E5] dark:border-[#333333] flex items-start gap-3">
            <EntryIcon category={target.category} className="w-6 h-6 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate">
                {target.name}
              </div>
              <div className="mt-0.5 font-mono text-[11px] text-[#6E6E6E] dark:text-[#969696] truncate">
                {target.full_path}
              </div>
            </div>
          </div>

          {/* Quick destination buttons */}
          <div className="space-y-2">
            <div className="text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED]">
              Carpeta de destino en este PC
            </div>
            <div className="grid grid-cols-3 gap-2">
              {quickButtons.map((btn) => {
                const Icon = btn.icon;
                const isSelected =
                  btn.path !== null &&
                  destDir.trim().toLowerCase() === btn.path.toLowerCase();
                return (
                  <button
                    key={btn.id}
                    type="button"
                    disabled={!btn.path}
                    onClick={() => {
                      if (btn.path) {
                        setDestDir(btn.path);
                      }
                    }}
                    className={`h-9 px-2.5 rounded-md border text-[12px] font-medium inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
                      isSelected
                        ? 'bg-[#E5F1FB] dark:bg-[#223B50] border-[#0067C0] dark:border-[#60CDFF] text-[#005A9E] dark:text-[#7CD4FF]'
                        : 'bg-white dark:bg-[#1E1E1E] border-[#D6D6D6] dark:border-[#3D3D3D] text-[#1A1A1A] dark:text-[#E5E5E5] hover:bg-[#F5F5F5] dark:hover:bg-[#2B2B2B]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">{btn.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={destDir}
                onChange={(event) => setDestDir(event.target.value)}
                placeholder="Ej. C:\Users\Usuario\Desktop"
                aria-label="Ruta de destino en el PC"
                className="flex-1 min-w-0 h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none font-mono text-[12px] text-[#1A1A1A] dark:text-[#F0F0F0]"
              />
              <button
                type="button"
                disabled={!isTauri}
                onClick={() => void handleBrowseFolder()}
                className="h-9 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer disabled:opacity-40"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Elegir otra...</span>
              </button>
            </div>
          </div>

          {/* Preflight metrics & disk free space */}
          {isLoadingPreflight ? (
            <div className="p-3 rounded-lg bg-[#F8F8F8] dark:bg-[#1F1F1F] border border-[#E5E5E5] dark:border-[#333333] flex items-center gap-2 text-[12px] text-[#5C5C5C] dark:text-[#A3A3A3]">
              <Loader2 className="w-4 h-4 animate-spin text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
              <span>Calculando tamaño total y verificando espacio libre en el PC...</span>
            </div>
          ) : preflightError ? (
            <div className="p-3 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#9A1F14] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{preflightError}</span>
            </div>
          ) : preflight ? (
            <div className="space-y-3">
              <div className="p-3 rounded-lg bg-[#F8F8F8] dark:bg-[#1F1F1F] border border-[#E5E5E5] dark:border-[#333333] space-y-1.5 text-[12px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#5C5C5C] dark:text-[#A3A3A3]">
                    Tamaño a copiar
                  </span>
                  <span className="font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] tabular-nums">
                    {formatBytes(preflight.total_bytes)} ·{' '}
                    {preflight.total_files.toLocaleString('es-ES')}{' '}
                    {preflight.total_files === 1 ? 'archivo' : 'archivos'}
                    {preflight.total_dirs > 0
                      ? ` · ${preflight.total_dirs.toLocaleString('es-ES')} ${
                          preflight.total_dirs === 1 ? 'carpeta' : 'carpetas'
                        }`
                      : ''}
                  </span>
                </div>

                {preflight.dest_free_bytes !== null && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[#5C5C5C] dark:text-[#A3A3A3] inline-flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 shrink-0" />
                      <span>Espacio libre en disco destino</span>
                    </span>
                    <span
                      className={`font-semibold tabular-nums ${
                        preflight.has_enough_space
                          ? 'text-[#15803D] dark:text-[#4ADE80]'
                          : 'text-[#C42B1C] dark:text-[#F87171]'
                      }`}
                    >
                      {formatBytes(preflight.dest_free_bytes)}
                      {preflight.dest_total_bytes !== null
                        ? ` de ${formatBytes(preflight.dest_total_bytes)}`
                        : ''}
                    </span>
                  </div>
                )}
              </div>

              {!preflight.has_enough_space && (
                <div className="p-3 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#9A1F14] dark:text-[#FCA5A5]">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    No hay suficiente espacio libre en la unidad destino del PC (se requiere el tamaño total más 50 MB de margen). Elige otro disco o libera espacio.
                  </span>
                </div>
              )}

              {/* Conflict selector when destination already has matching names */}
              {preflight.conflicting_names.length > 0 && (
                <div className="p-3 rounded-lg bg-[#FFFBEB] dark:bg-[#2A2213] border border-[#EBD6A7] dark:border-[#4D3B1B] space-y-2">
                  <div className="flex items-start gap-2 text-[12px] text-[#8A5300] dark:text-[#FCD34D]">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <div>
                      <span className="font-semibold">
                        Ya existe un elemento con el mismo nombre en destino:
                      </span>{' '}
                      <span className="font-mono">
                        {preflight.conflicting_names.slice(0, 3).join(', ')}
                        {preflight.conflicting_names.length > 3
                          ? ` (+${preflight.conflicting_names.length - 3} más)`
                          : ''}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 pl-6 text-[12px] text-[#1A1A1A] dark:text-[#EDEDED]">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="conflictPolicy"
                        checked={conflictPolicy === 'KeepBoth'}
                        onChange={() => setConflictPolicy('KeepBoth')}
                        className="accent-[#0067C0]"
                      />
                      <span>Conservar ambos (renombrar copia automáticamente)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="conflictPolicy"
                        checked={conflictPolicy === 'Overwrite'}
                        onChange={() => setConflictPolicy('Overwrite')}
                        className="accent-[#0067C0]"
                      />
                      <span>Sobrescribir los archivos existentes</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="conflictPolicy"
                        checked={conflictPolicy === 'Skip'}
                        onChange={() => setConflictPolicy('Skip')}
                        className="accent-[#0067C0]"
                      />
                      <span>Omitir archivos que ya existen</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {hasRunningTransfer && (
            <div className="p-2.5 rounded-lg bg-[#FFFBEB] dark:bg-[#2A2213] border border-[#EBD6A7] dark:border-[#4D3B1B] text-[12px] text-[#8A5300] dark:text-[#FCD34D]">
              Ya hay una transferencia al PC en curso. Espera a que termine o cancélala antes de iniciar otra.
            </div>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={!canStart}
              onClick={handleConfirm}
              className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Iniciar copia</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
