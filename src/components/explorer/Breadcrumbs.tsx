import { ChevronRight, HardDrive, Server } from 'lucide-react';
import type { BreadcrumbSegment } from '../../types';

interface BreadcrumbsProps {
  segments: BreadcrumbSegment[];
  isNetwork: boolean;
  onNavigate: (path: string) => void;
}

export function Breadcrumbs({
  segments,
  isNetwork,
  onNavigate,
}: BreadcrumbsProps) {
  if (segments.length === 0) {
    return null;
  }

  return (
    <nav
      aria-label="Ruta actual"
      className="flex items-center gap-0.5 min-w-0 overflow-x-auto no-scrollbar"
    >
      {isNetwork ? (
        <Server className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0 mr-1" />
      ) : (
        <HardDrive className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0 mr-1" />
      )}
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1;
        return (
          <div key={segment.path} className="flex items-center gap-0.5 shrink-0">
            {index > 0 && (
              <ChevronRight
                className="w-3.5 h-3.5 text-[#8A8A8A] dark:text-[#767676] shrink-0"
                aria-hidden="true"
              />
            )}
            <button
              type="button"
              onClick={() => onNavigate(segment.path)}
              title={segment.path}
              className={`px-1.5 py-0.5 rounded text-[12.5px] max-w-[180px] truncate whitespace-nowrap transition-colors cursor-pointer ${
                isLast
                  ? 'font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] hover:bg-[#EAEAEA] dark:hover:bg-[#353535]'
                  : 'text-[#555555] dark:text-[#B5B5B5] hover:text-[#1A1A1A] dark:hover:text-[#F5F5F5] hover:bg-[#EAEAEA] dark:hover:bg-[#353535]'
              }`}
            >
              {segment.name}
            </button>
          </div>
        );
      })}
    </nav>
  );
}
