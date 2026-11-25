import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import type { ToastMessage } from '../../types';

interface ToastContainerProps {
  toasts: ToastMessage[];
  hasActiveTransfer?: boolean;
  onDismiss: (id: string) => void;
}

export function ToastContainer({
  toasts,
  hasActiveTransfer = false,
  onDismiss,
}: ToastContainerProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <div
      className={`fixed right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none transition-[bottom] duration-150 ${
        hasActiveTransfer ? 'bottom-[228px]' : 'bottom-10'
      }`}
      role="status"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const Icon =
          toast.kind === 'success'
            ? CheckCircle2
            : toast.kind === 'error' || toast.kind === 'warning'
              ? AlertCircle
              : Info;
        const iconColor =
          toast.kind === 'success'
            ? 'text-[#15803D] dark:text-[#4ADE80]'
            : toast.kind === 'error'
              ? 'text-[#C42B1C] dark:text-[#F87171]'
              : toast.kind === 'warning'
                ? 'text-[#B45309] dark:text-[#FBBF24]'
                : 'text-[#0067C0] dark:text-[#60CDFF]';

        return (
          <div
            key={toast.id}
            className="pointer-events-auto rounded-lg bg-white dark:bg-[#2B2B2B] border border-[#DCDCDC] dark:border-[#3F3F3F] shadow-lg px-3.5 py-2.5 flex items-start gap-2.5"
          >
            <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                {toast.title}
              </div>
              {toast.detail && (
                <div className="text-[11.5px] text-[#5C5C5C] dark:text-[#B0B0B0] mt-0.5 leading-snug break-words">
                  {toast.detail}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Cerrar notificación"
              className="h-5 w-5 inline-flex items-center justify-center rounded text-[#767676] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
