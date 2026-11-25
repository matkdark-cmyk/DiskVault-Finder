import { useEffect, useState } from 'react';
import { AlertCircle, Copy, Info, Loader2, X } from 'lucide-react';
import type { ActiveEntryTarget, EntryPropertiesDto } from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import {
  formatBytes,
  formatUnixTimestamp,
  getCategoryLabel,
} from '../../utils/format';
import { extractErrorMessage, getEntryProperties } from '../../utils/tauri';

interface PropertiesModalProps {
  target: ActiveEntryTarget | null;
  onClose: () => void;
  onCopyPath: (path: string) => void;
}

export function PropertiesModal({
  target,
  onClose,
  onCopyPath,
}: PropertiesModalProps) {
  const [details, setDetails] = useState<EntryPropertiesDto | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) {
      setDetails(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void getEntryProperties(target.full_path)
      .then((res) => {
        if (!cancelled) {
          setDetails(res);
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(extractErrorMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [target]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, onClose]);

  if (!target) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="properties-modal-title"
        className="w-full max-w-lg rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Info className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <h2
              id="properties-modal-title"
              className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Propiedades
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="py-10 flex items-center justify-center gap-2 text-[12.5px] text-[#666666] dark:text-[#A0A0A0]">
              <Loader2 className="w-4 h-4 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
              <span>Consultando propiedades...</span>
            </div>
          ) : error ? (
            <div className="py-6 flex flex-col items-center text-center gap-2 text-[12.5px] text-[#C42B1C] dark:text-[#FCA5A5]">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
          ) : details ? (
            <div className="space-y-4">
              {/* Top identity */}
              <div className="flex items-center gap-3 pb-3.5 border-b border-[#EFEFEF] dark:border-[#333333]">
                <EntryIcon category={details.category} className="w-8 h-8 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] break-words">
                    {details.name}
                  </div>
                  <div className="text-[12px] text-[#666666] dark:text-[#A0A0A0]">
                    {getCategoryLabel(details.category, details.extension)} ·{' '}
                    {details.is_network ? 'Carpeta de red (NAS)' : 'Disco local'}
                  </div>
                </div>
              </div>

              {/* Metadata grid */}
              <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 gap-x-3 text-[12.5px]">
                <dt className="text-[#666666] dark:text-[#9E9E9E]">Ubicación raíz</dt>
                <dd className="text-[#1A1A1A] dark:text-[#EDEDED] font-medium truncate">
                  {details.root_name}
                </dd>

                <dt className="text-[#666666] dark:text-[#9E9E9E]">Ruta completa</dt>
                <dd className="min-w-0 flex items-start gap-2">
                  <span className="font-mono text-[11.5px] text-[#1A1A1A] dark:text-[#E5E5E5] break-all flex-1">
                    {details.full_path}
                  </span>
                  <button
                    type="button"
                    onClick={() => onCopyPath(details.full_path)}
                    title="Copiar ruta completa"
                    className="h-6 w-6 inline-flex items-center justify-center rounded border border-[#DCDCDC] dark:border-[#3E3E3E] hover:bg-[#F3F3F3] dark:hover:bg-[#333333] text-[#555555] dark:text-[#B5B5B5] shrink-0 cursor-pointer"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </dd>

                <dt className="text-[#666666] dark:text-[#9E9E9E]">Tamaño</dt>
                <dd className="text-[#1A1A1A] dark:text-[#EDEDED] tabular-nums">
                  {formatBytes(details.size_bytes)}{' '}
                  <span className="text-[#757575] dark:text-[#969696]">
                    ({details.size_bytes.toLocaleString('es-ES')} bytes)
                  </span>
                </dd>

                {details.is_dir && (
                  <>
                    <dt className="text-[#666666] dark:text-[#9E9E9E]">Contenido</dt>
                    <dd className="text-[#1A1A1A] dark:text-[#EDEDED] tabular-nums">
                      {details.child_files.toLocaleString('es-ES')}{' '}
                      {details.child_files === 1 ? 'archivo' : 'archivos'} ·{' '}
                      {details.child_dirs.toLocaleString('es-ES')}{' '}
                      {details.child_dirs === 1 ? 'carpeta' : 'carpetas'}
                    </dd>
                  </>
                )}

                <dt className="text-[#666666] dark:text-[#9E9E9E]">Modificado</dt>
                <dd className="text-[#1A1A1A] dark:text-[#EDEDED] tabular-nums">
                  {formatUnixTimestamp(details.modified_ts)}
                </dd>

                <dt className="text-[#666666] dark:text-[#9E9E9E]">Creado</dt>
                <dd className="text-[#1A1A1A] dark:text-[#EDEDED] tabular-nums">
                  {formatUnixTimestamp(details.created_ts)}
                </dd>
              </dl>
            </div>
          ) : null}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-4 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
