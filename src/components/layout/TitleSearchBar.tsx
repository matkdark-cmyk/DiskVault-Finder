import type { RefObject } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  FolderOpen,
  HardDrive,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Search,
  Server,
  Settings,
  Square,
  X,
} from 'lucide-react';
import type {
  DirectoryListing,
  SearchFilter,
  ViewMode,
  WatchedRoot,
  WorkspaceMode,
} from '../../types';
import { Breadcrumbs } from '../explorer/Breadcrumbs';

interface TitleSearchBarProps {
  searchInputRef: RefObject<HTMLInputElement | null>;
  selectedRoot: WatchedRoot | null;
  workspaceMode: WorkspaceMode;
  currentListing: DirectoryListing | null;
  canGoBack: boolean;
  canGoForward: boolean;
  canGoUp: boolean;
  viewMode: ViewMode;
  searchQuery: string;
  searchFilter: SearchFilter;
  isIndexing: boolean;
  isSettingsOpen: boolean;
  hasUpdateAvailable: boolean;
  onGoBack: () => void;
  onGoForward: () => void;
  onGoUp: () => void;
  onNavigateBreadcrumb: (path: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  onSearchQueryChange: (value: string) => void;
  onSearchFilterChange: (filter: SearchFilter) => void;
  onRefreshClick: () => void;
  onCancelIndexingClick: () => void;
  onOpenSettings: () => void;
}

const FILTER_OPTIONS: ReadonlyArray<{ id: SearchFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'file', label: 'Archivos' },
  { id: 'video', label: 'Videos' },
  { id: 'folder', label: 'Carpetas' },
];

export function TitleSearchBar({
  searchInputRef,
  selectedRoot,
  workspaceMode,
  currentListing,
  canGoBack,
  canGoForward,
  canGoUp,
  viewMode,
  searchQuery,
  searchFilter,
  isIndexing,
  isSettingsOpen,
  hasUpdateAvailable,
  onGoBack,
  onGoForward,
  onGoUp,
  onNavigateBreadcrumb,
  onViewModeChange,
  onSearchQueryChange,
  onSearchFilterChange,
  onRefreshClick,
  onCancelIndexingClick,
  onOpenSettings,
}: TitleSearchBarProps) {
  const showBreadcrumbs =
    workspaceMode === 'browse' &&
    currentListing !== null &&
    currentListing.breadcrumbs.length > 0;

  return (
    <header className="shrink-0 bg-[#F3F3F3] dark:bg-[#202020] border-b border-[#E2E2E2] dark:border-[#323232] px-3 py-2">
      <div className="flex flex-wrap lg:flex-nowrap items-center gap-2">
        {/* Live Explorer navigation buttons */}
        <div
          className="flex items-center gap-0.5 shrink-0"
          role="group"
          aria-label="Navegación de carpetas"
        >
          <button
            type="button"
            disabled={!canGoBack}
            onClick={onGoBack}
            title="Atrás (Alt+Izquierda)"
            className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
              canGoBack
                ? 'text-[#1F1F1F] dark:text-[#EDEDED] hover:bg-[#E6E6E6] dark:hover:bg-[#313131] cursor-pointer'
                : 'text-[#9A9A9A] dark:text-[#5C5C5C] cursor-not-allowed'
            }`}
            aria-label="Atrás"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canGoForward}
            onClick={onGoForward}
            title="Adelante (Alt+Derecha)"
            className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
              canGoForward
                ? 'text-[#1F1F1F] dark:text-[#EDEDED] hover:bg-[#E6E6E6] dark:hover:bg-[#313131] cursor-pointer'
                : 'text-[#9A9A9A] dark:text-[#5C5C5C] cursor-not-allowed'
            }`}
            aria-label="Adelante"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            type="button"
            disabled={!canGoUp}
            onClick={onGoUp}
            title="Subir un nivel (Alt+Arriba)"
            className={`h-8 w-8 inline-flex items-center justify-center rounded-md transition-colors ${
              canGoUp
                ? 'text-[#1F1F1F] dark:text-[#EDEDED] hover:bg-[#E6E6E6] dark:hover:bg-[#313131] cursor-pointer'
                : 'text-[#9A9A9A] dark:text-[#5C5C5C] cursor-not-allowed'
            }`}
            aria-label="Subir"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>

        {/* Address / Breadcrumbs bar */}
        <div
          className="hidden xl:flex items-center gap-1.5 min-w-[230px] max-w-[380px] h-8 px-2.5 rounded-md bg-white dark:bg-[#2A2A2A] border border-[#DCDCDC] dark:border-[#3B3B3B] text-[#1A1A1A] dark:text-[#EDEDED] overflow-hidden shrink-0"
          title={
            currentListing && workspaceMode === 'browse'
              ? currentListing.current_path
              : selectedRoot
                ? selectedRoot.path
                : 'Todas las ubicaciones configuradas'
          }
        >
          {showBreadcrumbs && currentListing ? (
            <Breadcrumbs
              segments={currentListing.breadcrumbs}
              isNetwork={selectedRoot?.is_network ?? false}
              onNavigate={onNavigateBreadcrumb}
            />
          ) : selectedRoot ? (
            <>
              {selectedRoot.is_network ? (
                <Server className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
              ) : (
                <HardDrive className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
              )}
              <span className="truncate text-[12.5px] font-medium">
                {selectedRoot.name}
              </span>
            </>
          ) : (
            <>
              <FolderOpen className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
              <span className="truncate text-[12.5px] font-medium">
                Todas las ubicaciones
              </span>
            </>
          )}
        </div>

        {/* Prominent search input */}
        <div className="relative flex-1 min-w-[190px]">
          <Search
            className="w-4 h-4 text-[#616161] dark:text-[#A0A0A0] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden="true"
          />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder="Buscar en tu NAS..."
            aria-label="Buscar en tu NAS"
            className="w-full h-8 pl-8 pr-16 rounded-md bg-white dark:bg-[#2B2B2B] border border-[#D4D4D4] dark:border-[#3D3D3D] text-[13px] text-[#1A1A1A] dark:text-[#F3F3F3] placeholder:text-[#767676] dark:placeholder:text-[#8E8E8E] focus:outline-none focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:ring-1 focus:ring-[#0067C0]/30 dark:focus:ring-[#60CDFF]/30 transition-colors"
          />
          {searchQuery ? (
            <button
              type="button"
              onClick={() => onSearchQueryChange('')}
              aria-label="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-[#616161] dark:text-[#A0A0A0] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          ) : (
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[11px] text-[#808080] dark:text-[#7E7E7E] font-mono">
              Ctrl+K
            </span>
          )}
        </div>

        {/* 4-option category filter selector */}
        <div
          className="flex items-center p-0.5 rounded-md bg-[#E8E8E8] dark:bg-[#2B2B2B] border border-[#DCDCDC] dark:border-[#3A3A3A] shrink-0"
          role="tablist"
          aria-label="Filtrar resultados por tipo"
        >
          {FILTER_OPTIONS.map((option) => {
            const isActive = searchFilter === option.id;
            return (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onSearchFilterChange(option.id)}
                className={`h-7 px-2.5 rounded text-[12px] font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  isActive
                    ? 'bg-white dark:bg-[#3B3B3B] text-[#1A1A1A] dark:text-[#FFFFFF] shadow-xs'
                    : 'text-[#555555] dark:text-[#B0B0B0] hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3]'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {/* View mode switch (Lista / Cuadrícula) */}
        <div
          className="flex items-center p-0.5 rounded-md bg-[#E8E8E8] dark:bg-[#2B2B2B] border border-[#DCDCDC] dark:border-[#3A3A3A] shrink-0"
          role="group"
          aria-label="Modo de vista"
        >
          <button
            type="button"
            onClick={() => onViewModeChange('list')}
            aria-pressed={viewMode === 'list'}
            title="Vista Lista"
            className={`h-7 w-7 inline-flex items-center justify-center rounded transition-colors cursor-pointer ${
              viewMode === 'list'
                ? 'bg-white dark:bg-[#3B3B3B] text-[#0067C0] dark:text-[#60CDFF] shadow-xs'
                : 'text-[#555555] dark:text-[#B0B0B0] hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3]'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('grid')}
            aria-pressed={viewMode === 'grid'}
            title="Vista Cuadrícula"
            className={`h-7 w-7 inline-flex items-center justify-center rounded transition-colors cursor-pointer ${
              viewMode === 'grid'
                ? 'bg-white dark:bg-[#3B3B3B] text-[#0067C0] dark:text-[#60CDFF] shadow-xs'
                : 'text-[#555555] dark:text-[#B0B0B0] hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3]'
            }`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Refresh / Cancel + Full Settings gear */}
        <div className="flex items-center gap-1.5 shrink-0">
          {isIndexing ? (
            <button
              type="button"
              onClick={onCancelIndexingClick}
              title="Detener la indexación en curso sin borrar el caché previo"
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-[#FDF3F2] dark:bg-[#3A2222] border border-[#F2C6C2] dark:border-[#633636] text-[12.5px] font-medium text-[#A62215] dark:text-[#FCA5A5] hover:bg-[#FBE6E4] dark:hover:bg-[#472A2A] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Square className="w-3 h-3 fill-current" />
              <span>Detener</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onRefreshClick}
              title="Actualizar caché local de todas las ubicaciones"
              className="h-8 px-3 inline-flex items-center gap-1.5 rounded-md bg-white dark:bg-[#2D2D2D] border border-[#D6D6D6] dark:border-[#3D3D3D] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0] hover:bg-[#FAFAFA] dark:hover:bg-[#353535] active:scale-[0.99] transition-all whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
              <span>Actualizar</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={
              hasUpdateAvailable
                ? 'Abrir ajustes (nueva versión disponible)'
                : 'Abrir ajustes'
            }
            title={
              hasUpdateAvailable
                ? 'Hay una nueva versión disponible en GitHub'
                : 'Ajustes (apariencia, caché automático, SMB, DiskVault Clean y actualizaciones)'
            }
            className={`relative h-8 w-8 inline-flex items-center justify-center rounded-md border transition-colors shrink-0 cursor-pointer ${
              isSettingsOpen
                ? 'bg-[#E5F1FB] dark:bg-[#23394D] border-[#0067C0]/40 dark:border-[#60CDFF]/40 text-[#0067C0] dark:text-[#60CDFF]'
                : 'bg-white dark:bg-[#2D2D2D] border-[#D6D6D6] dark:border-[#3D3D3D] text-[#424242] dark:text-[#D4D4D4] hover:bg-[#FAFAFA] dark:hover:bg-[#353535]'
            }`}
          >
            <Settings className="w-4 h-4" />
            {hasUpdateAvailable && (
              <span
                className="absolute top-1 right-1 w-2 h-2 rounded-full bg-[#0067C0] dark:bg-[#60CDFF]"
                aria-hidden="true"
              />
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
