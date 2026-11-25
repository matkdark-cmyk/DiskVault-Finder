import {
  Download,
  FolderInput,
  FolderPlus,
  Info,
  Pencil,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { ActiveEntryTarget, DirectoryListing, WorkspaceMode } from '../../types';

interface CommandBarProps {
  workspaceMode: WorkspaceMode;
  currentListing: DirectoryListing | null;
  selectedTarget: ActiveEntryTarget | null;
  onNewFolder: () => void;
  onCopyToPc: (target: ActiveEntryTarget) => void;
  onRename: (target: ActiveEntryTarget) => void;
  onMove: (target: ActiveEntryTarget) => void;
  onDelete: (target: ActiveEntryTarget) => void;
  onProperties: (target: ActiveEntryTarget) => void;
}

const OFFLINE_TOOLTIP = 'El NAS está sin conexión en este momento';

export function CommandBar({
  workspaceMode,
  currentListing,
  selectedTarget,
  onNewFolder,
  onCopyToPc,
  onRename,
  onMove,
  onDelete,
  onProperties,
}: CommandBarProps) {
  const isBrowseOffline =
    workspaceMode === 'browse' && (currentListing?.is_offline ?? false);
  const canCreateFolder =
    workspaceMode === 'browse' &&
    currentListing !== null &&
    !currentListing.is_offline;

  const isTargetOffline = selectedTarget?.is_offline ?? false;
  const canMutateTarget = selectedTarget !== null && !isTargetOffline;
  const canCopyTarget = selectedTarget !== null && !isTargetOffline;
  const canInspectTarget = selectedTarget !== null;

  const newFolderTitle = isBrowseOffline
    ? OFFLINE_TOOLTIP
    : workspaceMode !== 'browse' || !currentListing
      ? 'Abre una carpeta para crear una nueva subcarpeta'
      : 'Nueva carpeta (Ctrl+Shift+N)';

  const targetActionTitle = (label: string, shortcut?: string): string => {
    if (!selectedTarget) {
      return `Selecciona un archivo o carpeta para ${label.toLowerCase()}`;
    }
    if (isTargetOffline) {
      return OFFLINE_TOOLTIP;
    }
    return shortcut ? `${label} (${shortcut})` : label;
  };

  return (
    <div
      role="toolbar"
      aria-label="Acciones sobre archivos"
      className="h-9 px-3 border-b border-[#E5E5E5] dark:border-[#2C2C2C] bg-[#F8F8F8] dark:bg-[#222222] flex items-center justify-between gap-3 shrink-0 overflow-x-auto"
    >
      <div className="flex items-center gap-1 min-w-0">
        {/* Nueva carpeta */}
        <button
          type="button"
          onClick={onNewFolder}
          disabled={!canCreateFolder}
          title={newFolderTitle}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
          <span>Nueva carpeta</span>
        </button>

        <div className="h-4 w-px bg-[#DCDCDC] dark:bg-[#383838] mx-1 shrink-0" />

        {/* Copiar al PC */}
        <button
          type="button"
          onClick={() => {
            if (selectedTarget) {
              onCopyToPc(selectedTarget);
            }
          }}
          disabled={!canCopyTarget}
          title={targetActionTitle('Copiar al PC')}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#005A9E] dark:text-[#60CDFF] hover:bg-[#E5F1FB] dark:hover:bg-[#23394D] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          <span>Copiar al PC</span>
        </button>

        <div className="h-4 w-px bg-[#DCDCDC] dark:bg-[#383838] mx-1 shrink-0" />

        {/* Renombrar */}
        <button
          type="button"
          onClick={() => {
            if (selectedTarget) {
              onRename(selectedTarget);
            }
          }}
          disabled={!canMutateTarget}
          title={targetActionTitle('Renombrar', 'F2')}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Pencil className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5] shrink-0" />
          <span>Renombrar</span>
        </button>

        {/* Mover */}
        <button
          type="button"
          onClick={() => {
            if (selectedTarget) {
              onMove(selectedTarget);
            }
          }}
          disabled={!canMutateTarget}
          title={targetActionTitle('Mover a otra carpeta')}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <FolderInput className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5] shrink-0" />
          <span>Mover</span>
        </button>

        {/* Eliminar */}
        <button
          type="button"
          onClick={() => {
            if (selectedTarget) {
              onDelete(selectedTarget);
            }
          }}
          disabled={!canMutateTarget}
          title={targetActionTitle('Eliminar', 'Supr')}
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#A62215] dark:text-[#FCA5A5] hover:bg-[#FCE8E6] dark:hover:bg-[#402323] disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" />
          <span>Eliminar</span>
        </button>

        <div className="h-4 w-px bg-[#DCDCDC] dark:bg-[#383838] mx-1 shrink-0" />

        {/* Propiedades */}
        <button
          type="button"
          onClick={() => {
            if (selectedTarget) {
              onProperties(selectedTarget);
            }
          }}
          disabled={!canInspectTarget}
          title={
            selectedTarget
              ? 'Ver propiedades detalladas'
              : 'Selecciona un elemento para ver sus propiedades'
          }
          className="h-7 px-2.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Info className="w-3.5 h-3.5 text-[#555555] dark:text-[#B5B5B5] shrink-0" />
          <span>Propiedades</span>
        </button>
      </div>

      {/* Right contextual info */}
      <div className="hidden lg:flex items-center gap-2 text-[11.5px] text-[#666666] dark:text-[#9A9A9A] shrink-0">
        {isBrowseOffline || isTargetOffline ? (
          <span className="inline-flex items-center gap-1.5 text-[#8A5300] dark:text-[#FCD34D]">
            <WifiOff className="w-3.5 h-3.5 shrink-0" />
            <span>Sin conexión · Acciones de escritura pausadas</span>
          </span>
        ) : selectedTarget ? (
          <span className="truncate max-w-[260px]">
            Seleccionado:{' '}
            <strong className="font-medium text-[#1A1A1A] dark:text-[#EDEDED]">
              {selectedTarget.name}
            </strong>
          </span>
        ) : null}
      </div>
    </div>
  );
}
