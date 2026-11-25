import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  ChevronRight,
  Folder,
  FolderInput,
  HardDrive,
  Loader2,
  Network,
  WifiOff,
  X,
} from 'lucide-react';
import type { ActiveEntryTarget, DirectoryListing, WatchedRoot } from '../../types';
import { extractErrorMessage, listDirectory } from '../../utils/tauri';

interface MoveEntryModalProps {
  target: ActiveEntryTarget | null;
  roots: WatchedRoot[];
  onClose: () => void;
  onConfirm: (sourcePath: string, destFolderPath: string) => Promise<void>;
}

function normalizeCmp(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export function MoveEntryModal({
  target,
  roots,
  onClose,
  onConfirm,
}: MoveEntryModalProps) {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [browseError, setBrowseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isMoving, setIsMoving] = useState(false);

  const loadFolder = useCallback(async (folderPath: string): Promise<void> => {
    setIsLoading(true);
    setBrowseError(null);
    setSubmitError(null);
    try {
      const next = await listDirectory(folderPath);
      setListing(next);
    } catch (err) {
      setBrowseError(extractErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!target) {
      setListing(null);
      setBrowseError(null);
      setSubmitError(null);
      setIsMoving(false);
      return;
    }

    const startRoot =
      roots.find((r) => r.id === target.root_id) ?? roots[0] ?? null;
    if (startRoot) {
      void loadFolder(startRoot.path);
    }
  }, [target, roots, loadFolder]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isMoving) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, isMoving, onClose]);

  const subfolders = useMemo(() => {
    if (!listing || !target) {
      return [];
    }
    const targetNorm = normalizeCmp(target.full_path);
    return listing.items.filter((item) => {
      if (!item.is_dir) {
        return false;
      }
      // Evitar mostrar la carpeta que se está moviendo para no navegar dentro de sí misma
      if (target.is_dir && normalizeCmp(item.full_path) === targetNorm) {
        return false;
      }
      return true;
    });
  }, [listing, target]);

  if (!target) {
    return null;
  }

  const destValidation = (() => {
    if (!listing) {
      return { valid: false, reason: 'Selecciona una carpeta de destino.' };
    }
    if (listing.is_offline) {
      return {
        valid: false,
        reason: 'La ubicación seleccionada está sin conexión.',
      };
    }
    const destNorm = normalizeCmp(listing.current_path);
    const parentNorm = normalizeCmp(target.parent_path);
    const sourceNorm = normalizeCmp(target.full_path);

    if (destNorm === parentNorm) {
      return {
        valid: false,
        reason: 'Este elemento ya se encuentra en esta carpeta.',
      };
    }
    if (
      target.is_dir &&
      (destNorm === sourceNorm || destNorm.startsWith(`${sourceNorm}\\`))
    ) {
      return {
        valid: false,
        reason: 'No puedes mover una carpeta dentro de sí misma.',
      };
    }
    return { valid: true, reason: null };
  })();

  const handleConfirmMove = async (): Promise<void> => {
    if (!listing || !destValidation.valid) {
      return;
    }
    setIsMoving(true);
    setSubmitError(null);
    try {
      await onConfirm(target.full_path, listing.current_path);
      onClose();
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isMoving) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-modal-title"
        className="w-full max-w-2xl rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden flex flex-col max-h-[82vh]"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderInput className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <div className="min-w-0">
              <h2
                id="move-modal-title"
                className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
              >
                Mover "{target.name}"
              </h2>
              <p className="text-[11.5px] text-[#666666] dark:text-[#A0A0A0] truncate">
                Elige la carpeta de destino dentro de tus ubicaciones configuradas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isMoving}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body: Left roots list + Right folder browser */}
        <div className="flex-1 min-h-0 flex border-b border-[#EAEAEA] dark:border-[#333333]">
          {/* Roots column */}
          <div className="w-48 shrink-0 border-r border-[#EAEAEA] dark:border-[#333333] bg-[#F8F8F8] dark:bg-[#1F1F1F] p-2 overflow-y-auto">
            <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-[#707070] dark:text-[#969696]">
              Ubicaciones
            </div>
            <div className="mt-1 space-y-0.5">
              {roots.map((root) => {
                const isActive = listing?.root_id === root.id;
                const Icon = root.is_network ? Network : HardDrive;
                return (
                  <button
                    key={root.id}
                    type="button"
                    disabled={isMoving}
                    onClick={() => void loadFolder(root.path)}
                    className={`w-full px-2 py-1.5 rounded-md text-left text-[12.5px] flex items-center gap-2 transition-colors cursor-pointer ${
                      isActive
                        ? 'bg-[#E5F1FB] dark:bg-[#253B4E] text-[#005A9E] dark:text-[#7CD4FF] font-medium'
                        : 'text-[#1A1A1A] dark:text-[#E5E5E5] hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate flex-1">{root.name}</span>
                    {root.status === 'offline' && (
                      <WifiOff className="w-3 h-3 text-[#B45309] dark:text-[#FBBF24] shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Subfolders pane */}
          <div className="flex-1 min-w-0 flex flex-col">
            {/* Breadcrumb bar */}
            <div className="px-3 py-2 border-b border-[#EAEAEA] dark:border-[#333333] bg-[#FAFAFA] dark:bg-[#212121] flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={!listing?.parent_path || isLoading || isMoving}
                onClick={() => {
                  if (listing?.parent_path) {
                    void loadFolder(listing.parent_path);
                  }
                }}
                title="Subir un nivel"
                className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-[#DCDCDC] dark:border-[#3D3D3D] bg-white dark:bg-[#2A2A2A] hover:bg-[#F3F3F3] dark:hover:bg-[#353535] disabled:opacity-40 disabled:pointer-events-none cursor-pointer shrink-0"
              >
                <ArrowUp className="w-3.5 h-3.5" />
              </button>

              <div className="flex items-center gap-0.5 overflow-x-auto min-w-0 text-[12px]">
                {listing ? (
                  listing.breadcrumbs.map((seg, idx) => (
                    <div key={seg.path} className="flex items-center shrink-0">
                      {idx > 0 && (
                        <ChevronRight className="w-3.5 h-3.5 text-[#909090] mx-0.5 shrink-0" />
                      )}
                      <button
                        type="button"
                        disabled={isMoving}
                        onClick={() => void loadFolder(seg.path)}
                        className={`px-1.5 py-0.5 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                          idx === listing.breadcrumbs.length - 1
                            ? 'font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]'
                            : 'text-[#555555] dark:text-[#B0B0B0]'
                        }`}
                      >
                        {seg.name}
                      </button>
                    </div>
                  ))
                ) : (
                  <span className="text-[#707070] dark:text-[#989898]">
                    Cargando ubicación...
                  </span>
                )}
              </div>
            </div>

            {/* Folder list */}
            <div className="flex-1 overflow-y-auto min-h-[220px] p-2">
              {isLoading ? (
                <div className="h-full flex items-center justify-center gap-2 text-[12.5px] text-[#666666] dark:text-[#A0A0A0]">
                  <Loader2 className="w-4 h-4 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
                  <span>Leyendo subcarpetas...</span>
                </div>
              ) : browseError ? (
                <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[12.5px] text-[#C42B1C] dark:text-[#FCA5A5]">
                  <AlertCircle className="w-5 h-5 mb-1.5" />
                  <span>{browseError}</span>
                </div>
              ) : subfolders.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-4 text-center text-[12.5px] text-[#666666] dark:text-[#9E9E9E]">
                  <Folder className="w-6 h-6 mb-1.5 opacity-60" />
                  <span>No hay subcarpetas aquí. Puedes mover el elemento a esta carpeta.</span>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {subfolders.map((folder) => (
                    <button
                      key={folder.full_path}
                      type="button"
                      disabled={isMoving}
                      onClick={() => void loadFolder(folder.full_path)}
                      className="w-full px-2.5 py-2 rounded-md text-left flex items-center justify-between gap-2 text-[12.5px] text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-[#F0F7FD] dark:hover:bg-[#28333D] transition-colors cursor-pointer"
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Folder className="w-4 h-4 text-[#D99B26] dark:text-[#F0B849] shrink-0" />
                        <span className="truncate font-medium">{folder.name}</span>
                      </span>
                      <ChevronRight className="w-3.5 h-3.5 text-[#8A8A8A] shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 bg-[#FAFAFA] dark:bg-[#202020] space-y-2.5 shrink-0">
          {listing && (
            <div className="text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3] flex items-center gap-2 truncate">
              <span className="shrink-0">Destino:</span>
              <span className="font-mono text-[#1A1A1A] dark:text-[#EDEDED] truncate">
                {listing.current_path}
              </span>
            </div>
          )}

          {(submitError || (!destValidation.valid && destValidation.reason)) && (
            <p className="text-[12px] text-[#B45309] dark:text-[#FBBF24]">
              {submitError ?? destValidation.reason}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isMoving}
              className="h-8 px-3.5 rounded-md bg-white dark:bg-[#2E2E2E] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#F3F3F3] dark:hover:bg-[#383838] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirmMove()}
              disabled={!destValidation.valid || isMoving || isLoading}
              className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              {isMoving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Mover aquí</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
