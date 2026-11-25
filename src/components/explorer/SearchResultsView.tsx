import { useMemo, type MouseEvent, type ReactNode } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  SearchX,
  WifiOff,
  X,
} from 'lucide-react';
import type {
  ActiveEntryTarget,
  IndexProgress,
  SearchFilter,
  SearchResultItem,
  SortDirection,
  SortField,
  ViewMode,
  WatchedRoot,
} from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import {
  formatBytes,
  formatUnixTimestamp,
  getCategoryLabel,
  getFilterLabel,
} from '../../utils/format';
import { sortFileItems } from '../../utils/sort';

interface SearchResultsViewProps {
  items: SearchResultItem[];
  totalMatches: number;
  elapsedMs: number;
  query: string;
  filter: SearchFilter;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;
  selectedPath: string | null;
  selectedRoot: WatchedRoot | null;
  roots: WatchedRoot[];
  isSearching: boolean;
  searchError: string | null;
  indexProgress: IndexProgress;
  onSelectPath: (path: string | null) => void;
  onOpenItem: (item: SearchResultItem) => void;
  onContextMenu: (event: MouseEvent, target: ActiveEntryTarget) => void;
  onToggleSort: (field: SortField) => void;
  onRefreshAll: () => void;
  onRefreshSingleRoot: (rootId: number) => void;
  onCancelIndexing: () => void;
  onClearSearch: () => void;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedName({ name, query }: { name: string; query: string }): ReactNode {
  const tokens = useMemo(
    () =>
      query
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 0),
    [query],
  );

  if (tokens.length === 0) {
    return name;
  }

  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join('|')})`, 'gi');
  const parts = name.split(pattern);

  return parts.map((part, idx) => {
    const isMatch = tokens.some(
      (token) => token.toLowerCase() === part.toLowerCase(),
    );
    if (!isMatch) {
      return <span key={idx}>{part}</span>;
    }
    return (
      <mark
        key={idx}
        className="bg-[#D9ECFF] dark:bg-[#1E4668] text-[#0A2540] dark:text-[#E6F4FF] rounded-[2px] px-0.5 font-semibold"
      >
        {part}
      </mark>
    );
  });
}

function SortChevron({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return null;
  }
  return direction === 'asc' ? (
    <ChevronUp className="w-3.5 h-3.5 shrink-0 text-[#0067C0] dark:text-[#60CDFF]" />
  ) : (
    <ChevronDown className="w-3.5 h-3.5 shrink-0 text-[#0067C0] dark:text-[#60CDFF]" />
  );
}

export function SearchResultsView({
  items,
  totalMatches,
  elapsedMs,
  query,
  filter,
  viewMode,
  sortField,
  sortDirection,
  selectedPath,
  selectedRoot,
  roots,
  isSearching,
  searchError,
  indexProgress,
  onSelectPath,
  onOpenItem,
  onContextMenu,
  onToggleSort,
  onRefreshAll,
  onRefreshSingleRoot,
  onCancelIndexing,
  onClearSearch,
}: SearchResultsViewProps) {
  const sortedItems = useMemo(
    () => sortFileItems(items, sortField, sortDirection),
    [items, sortField, sortDirection],
  );

  const scopedRoots = selectedRoot ? [selectedRoot] : roots;
  const hasOfflineScopedRoot = scopedRoots.some((r) => r.status === 'offline');
  const totalCachedInScope = scopedRoots.reduce((acc, r) => acc + r.item_count, 0);
  const hasActiveQueryOrFilter = query.trim().length > 0 || filter !== 'all';

  const openMenu = (event: MouseEvent, item: SearchResultItem): void => {
    event.preventDefault();
    onSelectPath(item.full_path);
    const matchedRoot = roots.find((r) => r.id === item.root_id);
    onContextMenu(event, {
      name: item.name,
      full_path: item.full_path,
      parent_path: item.parent_path,
      is_dir: item.is_dir,
      category: item.category,
      extension: item.extension,
      size_bytes: item.size_bytes,
      root_id: item.root_id,
      is_network: matchedRoot?.is_network ?? false,
      is_offline:
        item.root_status === 'offline' || matchedRoot?.status === 'offline',
      from_search: true,
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Subheader bar */}
      <div className="px-4 py-2.5 border-b border-[#EAEAEA] dark:border-[#2D2D2D] flex items-center justify-between gap-4 shrink-0 bg-[#FAFAFA] dark:bg-[#1F1F1F]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-[#1A1A1A] dark:text-[#F3F3F3] truncate">
            <span className="truncate">
              {query.trim()
                ? `Resultados para "${query.trim()}"`
                : selectedRoot
                  ? selectedRoot.name
                  : 'Todas las ubicaciones'}
            </span>
            {filter !== 'all' && (
              <span className="text-[12px] font-normal text-[#666666] dark:text-[#A0A0A0] shrink-0">
                · {getFilterLabel(filter)}
              </span>
            )}
          </div>
          <div className="text-[11.5px] text-[#666666] dark:text-[#9A9A9A] mt-0.5 flex items-center gap-2 truncate">
            <span className="tabular-nums">
              {totalMatches.toLocaleString('es-ES')}{' '}
              {totalMatches === 1 ? 'elemento' : 'elementos'}
              {items.length < totalMatches
                ? ` (mostrando ${items.length.toLocaleString('es-ES')})`
                : ''}
            </span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums font-mono">{elapsedMs} ms</span>
            {selectedRoot && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono truncate">{selectedRoot.path}</span>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasActiveQueryOrFilter && (
            <button
              type="button"
              onClick={onClearSearch}
              className="h-7 px-2.5 rounded-md bg-white dark:bg-[#2B2B2B] border border-[#D8D8D8] dark:border-[#3D3D3D] hover:bg-[#F3F3F3] dark:hover:bg-[#353535] text-[12px] text-[#444444] dark:text-[#D4D4D4] inline-flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              <span>Limpiar</span>
            </button>
          )}
        </div>
      </div>

      {/* Offline cache protection notice */}
      {hasOfflineScopedRoot && (
        <div className="px-4 py-2 border-b border-[#EBD6A7] dark:border-[#4D3B1B] bg-[#FFFBEB] dark:bg-[#2A2213] flex items-center justify-between gap-3 text-[12px] text-[#8A5300] dark:text-[#FCD34D] shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <WifiOff className="w-4 h-4 shrink-0" />
            <span className="truncate">
              Mostrando resultados desde el caché local. Las ubicaciones sin conexión conservan todos sus archivos indexados hasta que vuelva el NAS.
            </span>
          </div>
          <button
            type="button"
            onClick={() =>
              selectedRoot
                ? onRefreshSingleRoot(selectedRoot.id)
                : onRefreshAll()
            }
            disabled={indexProgress.is_running}
            className="text-[12px] font-medium underline hover:no-underline whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
          >
            Reintentar conexión
          </button>
        </div>
      )}

      {/* Search error */}
      {searchError && (
        <div className="px-4 py-2.5 border-b border-[#F2C6C2] dark:border-[#5C3030] bg-[#FDF3F2] dark:bg-[#331E1E] flex items-center gap-2 text-[12px] text-[#A62215] dark:text-[#FCA5A5] shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{searchError}</span>
        </div>
      )}

      {/* Content states */}
      {indexProgress.is_running && totalCachedInScope === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <Loader2 className="w-7 h-7 animate-spin text-[#0067C0] dark:text-[#60CDFF] mb-3" />
          <h2 className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
            Indexando {indexProgress.current_root_name ?? 'ubicaciones'}...
          </h2>
          <p className="mt-1 text-[12.5px] text-[#5C5C5C] dark:text-[#A3A3A3] tabular-nums">
            {indexProgress.items_scanned.toLocaleString('es-ES')} elementos leídos
            {indexProgress.bytes_scanned > 0
              ? ` · ${formatBytes(indexProgress.bytes_scanned)}`
              : ''}
          </p>
          <button
            type="button"
            onClick={onCancelIndexing}
            className="mt-4 h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#2E2E2E] border border-[#D4D4D4] dark:border-[#404040] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#383838] transition-colors cursor-pointer"
          >
            Cancelar escaneo
          </button>
        </div>
      ) : totalCachedInScope === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <RefreshCw className="w-8 h-8 text-[#0067C0] dark:text-[#60CDFF] mb-3" />
          <h2 className="text-[15.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
            Esta ubicación aún no ha sido indexada
          </h2>
          <p className="mt-1.5 max-w-md text-[12.5px] text-[#5C5C5C] dark:text-[#A3A3A3] leading-relaxed">
            Ejecuta la primera actualización de caché para buscar archivos, videos y carpetas al instante en SQLite FTS5.
          </p>
          <button
            type="button"
            onClick={() =>
              selectedRoot
                ? onRefreshSingleRoot(selectedRoot.id)
                : onRefreshAll()
            }
            disabled={indexProgress.is_running}
            className="mt-4 h-9 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Indexar ahora</span>
          </button>
        </div>
      ) : sortedItems.length === 0 && !isSearching ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <SearchX className="w-8 h-8 text-[#8A8A8A] dark:text-[#787878] mb-3" />
          <h2 className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
            No se encontraron coincidencias
          </h2>
          <p className="mt-1 max-w-md text-[12.5px] text-[#5C5C5C] dark:text-[#A3A3A3]">
            No hay elementos que coincidan con{' '}
            {query.trim() ? (
              <span className="font-medium text-[#1A1A1A] dark:text-[#EDEDED]">
                "{query.trim()}"
              </span>
            ) : (
              'la selección actual'
            )}{' '}
            en el filtro <span className="font-medium">{getFilterLabel(filter)}</span>.
          </p>
          {hasActiveQueryOrFilter && (
            <button
              type="button"
              onClick={onClearSearch}
              className="mt-4 h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#2E2E2E] border border-[#D4D4D4] dark:border-[#404040] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#383838] transition-colors cursor-pointer"
            >
              Limpiar búsqueda y filtro
            </button>
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(136px,1fr))] gap-2">
            {sortedItems.map((item) => {
              const isSelected =
                selectedPath !== null &&
                selectedPath.toLowerCase() === item.full_path.toLowerCase();

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onSelectPath(item.full_path)}
                  onDoubleClick={() => onOpenItem(item)}
                  onContextMenu={(event) => openMenu(event, item)}
                  title={item.full_path}
                  className={`flex flex-col items-center text-center p-3 rounded-md border transition-colors cursor-default ${
                    isSelected
                      ? 'bg-[#E5F1FB] dark:bg-[#253B4E] border-[#0067C0]/40 dark:border-[#60CDFF]/40'
                      : 'bg-transparent border-transparent hover:bg-[#F5F9FD] dark:hover:bg-[#262C32] hover:border-[#E2E8F0] dark:hover:border-[#343B42]'
                  }`}
                >
                  <div className="h-12 w-12 flex items-center justify-center mb-2">
                    <EntryIcon
                      category={item.category}
                      className="w-10 h-10 shrink-0"
                    />
                  </div>
                  <span className="w-full text-[12px] font-medium text-[#1A1A1A] dark:text-[#F3F3F3] leading-snug line-clamp-2 break-words">
                    <HighlightedName name={item.name} query={query} />
                  </span>
                  <span className="mt-1 text-[11px] text-[#6E6E6E] dark:text-[#9A9A9A] truncate max-w-full">
                    {item.root_name}
                    {!item.is_dir ? ` · ${formatBytes(item.size_bytes)}` : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto relative">
          <table className="w-full border-collapse text-left table-fixed">
            <thead className="sticky top-0 z-10 bg-[#FAFAFA] dark:bg-[#222222] border-b border-[#E5E5E5] dark:border-[#303030] text-[11.5px] font-medium text-[#5C5C5C] dark:text-[#A3A3A3]">
              <tr>
                <th className="py-1.5 pl-4 pr-3 font-medium w-[35%]">
                  <button
                    type="button"
                    onClick={() => onToggleSort('name')}
                    className="inline-flex items-center gap-1 hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
                  >
                    <span>Nombre</span>
                    <SortChevron
                      active={sortField === 'name'}
                      direction={sortDirection}
                    />
                  </button>
                </th>
                <th className="py-1.5 px-3 font-medium w-[30%]">Ubicación</th>
                <th className="py-1.5 px-3 font-medium w-[13%]">
                  <button
                    type="button"
                    onClick={() => onToggleSort('type')}
                    className="inline-flex items-center gap-1 hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
                  >
                    <span>Tipo</span>
                    <SortChevron
                      active={sortField === 'type'}
                      direction={sortDirection}
                    />
                  </button>
                </th>
                <th className="py-1.5 px-3 font-medium text-right w-[10%]">
                  <button
                    type="button"
                    onClick={() => onToggleSort('size')}
                    className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
                  >
                    <span>Tamaño</span>
                    <SortChevron
                      active={sortField === 'size'}
                      direction={sortDirection}
                    />
                  </button>
                </th>
                <th className="py-1.5 pl-3 pr-4 font-medium text-right w-[12%]">
                  <button
                    type="button"
                    onClick={() => onToggleSort('modified')}
                    className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
                  >
                    <span>Modificado</span>
                    <SortChevron
                      active={sortField === 'modified'}
                      direction={sortDirection}
                    />
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F1F1F1] dark:divide-[#272727] text-[12.5px]">
              {sortedItems.map((item) => {
                const isSelected =
                  selectedPath !== null &&
                  selectedPath.toLowerCase() === item.full_path.toLowerCase();
                const isOffline = item.root_status === 'offline';

                return (
                  <tr
                    key={item.id}
                    onClick={() => onSelectPath(item.full_path)}
                    onDoubleClick={() => onOpenItem(item)}
                    onContextMenu={(event) => openMenu(event, item)}
                    title={item.full_path}
                    className={`h-[38px] transition-colors cursor-default ${
                      isSelected
                        ? 'bg-[#E5F1FB] dark:bg-[#253B4E]'
                        : 'hover:bg-[#F5F9FD] dark:hover:bg-[#252B31]'
                    }`}
                  >
                    <td className="py-1.5 pl-4 pr-3 truncate">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <EntryIcon category={item.category} />
                        <span className="truncate font-medium text-[#1A1A1A] dark:text-[#F3F3F3]">
                          <HighlightedName name={item.name} query={query} />
                        </span>
                      </div>
                    </td>

                    <td className="py-1.5 px-3 truncate">
                      <div className="flex items-center gap-1.5 min-w-0 text-[12px]">
                        <span className="font-medium text-[#444444] dark:text-[#CCCCCC] shrink-0">
                          {item.root_name}
                        </span>
                        {isOffline && (
                          <span className="text-[#B45309] dark:text-[#FBBF24] text-[11px] shrink-0">
                            · Sin conexión
                          </span>
                        )}
                        <span aria-hidden="true" className="text-[#A0A0A0] shrink-0">
                          /
                        </span>
                        <span className="font-mono text-[11.5px] text-[#666666] dark:text-[#989898] truncate">
                          {item.parent_path}
                        </span>
                      </div>
                    </td>

                    <td className="py-1.5 px-3 truncate text-[#555555] dark:text-[#B0B0B0]">
                      {getCategoryLabel(item.category, item.extension)}
                    </td>

                    <td className="py-1.5 px-3 text-right tabular-nums text-[#555555] dark:text-[#B0B0B0] whitespace-nowrap">
                      {item.is_dir ? '—' : formatBytes(item.size_bytes)}
                    </td>

                    <td className="py-1.5 pl-3 pr-4 text-right tabular-nums text-[#555555] dark:text-[#B0B0B0] whitespace-nowrap">
                      {formatUnixTimestamp(item.modified_ts)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
