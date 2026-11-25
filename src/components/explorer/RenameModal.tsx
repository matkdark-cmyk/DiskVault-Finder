import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Loader2, Pencil, X } from 'lucide-react';
import type { ActiveEntryTarget } from '../../types';
import { validateWindowsFilenameClient } from '../../utils/format';
import { extractErrorMessage } from '../../utils/tauri';

interface RenameModalProps {
  target: ActiveEntryTarget | null;
  onClose: () => void;
  onConfirm: (path: string, newName: string) => Promise<void>;
}

export function RenameModal({ target, onClose, onConfirm }: RenameModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [name, setName] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!target) {
      return;
    }
    setName(target.name);
    setSubmitError(null);
    setIsSubmitting(false);

    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }
      input.focus();
      if (!target.is_dir) {
        const lastDot = target.name.lastIndexOf('.');
        if (lastDot > 0) {
          input.setSelectionRange(0, lastDot);
          return;
        }
      }
      input.select();
    });

    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    if (!target) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isSubmitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [target, isSubmitting, onClose]);

  if (!target) {
    return null;
  }

  const validationError = validateWindowsFilenameClient(name);
  const isUnchanged = name === target.name;
  const canSubmit = !isSubmitting && validationError === null && !isUnchanged;

  const handleSubmit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (isUnchanged) {
      onClose();
      return;
    }
    const err = validateWindowsFilenameClient(name);
    if (err) {
      setSubmitError(err);
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(target.full_path, name);
      onClose();
    } catch (error) {
      setSubmitError(extractErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-modal-title"
        className="w-full max-w-md rounded-xl bg-white dark:bg-[#252525] border border-[#DCDCDC] dark:border-[#3A3A3A] shadow-2xl overflow-hidden"
      >
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#333333] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Pencil className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
            <h2
              id="rename-modal-title"
              className="text-[14.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Renombrar {target.is_dir ? 'carpeta' : 'archivo'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            aria-label="Cerrar"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="p-5 space-y-4">
          <div>
            <label
              htmlFor="rename-entry-input"
              className="block text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] mb-1.5"
            >
              Nuevo nombre
            </label>
            <input
              ref={inputRef}
              id="rename-entry-input"
              type="text"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setSubmitError(null);
              }}
              disabled={isSubmitting}
              autoComplete="off"
              className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] focus:border-[#0067C0] dark:focus:border-[#60CDFF] focus:outline-none text-[13px] text-[#1A1A1A] dark:text-[#F3F3F3]"
            />
            {(validationError || submitError) && (
              <p className="mt-1.5 text-[12px] text-[#C42B1C] dark:text-[#FCA5A5]">
                {validationError ?? submitError}
              </p>
            )}
          </div>

          <p className="text-[11.5px] text-[#666666] dark:text-[#A0A0A0] leading-relaxed">
            El cambio se aplica en vivo en el disco y actualiza SQLite FTS5 al instante para que puedas buscar el nuevo nombre sin esperar re-indexación.
          </p>

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] hover:bg-[#EAEAEA] dark:hover:bg-[#3A3A3A] transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={!canSubmit}
              className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
            >
              {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>Guardar nombre</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
