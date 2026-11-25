import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, X } from 'lucide-react';
import type { ActiveEntryTarget } from '../../types';
import { EntryIcon } from '../../utils/fileIcons';
import { formatBytes, getCategoryLabel } from '../../utils/format';
import { extractErrorMessage } from '../../utils/tauri';

interface DeleteConfirmModalProps {
  target: ActiveEntryTarget | null;
  onClose: () => void;
  onConfirm: (path: string, permanent: boolean) => Promise<void>;
}

export function DeleteConfirmModal({
  target,
  onClose,
  onConfirm,
}: DeleteConfirmModalProps) {
  const [forcePermanentLocal, setForcePermanentLocal] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!target) {
      return;
    }
    setForcePermanentLocal(false);
    setSubmitError(null);
    setIsDeleting(false);
  }, [target]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isDeleting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, isDeleting, onClose]);

  if (!target) {
    return null;
  }

  const willBePermanent = target.is_network || forcePermanentLocal;

  const handleConfirm = async (): Promise<void> => {
    setIsDeleting(true);
    setSubmitError(null);
    try {
      await onConfirm(target.full_path, willBePermanent);
      onClose();
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Trash2 className="w-4 h-4 text-[#C42B1C] dark:text-[#F87171] shrink-0" />
            <h2
              id="delete-modal-title"
              className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Confirmar eliminación
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Item summary */}
          <div className="p-3 rounded-lg bg-[#F7F7F7] dark:bg-[#1E1E1E] border border-[#E5E5E5] dark:border-[#333333] flex items-start gap-3">
            <EntryIcon category={target.category} className="w-6 h-6 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] break-words">
                {target.name}
              </div>
              <div className="mt-0.5 text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3] tabular-nums">
                {getCategoryLabel(target.category, target.extension)}
                {!target.is_dir ? ` · ${formatBytes(target.size_bytes)}` : ''}
              </div>
              <div className="mt-1 font-mono text-[11px] text-[#707070] dark:text-[#8E8E8E] truncate">
                {target.full_path}
              </div>
            </div>
          </div>

          {/* Honest NAS vs local Recycle Bin warning */}
          {target.is_network ? (
            <div className="p-3 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2.5 text-[12px] text-[#9A1F14] dark:text-[#FCA5A5] leading-relaxed">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold">
                  Eliminación permanente en red (NAS)
                </p>
                <p className="mt-0.5">
                  Este elemento está almacenado en tu NAS. Al eliminarlo se borrará de forma permanente y <strong>no pasará por la Papelera de Reciclaje de Windows</strong>.
                  {target.is_dir
                    ? ' También se eliminará todo el contenido dentro de esta carpeta.'
                    : ''}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[12.5px] text-[#444444] dark:text-[#C8C8C8] leading-relaxed">
                {forcePermanentLocal
                  ? 'Este elemento se eliminará de forma permanente sin pasar por la Papelera de Reciclaje de Windows.'
                  : 'Este elemento se moverá a la Papelera de Reciclaje de Windows, desde donde podrás restaurarlo si lo necesitas.'}
              </p>
              <label className="flex items-center gap-2 text-[12px] text-[#555555] dark:text-[#B0B0B0] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={forcePermanentLocal}
                  onChange={(event) => setForcePermanentLocal(event.target.checked)}
                  disabled={isDeleting}
                  className="rounded border-[#C4C4C4] dark:border-[#555555] accent-[#C42B1C]"
                />
                <span>Eliminar permanentemente sin pasar por la Papelera</span>
              </label>
            </div>
          )}

          {submitError && (
            <p className="text-[12px] text-[#C42B1C] dark:text-[#FCA5A5]">
              {submitError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isDeleting}
              className="h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void handleConfirm()}
              disabled={isDeleting}
              className="h-8 px-4 rounded-md bg-[#C42B1C] hover:bg-[#A62215] dark:bg-[#DC3545] dark:hover:bg-[#E04F5D] text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              {isDeleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {willBePermanent
                  ? 'Eliminar permanentemente'
                  : 'Enviar a la Papelera'}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
