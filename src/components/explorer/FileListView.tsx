import type { MouseEvent } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { DirectoryItem, SortDirection, SortField } from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import {
  formatBytes,
  formatUnixTimestamp,
  getCategoryLabel,
} from '../../utils/format';

interface FileListViewProps {
  items: DirectoryItem[];
  selectedPath: string | null;
  sortField: SortField;
  sortDirection: SortDirection;
  onSelect: (path: string | null) => void;
  onOpen: (item: DirectoryItem) => void;
  onContextMenu: (event: MouseEvent, item: DirectoryItem) => void;
  onBackgroundContextMenu: (event: MouseEvent) => void;
  onToggleSort: (field: SortField) => void;
}

function SortIndicator({
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

export function FileListView({
  items,
  selectedPath,
  sortField,
  sortDirection,
  onSelect,
  onOpen,
  onContextMenu,
  onBackgroundContextMenu,
  onToggleSort,
}: FileListViewProps) {
  return (
    <div
      className="flex-1 overflow-auto"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onSelect(null);
        }
      }}
      onContextMenu={(event) => {
        if (event.target === event.currentTarget) {
          onBackgroundContextMenu(event);
        }
      }}
    >
      <table className="w-full border-collapse text-left table-fixed">
        <thead className="sticky top-0 z-10 bg-[#FAFAFA] dark:bg-[#222222] border-b border-[#E5E5E5] dark:border-[#303030] text-[11.5px] font-medium text-[#5C5C5C] dark:text-[#A3A3A3]">
          <tr>
            <th className="py-1.5 pl-4 pr-3 font-medium w-[48%]">
              <button
                type="button"
                onClick={() => onToggleSort('name')}
                className="inline-flex items-center gap-1 hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
              >
                <span>Nombre</span>
                <SortIndicator
                  active={sortField === 'name'}
                  direction={sortDirection}
                />
              </button>
            </th>
            <th className="py-1.5 px-3 font-medium w-[18%]">
              <button
                type="button"
                onClick={() => onToggleSort('modified')}
                className="inline-flex items-center gap-1 hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
              >
                <span>Fecha de modificación</span>
                <SortIndicator
                  active={sortField === 'modified'}
                  direction={sortDirection}
                />
              </button>
            </th>
            <th className="py-1.5 px-3 font-medium w-[20%]">
              <button
                type="button"
                onClick={() => onToggleSort('type')}
                className="inline-flex items-center gap-1 hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
              >
                <span>Tipo</span>
                <SortIndicator
                  active={sortField === 'type'}
                  direction={sortDirection}
                />
              </button>
            </th>
            <th className="py-1.5 pl-3 pr-4 font-medium text-right w-[14%]">
              <button
                type="button"
                onClick={() => onToggleSort('size')}
                className="inline-flex items-center justify-end gap-1 ml-auto hover:text-[#1A1A1A] dark:hover:text-[#F3F3F3] transition-colors cursor-pointer"
              >
                <span>Tamaño</span>
                <SortIndicator
                  active={sortField === 'size'}
                  direction={sortDirection}
                />
              </button>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#F1F1F1] dark:divide-[#272727] text-[12.5px]">
          {items.map((item) => {
            const isSelected =
              selectedPath !== null &&
              selectedPath.toLowerCase() === item.full_path.toLowerCase();

            return (
              <tr
                key={item.full_path}
                onClick={() => onSelect(item.full_path)}
                onDoubleClick={() => onOpen(item)}
                onContextMenu={(event) => onContextMenu(event, item)}
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
                      {item.name}
                    </span>
                  </div>
                </td>
                <td className="py-1.5 px-3 tabular-nums text-[#555555] dark:text-[#B0B0B0] whitespace-nowrap">
                  {formatUnixTimestamp(item.modified_ts)}
                </td>
                <td className="py-1.5 px-3 truncate text-[#555555] dark:text-[#B0B0B0]">
                  {getCategoryLabel(item.category, item.extension)}
                </td>
                <td className="py-1.5 pl-3 pr-4 text-right tabular-nums text-[#555555] dark:text-[#B0B0B0] whitespace-nowrap">
                  {item.is_dir ? '—' : formatBytes(item.size_bytes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
