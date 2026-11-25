import { Loader2 } from 'lucide-react';
import type {
  DirectoryListing,
  IndexProgress,
  SearchFilter,
  ThemeMode,
  WorkspaceMode,
} from '../../types';
import { getFilterLabel, getThemeLabel } from '../../utils/format';

interface StatusBarProps {
  rootCount: number;
  workspaceMode: WorkspaceMode;
  currentListing: DirectoryListing | null;
  totalMatches: number;
  elapsedMs: number;
  selectedLabel: string | null;
  isPortable: boolean;
  isTauri: boolean;
  searchFilter: SearchFilter;
  themeMode: ThemeMode;
  indexProgress: IndexProgress;
  onCancelIndexing: () => void;
}

export function StatusBar({
  rootCount,
  workspaceMode,
  currentListing,
  totalMatches,
  elapsedMs,
  selectedLabel,
  isPortable,
  isTauri,
  searchFilter,
  themeMode,
  indexProgress,
  onCancelIndexing,
}: StatusBarProps) {
  return (
    <footer className="h-7 shrink-0 bg-[#F3F3F3] dark:bg-[#202020] border-t border-[#E2E2E2] dark:border-[#323232] px-3.5 flex items-center justify-between gap-4 text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3]">
      <div className="flex items-center gap-2 min-w-0 truncate">
        {indexProgress.is_running ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <span className="truncate text-[#1A1A1A] dark:text-[#EAEAEA]">
              {indexProgress.phase === 'writing'
                ? `Guardando caché de "${indexProgress.current_root_name ?? 'ubicación'}"...`
                : `Indexando "${indexProgress.current_root_name ?? 'ubicaciones'}"...`}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums shrink-0">
              {indexProgress.items_scanned.toLocaleString('es-ES')} elementos
            </span>
            <button
              type="button"
              onClick={onCancelIndexing}
              className="ml-1 text-[#0067C0] dark:text-[#60CDFF] hover:underline font-medium shrink-0 cursor-pointer"
            >
              Cancelar
            </button>
          </>
        ) : workspaceMode === 'browse' && currentListing ? (
          <>
            <span className="tabular-nums shrink-0">
              {currentListing.items.length.toLocaleString('es-ES')}{' '}
              {currentListing.items.length === 1 ? 'elemento' : 'elementos'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {currentListing.source === 'live'
                ? 'Lectura en vivo'
                : 'Caché local (Sin conexión)'}
            </span>
            {selectedLabel && (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate text-[#1A1A1A] dark:text-[#E5E5E5]">
                  {selectedLabel}
                </span>
              </>
            )}
          </>
        ) : (
          <>
            <span className="tabular-nums shrink-0">
              {rootCount === 1 ? '1 ubicación' : `${rootCount} ubicaciones`}
            </span>
            {rootCount > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums shrink-0">
                  {totalMatches.toLocaleString('es-ES')}{' '}
                  {totalMatches === 1 ? 'resultado' : 'resultados'}
                </span>
                <span aria-hidden="true">·</span>
                <span className="tabular-nums font-mono shrink-0">
                  {elapsedMs} ms
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="truncate">Filtro: {getFilterLabel(searchFilter)}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {isTauri ? (
          <span>{isPortable ? 'Modo Portable' : 'Modo Instalado'}</span>
        ) : (
          <span>Vista previa web</span>
        )}
        <span aria-hidden="true">·</span>
        <span>{getThemeLabel(themeMode)}</span>
      </div>
    </footer>
  );
}
