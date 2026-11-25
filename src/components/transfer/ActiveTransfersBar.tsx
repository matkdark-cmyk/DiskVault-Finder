import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderOpen,
  Pause,
  Play,
  Square,
  X,
} from 'lucide-react';
import type { CopyProgressEvent } from '../../types';
import { formatBytes, formatEta, formatSpeed } from '../../utils/format';

interface ActiveTransfersBarProps {
  transfer: CopyProgressEvent | null;
  onTogglePause: () => void;
  onCancel: () => void;
  onOpenInPc: (path: string) => void;
  onDismiss: () => void;
}

export function ActiveTransfersBar({
  transfer,
  onTogglePause,
  onCancel,
  onOpenInPc,
  onDismiss,
}: ActiveTransfersBarProps) {
  if (!transfer) {
    return null;
  }

  const isActive =
    transfer.status === 'running' || transfer.status === 'paused';
  const isCompleted = transfer.status === 'completed';
  const isFailed = transfer.status === 'failed';
  const isCancelled = transfer.status === 'cancelled';

  const percent =
    transfer.bytes_total > 0
      ? Math.min(
          100,
          Math.round((transfer.bytes_done / transfer.bytes_total) * 100),
        )
      : isCompleted
        ? 100
        : 0;

  const title = isCompleted
    ? 'Copia al PC completada'
    : isFailed
      ? 'Error durante la copia'
      : isCancelled
        ? 'Copia cancelada'
        : transfer.is_paused
          ? 'Copia en pausa'
          : 'Copiando al PC...';

  const barColor = isCompleted
    ? 'bg-[#15803D] dark:bg-[#4ADE80]'
    : isFailed
      ? 'bg-[#C42B1C] dark:bg-[#F87171]'
      : transfer.is_paused
        ? 'bg-[#D97706] dark:bg-[#FBBF24]'
        : 'bg-[#0067C0] dark:bg-[#60CDFF]';

  const openTarget = transfer.first_output_path ?? transfer.dest_dir;

  return (
    <aside
      aria-label="Estado de transferencia al PC"
      className="fixed bottom-10 right-4 z-40 w-[390px] max-w-[calc(100vw-2rem)] rounded-xl bg-white dark:bg-[#252525] border border-[#D4D4D4] dark:border-[#3E3E3E] shadow-2xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[#EFEFEF] dark:border-[#343434] flex items-center justify-between gap-2 bg-[#FAFAFA] dark:bg-[#202020]">
        <div className="flex items-center gap-2 min-w-0">
          {isCompleted ? (
            <CheckCircle2 className="w-4 h-4 text-[#15803D] dark:text-[#4ADE80] shrink-0" />
          ) : isFailed ? (
            <AlertCircle className="w-4 h-4 text-[#C42B1C] dark:text-[#F87171] shrink-0" />
          ) : (
            <Download className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
          )}
          <span className="text-[12.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate">
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[12px] font-semibold tabular-nums text-[#444444] dark:text-[#D4D4D4]">
            {percent}%
          </span>
          {!isActive && (
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Cerrar panel de transferencia"
              className="h-6 w-6 inline-flex items-center justify-center rounded text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 py-3 space-y-2.5">
        <div className="text-[12px] text-[#1A1A1A] dark:text-[#EDEDED] font-medium truncate">
          {transfer.current_file || transfer.dest_dir}
        </div>

        {/* Progress track */}
        <div className="h-2 w-full rounded-full bg-[#E8E8E8] dark:bg-[#363636] overflow-hidden">
          <div
            className={`h-full transition-[width] duration-150 ${barColor}`}
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Bytes + File counters */}
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3] tabular-nums">
          <span>
            {formatBytes(transfer.bytes_done)} de{' '}
            {formatBytes(transfer.bytes_total)}
          </span>
          <span>
            {transfer.files_done.toLocaleString('es-ES')} /{' '}
            {transfer.files_total.toLocaleString('es-ES')}{' '}
            {transfer.files_total === 1 ? 'archivo' : 'archivos'}
          </span>
        </div>

        {/* Live speed & ETA */}
        {isActive && (
          <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3] tabular-nums">
            <span>
              {transfer.is_paused
                ? 'Transferencia pausada'
                : formatSpeed(transfer.speed_bps)}
            </span>
            <span>
              {transfer.is_paused
                ? 'Presiona Reanudar para continuar'
                : formatEta(transfer.eta_seconds)}
            </span>
          </div>
        )}

        {/* Failure detail */}
        {isFailed && transfer.error_message && (
          <div className="text-[11.5px] text-[#C42B1C] dark:text-[#FCA5A5] leading-snug break-words">
            {transfer.error_message}
          </div>
        )}

        {/* Cancelled detail */}
        {isCancelled && (
          <div className="text-[11.5px] text-[#666666] dark:text-[#A0A0A0]">
            Se eliminaron los archivos temporales incompletos en destino.
          </div>
        )}

        {/* Footer controls */}
        <div className="pt-1 flex items-center justify-end gap-2">
          {isActive ? (
            <>
              <button
                type="button"
                onClick={onTogglePause}
                className="h-7 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#323232] border border-[#D4D4D4] dark:border-[#444444] hover:bg-[#EAEAEA] dark:hover:bg-[#3C3C3C] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
              >
                {transfer.is_paused ? (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    <span>Reanudar</span>
                  </>
                ) : (
                  <>
                    <Pause className="w-3.5 h-3.5" />
                    <span>Pausar</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={onCancel}
                className="h-7 px-3 rounded-md bg-[#FDF3F2] dark:bg-[#3A2222] border border-[#F2C6C2] dark:border-[#5C3030] hover:bg-[#FADBD8] dark:hover:bg-[#4B2929] text-[12px] font-medium text-[#A62215] dark:text-[#FCA5A5] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>Cancelar</span>
              </button>
            </>
          ) : isCompleted ? (
            <>
              <button
                type="button"
                onClick={() => onOpenInPc(openTarget)}
                className="h-7 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Abrir en el PC</span>
              </button>
              <button
                type="button"
                onClick={onDismiss}
                className="h-7 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#323232] border border-[#D4D4D4] dark:border-[#444444] hover:bg-[#EAEAEA] dark:hover:bg-[#3C3C3C] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] transition-colors cursor-pointer"
              >
                Cerrar
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onDismiss}
              className="h-7 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#323232] border border-[#D4D4D4] dark:border-[#444444] hover:bg-[#EAEAEA] dark:hover:bg-[#3C3C3C] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
