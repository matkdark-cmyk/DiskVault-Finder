import type { MouseEvent } from 'react';
import type { DirectoryItem } from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import { formatBytes } from '../../utils/format';

interface FileGridViewProps {
  items: DirectoryItem[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
  onOpen: (item: DirectoryItem) => void;
  onContextMenu: (event: MouseEvent, item: DirectoryItem) => void;
  onBackgroundContextMenu: (event: MouseEvent) => void;
}

export function FileGridView({
  items,
  selectedPath,
  onSelect,
  onOpen,
  onContextMenu,
  onBackgroundContextMenu,
}: FileGridViewProps) {
  return (
    <div
      className="flex-1 overflow-auto p-4"
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
      <div
        className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2"
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
        {items.map((item) => {
          const isSelected =
            selectedPath !== null &&
            selectedPath.toLowerCase() === item.full_path.toLowerCase();

          return (
            <button
              key={item.full_path}
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onSelect(item.full_path);
              }}
              onDoubleClick={() => onOpen(item)}
              onContextMenu={(event) => {
                event.stopPropagation();
                onContextMenu(event, item);
              }}
              title={item.full_path}
              className={`group flex flex-col items-center text-center p-3 rounded-md border transition-colors cursor-default ${
                isSelected
                  ? 'bg-[#E5F1FB] dark:bg-[#253B4E] border-[#0067C0]/40 dark:border-[#60CDFF]/40'
                  : 'bg-transparent border-transparent hover:bg-[#F5F9FD] dark:hover:bg-[#262C32] hover:border-[#E2E8F0] dark:hover:border-[#343B42]'
              }`}
            >
              <div className="h-12 w-12 flex items-center justify-center mb-2">
                <EntryIcon category={item.category} className="w-10 h-10 shrink-0" />
              </div>
              <span className="w-full text-[12px] font-medium text-[#1A1A1A] dark:text-[#F3F3F3] leading-snug line-clamp-2 break-words">
                {item.name}
              </span>
              <span className="mt-1 text-[11px] text-[#6E6E6E] dark:text-[#9A9A9A] tabular-nums">
                {item.is_dir
                  ? 'Carpeta'
                  : item.extension
                    ? `${item.extension.toUpperCase()} · ${formatBytes(item.size_bytes)}`
                    : formatBytes(item.size_bytes)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
