import { useState } from 'react';
import {
  FolderPlus,
  HardDrive,
  Layers,
  Loader2,
  RefreshCw,
  Server,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { IndexProgress, WatchedRoot } from '../../types';
import { getRootStatusLabel } from '../../utils/format';

interface SidebarRootsProps {
  roots: WatchedRoot[];
  selectedRootId: number | null;
  indexProgress: IndexProgress;
  onSelectRoot: (rootId: number | null) => void;
  onOpenAddRoot: () => void;
  onRefreshRoot: (id: number) => void;
  onRemoveRoot: (id: number) => Promise<void>;
}

export function SidebarRoots({
  roots,
  selectedRootId,
  indexProgress,
  onSelectRoot,
  onOpenAddRoot,
  onRefreshRoot,
  onRemoveRoot,
}: SidebarRootsProps) {
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const totalItems = roots.reduce((acc, r) => acc + r.item_count, 0);

  const handleConfirmDelete = async (id: number): Promise<void> => {
    setDeletingId(id);
    try {
      await onRemoveRoot(id);
    } finally {
      setDeletingId(null);
      setConfirmingDeleteId(null);
    }
  };

  return (
    <aside className="w-64 shrink-0 bg-[#F3F3F3] dark:bg-[#252525] border-r border-[#E2E2E2] dark:border-[#323232] flex flex-col h-full">
      {/* Brand header */}
      <div className="px-3.5 pt-3 pb-2.5 flex items-center gap-2.5 border-b border-[#E6E6E6] dark:border-[#313131]">
        <img
          src="/icon.svg"
          alt="Ícono de lupa de DiskVault Finder"
          className="w-6 h-6 shrink-0"
        />
        <span className="text-[13.5px] font-semibold tracking-tight text-[#1A1A1A] dark:text-[#F5F5F5] whitespace-nowrap truncate">
          DiskVault Finder
        </span>
      </div>

      {/* Locations navigation list */}
      <nav
        className="flex-1 overflow-y-auto px-2 py-2.5 space-y-4"
        aria-label="Ubicaciones del NAS"
      >
        <div>
          <button
            type="button"
            onClick={() => onSelectRoot(null)}
            className={`w-full px-2.5 py-2 rounded-md flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
              selectedRootId === null
                ? 'bg-[#E5F1FB] dark:bg-[#2C3A47] text-[#005A9E] dark:text-[#7CD4FF] font-medium'
                : 'text-[#1F1F1F] dark:text-[#E8E8E8] hover:bg-[#E9E9E9] dark:hover:bg-[#303030]'
            }`}
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Layers className="w-4 h-4 shrink-0" />
              <span className="truncate text-[13px]">Todas las ubicaciones</span>
            </span>
            <span className="text-[11.5px] tabular-nums text-[#666666] dark:text-[#9E9E9E] shrink-0">
              {totalItems > 0 ? totalItems.toLocaleString('es-ES') : roots.length}
            </span>
          </button>
        </div>

        <div>
          <div className="px-2.5 pb-1.5 text-[11.5px] font-medium text-[#666666] dark:text-[#9E9E9E]">
            Carpetas del NAS y discos
          </div>

          {roots.length === 0 ? (
            <div className="px-2.5 py-2 text-[12px] text-[#737373] dark:text-[#8E8E8E] leading-relaxed">
              Aún no hay ubicaciones configuradas. Agrega una carpeta de red o disco local para comenzar.
            </div>
          ) : (
            <ul className="space-y-1">
              {roots.map((root) => {
                const isSelected = selectedRootId === root.id;
                const isConfirming = confirmingDeleteId === root.id;
                const isDeleting = deletingId === root.id;
                const isThisRootIndexing =
                  (indexProgress.is_running &&
                    indexProgress.current_root_id === root.id) ||
                  root.status === 'indexing';
                const isOffline = root.status === 'offline';

                const isPaused = !root.enabled;
                const statusColor = isThisRootIndexing
                  ? 'text-[#0067C0] dark:text-[#60CDFF]'
                  : isPaused
                    ? 'text-[#737373] dark:text-[#8E8E8E]'
                    : root.status === 'ready'
                      ? 'text-[#15803D] dark:text-[#4ADE80]'
                      : isOffline
                        ? 'text-[#B45309] dark:text-[#FBBF24]'
                        : root.status === 'error'
                          ? 'text-[#B91C1C] dark:text-[#F87171]'
                          : 'text-[#666666] dark:text-[#9E9E9E]';

                return (
                  <li key={root.id} className="group">
                    <div
                      className={`rounded-md transition-colors ${
                        isSelected
                          ? 'bg-[#E5F1FB] dark:bg-[#2C3A47]'
                          : 'hover:bg-[#E9E9E9] dark:hover:bg-[#303030]'
                      } ${isPaused ? 'opacity-70' : ''}`}
                    >
                      <div className="flex items-start gap-0.5 pr-1">
                        <button
                          type="button"
                          onClick={() => onSelectRoot(root.id)}
                          className="flex-1 min-w-0 px-2.5 py-2 text-left flex items-start gap-2.5 cursor-pointer"
                          title={root.path}
                        >
                          {isThisRootIndexing ? (
                            <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
                          ) : isOffline ? (
                            <WifiOff className="w-4 h-4 mt-0.5 shrink-0 text-[#B45309] dark:text-[#FBBF24]" />
                          ) : root.is_network ? (
                            <Server
                              className={`w-4 h-4 mt-0.5 shrink-0 ${
                                isSelected
                                  ? 'text-[#0067C0] dark:text-[#60CDFF]'
                                  : 'text-[#555555] dark:text-[#A8A8A8]'
                              }`}
                            />
                          ) : (
                            <HardDrive
                              className={`w-4 h-4 mt-0.5 shrink-0 ${
                                isSelected
                                  ? 'text-[#0067C0] dark:text-[#60CDFF]'
                                  : 'text-[#555555] dark:text-[#A8A8A8]'
                              }`}
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div
                              className={`text-[13px] truncate leading-tight ${
                                isSelected
                                  ? 'font-semibold text-[#005A9E] dark:text-[#7CD4FF]'
                                  : 'font-medium text-[#1A1A1A] dark:text-[#EFEFEF]'
                              }`}
                            >
                              {root.name}
                            </div>
                            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] truncate">
                              <span className={statusColor}>
                                {isThisRootIndexing
                                  ? 'Indexando...'
                                  : isPaused
                                    ? 'Pausada'
                                    : getRootStatusLabel(root.status)}
                              </span>
                              <span aria-hidden="true" className="text-[#9E9E9E]">
                                ·
                              </span>
                              <span className="text-[#6E6E6E] dark:text-[#9A9A9A] tabular-nums">
                                {root.item_count.toLocaleString('es-ES')} elem.
                              </span>
                            </div>
                          </div>
                        </button>

                        {!isConfirming && (
                          <div className="mt-1.5 flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                            <button
                              type="button"
                              disabled={indexProgress.is_running}
                              onClick={() => onRefreshRoot(root.id)}
                              title={`Actualizar caché de "${root.name}"`}
                              aria-label={`Actualizar ubicación ${root.name}`}
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-[#6B6B6B] dark:text-[#A0A0A0] hover:text-[#0067C0] dark:hover:text-[#60CDFF] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              disabled={indexProgress.is_running}
                              onClick={() => setConfirmingDeleteId(root.id)}
                              title={`Quitar "${root.name}"`}
                              aria-label={`Quitar ubicación ${root.name}`}
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-[#6B6B6B] dark:text-[#A0A0A0] hover:text-[#B91C1C] dark:hover:text-[#F87171] hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-40"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </div>

                      {isConfirming && (
                        <div className="px-2.5 pb-2 pt-1 flex items-center justify-between gap-2 border-t border-black/5 dark:border-white/10">
                          <span className="text-[11px] text-[#555555] dark:text-[#BDBDBD]">
                            ¿Quitar de la lista?
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => setConfirmingDeleteId(null)}
                              className="px-2 py-0.5 rounded text-[11px] text-[#444444] dark:text-[#CCCCCC] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                            >
                              Cancelar
                            </button>
                            <button
                              type="button"
                              disabled={isDeleting}
                              onClick={() => void handleConfirmDelete(root.id)}
                              className="px-2 py-0.5 rounded text-[11px] font-medium bg-[#C42B1C] text-white hover:bg-[#A62215] disabled:opacity-60 cursor-pointer"
                            >
                              {isDeleting ? 'Quitando...' : 'Quitar'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </nav>

      {/* Add location button */}
      <div className="p-2.5 border-t border-[#E2E2E2] dark:border-[#323232]">
        <button
          type="button"
          onClick={onOpenAddRoot}
          className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#2E2E2E] border border-[#D4D4D4] dark:border-[#3E3E3E] hover:bg-[#FAFAFA] dark:hover:bg-[#363636] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F3F3F3] inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
        >
          <FolderPlus className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF]" />
          <span>Agregar carpeta</span>
        </button>
      </div>
    </aside>
  );
}
