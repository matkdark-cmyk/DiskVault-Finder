import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  AppWindow,
  Copy,
  Download,
  ExternalLink,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Info,
  Pencil,
  RefreshCw,
  Trash2,
  WifiOff,
} from 'lucide-react';
import type { ActiveEntryTarget, ContextMenuState } from '../../types';

interface ContextMenuProps {
  menu: ContextMenuState | null;
  onClose: () => void;
  onOpen: (target: ActiveEntryTarget) => void;
  onOpenWith: (target: ActiveEntryTarget) => void;
  onCopyToPc: (target: ActiveEntryTarget) => void;
  onRename: (target: ActiveEntryTarget) => void;
  onMove: (target: ActiveEntryTarget) => void;
  onDelete: (target: ActiveEntryTarget) => void;
  onOpenParentFolder: (target: ActiveEntryTarget) => void;
  onRevealInExplorer: (path: string) => void;
  onCopyPath: (target: ActiveEntryTarget) => void;
  onProperties: (target: ActiveEntryTarget) => void;
  onNewFolder: () => void;
  onRefreshCurrentFolder: () => void;
}

const OFFLINE_HINT = 'El NAS está sin conexión en este momento';

export function ContextMenu({
  menu,
  onClose,
  onOpen,
  onOpenWith,
  onCopyToPc,
  onRename,
  onMove,
  onDelete,
  onOpenParentFolder,
  onRevealInExplorer,
  onCopyPath,
  onProperties,
  onNewFolder,
  onRefreshCurrentFolder,
}: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!menu) {
      setCoords(null);
      return;
    }

    const menuEl = menuRef.current;
    const width = menuEl?.offsetWidth ?? 272;
    const height = menuEl?.offsetHeight ?? 320;
    const padding = 8;

    const left = Math.min(
      Math.max(padding, menu.position.x),
      Math.max(padding, window.innerWidth - width - padding),
    );
    const top = Math.min(
      Math.max(padding, menu.position.y),
      Math.max(padding, window.innerHeight - height - padding),
    );

    setCoords({ left, top });
  }, [menu]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    const handlePointerDown = (event: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    const handleScrollOrResize = (): void => {
      onClose();
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [menu, onClose]);

  if (!menu) {
    return null;
  }

  if (menu.kind === 'background') {
    return (
      <div
        ref={menuRef}
        role="menu"
        aria-label="Opciones de la carpeta actual"
        style={{
          left: coords?.left ?? menu.position.x,
          top: coords?.top ?? menu.position.y,
        }}
        className="fixed z-50 w-72 rounded-lg bg-white dark:bg-[#2B2B2B] border border-[#DCDCDC] dark:border-[#3F3F3F] shadow-xl py-1.5 text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3]"
      >
        <button
          type="button"
          role="menuitem"
          disabled={menu.isOffline}
          title={menu.isOffline ? OFFLINE_HINT : 'Crear una subcarpeta aquí'}
          onClick={() => {
            onNewFolder();
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-[#E5F1FB] dark:hover:bg-[#354656] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          <span className="flex items-center gap-2.5 min-w-0 font-medium">
            <FolderPlus className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <span className="truncate">Nueva carpeta</span>
          </span>
          <span className="text-[11px] text-[#7A7A7A] dark:text-[#999999] shrink-0">
            Ctrl+Shift+N
          </span>
        </button>

        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onRefreshCurrentFolder();
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer"
        >
          <RefreshCw className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
          <span className="truncate">Actualizar carpeta</span>
        </button>

        <div className="my-1 border-t border-[#EFEFEF] dark:border-[#383838]" />

        <button
          type="button"
          role="menuitem"
          disabled={menu.isOffline}
          title={menu.isOffline ? OFFLINE_HINT : undefined}
          onClick={() => {
            onRevealInExplorer(menu.folderPath);
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          <FolderOpen className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
          <span className="truncate">Abrir esta carpeta en el Explorador</span>
        </button>
      </div>
    );
  }

  const { target } = menu;
  const offline = target.is_offline;

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Opciones para ${target.name}`}
      style={{
        left: coords?.left ?? menu.position.x,
        top: coords?.top ?? menu.position.y,
      }}
      className="fixed z-50 w-72 rounded-lg bg-white dark:bg-[#2B2B2B] border border-[#DCDCDC] dark:border-[#3F3F3F] shadow-xl py-1.5 text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3]"
    >
      <div className="px-3 py-1 mb-1 border-b border-[#EFEFEF] dark:border-[#383838] text-[11px] text-[#6E6E6E] dark:text-[#A0A0A0] truncate">
        {target.name}
      </div>

      {/* 1. Abrir / Abrir carpeta */}
      <button
        type="button"
        role="menuitem"
        disabled={!target.is_dir && offline}
        title={!target.is_dir && offline ? OFFLINE_HINT : undefined}
        onClick={() => {
          onOpen(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 font-medium hover:bg-[#E5F1FB] dark:hover:bg-[#354656] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        {target.is_dir ? (
          <FolderOpen className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
        ) : (
          <ExternalLink className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
        )}
        <span className="truncate">
          {target.is_dir ? 'Abrir carpeta' : 'Abrir'}
        </span>
      </button>

      {/* 2. Abrir con... (solo archivos) */}
      {!target.is_dir && (
        <button
          type="button"
          role="menuitem"
          disabled={offline}
          title={offline ? OFFLINE_HINT : 'Elegir aplicación en Windows'}
          onClick={() => {
            onOpenWith(target);
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          <AppWindow className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
          <span className="truncate">Abrir con...</span>
        </button>
      )}

      {/* 3. Copiar al PC... (destacado) */}
      <button
        type="button"
        role="menuitem"
        disabled={offline}
        title={offline ? OFFLINE_HINT : 'Descargar copia rápida hacia el PC'}
        onClick={() => {
          onCopyToPc(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 font-medium text-[#005A9E] dark:text-[#60CDFF] hover:bg-[#E5F1FB] dark:hover:bg-[#23394D] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        <Download className="w-4 h-4 shrink-0" />
        <span className="truncate">Copiar al PC...</span>
      </button>

      <div className="my-1 border-t border-[#EFEFEF] dark:border-[#383838]" />

      {/* 4. Renombrar (F2) */}
      <button
        type="button"
        role="menuitem"
        disabled={offline}
        title={offline ? OFFLINE_HINT : undefined}
        onClick={() => {
          onRename(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Pencil className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
          <span className="truncate">Renombrar</span>
        </span>
        <span className="text-[11px] text-[#7A7A7A] dark:text-[#999999] shrink-0">
          F2
        </span>
      </button>

      {/* 5. Mover a otra carpeta... */}
      <button
        type="button"
        role="menuitem"
        disabled={offline}
        title={offline ? OFFLINE_HINT : undefined}
        onClick={() => {
          onMove(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        <FolderInput className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
        <span className="truncate">Mover a otra carpeta...</span>
      </button>

      {/* 6. Eliminar (Supr) */}
      <button
        type="button"
        role="menuitem"
        disabled={offline}
        title={offline ? OFFLINE_HINT : undefined}
        onClick={() => {
          onDelete(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center justify-between gap-2 text-[#A62215] dark:text-[#FCA5A5] hover:bg-[#FCE8E6] dark:hover:bg-[#402323] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        <span className="flex items-center gap-2.5 min-w-0">
          <Trash2 className="w-4 h-4 shrink-0" />
          <span className="truncate">Eliminar</span>
        </span>
        <span className="text-[11px] opacity-75 shrink-0">Supr</span>
      </button>

      <div className="my-1 border-t border-[#EFEFEF] dark:border-[#383838]" />

      {/* 7. Ir a la carpeta contenedora (desde búsqueda) */}
      {target.from_search && target.parent_path && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onOpenParentFolder(target);
            onClose();
          }}
          className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer"
        >
          <FolderInput className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
          <span className="truncate">Ir a la carpeta contenedora</span>
        </button>
      )}

      {/* 8. Abrir en el Explorador de Windows */}
      <button
        type="button"
        role="menuitem"
        disabled={offline}
        title={offline ? OFFLINE_HINT : undefined}
        onClick={() => {
          onRevealInExplorer(target.full_path);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
      >
        <FolderOpen className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
        <span className="truncate">Abrir en el Explorador de Windows</span>
      </button>

      {/* 9. Copiar ruta completa */}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onCopyPath(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer"
      >
        <Copy className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
        <span className="truncate">Copiar ruta completa</span>
      </button>

      {/* 10. Propiedades */}
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onProperties(target);
          onClose();
        }}
        className="w-full px-3 py-1.5 text-left flex items-center gap-2.5 hover:bg-[#F3F3F3] dark:hover:bg-[#363636] transition-colors cursor-pointer"
      >
        <Info className="w-4 h-4 text-[#555555] dark:text-[#B0B0B0] shrink-0" />
        <span className="truncate">Propiedades</span>
      </button>

      {offline && (
        <div className="mt-1 px-3 pt-1.5 pb-0.5 border-t border-[#EFEFEF] dark:border-[#383838] flex items-center gap-1.5 text-[11px] text-[#8A5300] dark:text-[#FCD34D]">
          <WifiOff className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Sin conexión · Solo caché</span>
        </div>
      )}
    </div>
  );
}
