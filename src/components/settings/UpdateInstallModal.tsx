import { useEffect } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import type { UpdateCheckResultDto, UpdateProgressEvent } from '../../types';
import { formatBytes, formatDateTime, formatSpeed } from '../../utils/format';
import { isSafeGithubHttpsUrl } from '../../utils/tauri';

interface UpdateInstallModalProps {
  isOpen: boolean;
  isTauri: boolean;
  updateInfo: UpdateCheckResultDto | null;
  isInstalling: boolean;
  progress: UpdateProgressEvent | null;
  error: string | null;
  hasRunningTransfer: boolean;
  onClose: () => void;
  onInstallNow: () => void;
  onCancelDownload: () => void;
  onOpenReleaseUrl: (url: string) => void;
}

export function UpdateInstallModal({
  isOpen,
  isTauri,
  updateInfo,
  isInstalling,
  progress,
  error,
  hasRunningTransfer,
  onClose,
  onInstallNow,
  onCancelDownload,
  onOpenReleaseUrl,
}: UpdateInstallModalProps) {
  const isLocked =
    isInstalling &&
    progress?.phase !== 'error' &&
    progress?.phase !== 'cancelled';

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !isLocked) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isLocked, onClose]);

  if (!isOpen || !updateInfo || !updateInfo.has_update) {
    return null;
  }

  const asset = updateInfo.recommended_asset;
  const hasExeInstaller = Boolean(
    asset &&
      asset.name.toLowerCase().endsWith('.exe') &&
      isSafeGithubHttpsUrl(asset.download_url),
  );
  const canAutoInstall = isTauri && hasExeInstaller && !hasRunningTransfer;

  const phase = progress?.phase ?? null;
  const percent = Math.max(0, Math.min(100, progress?.percent ?? 0));

  const stepDownloadDone =
    phase === 'verifying' || phase === 'installing' || phase === 'restarting';
  const stepVerifyDone = phase === 'installing' || phase === 'restarting';
  const stepInstallDone = phase === 'restarting';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isLocked) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-install-modal-title"
        className="w-full max-w-lg rounded-xl bg-white dark:bg-[#222222] border border-[#D4D4D4] dark:border-[#3A3A3A] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#323232] bg-[#F8F8F8] dark:bg-[#1E1E1E] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon.svg" alt="" className="w-5 h-5 shrink-0" />
            <h2
              id="update-install-modal-title"
              className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              {isInstalling
                ? `Actualizando a DiskVault Finder v${updateInfo.latest_version}`
                : 'Nueva actualización disponible'}
            </h2>
          </div>

          {!isLocked && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar ventana de actualización"
              className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[72vh]">
          {/* Version summary */}
          <div className="p-3.5 rounded-lg bg-[#F4F8FC] dark:bg-[#1C2A36] border border-[#CFE2F5] dark:border-[#2C475F] flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] tabular-nums">
                <span className="text-[#5C5C5C] dark:text-[#A6B3BF] font-medium">
                  v{updateInfo.current_version}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
                <span className="text-[#0067C0] dark:text-[#60CDFF]">
                  v{updateInfo.latest_version}
                </span>
              </div>
              <div className="text-[11.5px] text-[#555555] dark:text-[#A8B4C0] truncate">
                {updateInfo.release_name} · {updateInfo.repo}
              </div>
            </div>

            <div className="text-right text-[11px] text-[#5C5C5C] dark:text-[#A3B1BD] tabular-nums shrink-0">
              {updateInfo.published_at && (
                <div>{formatDateTime(updateInfo.published_at)}</div>
              )}
              {asset && asset.size_bytes > 0 && (
                <div className="font-medium text-[#1A1A1A] dark:text-[#E5E5E5] mt-0.5">
                  Instalador: {formatBytes(asset.size_bytes)}
                </div>
              )}
            </div>
          </div>

          {/* Release notes (when idle) */}
          {!isInstalling && updateInfo.release_notes && (
            <div className="space-y-1.5">
              <div className="text-[12px] font-semibold text-[#333333] dark:text-[#D8D8D8]">
                Novedades de esta versión
              </div>
              <div className="max-h-36 overflow-y-auto p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#1A1A1A] border border-[#E5E5E5] dark:border-[#343434] text-[12px] text-[#333333] dark:text-[#D4D4D4] whitespace-pre-wrap leading-relaxed">
                {updateInfo.release_notes}
              </div>
            </div>
          )}

          {/* Session preservation & security reassurance */}
          <div className="p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E6E6E6] dark:border-[#363636] flex items-start gap-2.5 text-[12px] text-[#333333] dark:text-[#D4D4D4] leading-relaxed">
            <ShieldCheck className="w-4 h-4 mt-0.5 text-[#107C10] dark:text-[#6CCB5F] shrink-0" />
            <div>
              <p className="font-medium text-[#1A1A1A] dark:text-[#F3F3F3]">
                Sin perder ningún cambio ni tu ubicación actual
              </p>
              <p className="text-[11.5px] text-[#5C5C5C] dark:text-[#A3A3A3] mt-0.5">
                Al actualizar, DiskVault Finder guardará tus carpetas, caché SQLite, búsqueda y la carpeta exacta donde estabas trabajando, instalará la nueva versión automáticamente y se reiniciará justo ahí.
                {updateInfo.sha256_url
                  ? ' La descarga se verifica con firma SHA-256 antes de instalar.'
                  : ''}
              </p>
            </div>
          </div>

          {/* Active transfer blocker warning */}
          {hasRunningTransfer && !isInstalling && (
            <div className="p-3 rounded-lg bg-[#FFFBEB] dark:bg-[#2E2514] border border-[#EBD6A7] dark:border-[#57431D] flex items-start gap-2 text-[12px] text-[#8A5300] dark:text-[#FCD34D]">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                Tienes una transferencia del NAS al PC en curso. Espera a que termine antes de reiniciar para actualizar.
              </span>
            </div>
          )}

          {/* Live progress bar & phases while installing */}
          {(isInstalling || (progress && progress.phase !== 'error')) && (
            <div className="p-4 rounded-lg bg-[#FAFAFA] dark:bg-[#1C1C1C] border border-[#DCDCDC] dark:border-[#383838] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {phase === 'restarting' ? (
                    <CheckCircle2 className="w-4 h-4 text-[#107C10] dark:text-[#6CCB5F] shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
                  )}
                  <span className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F3F3F3] truncate">
                    {progress?.message ?? 'Preparando actualización...'}
                  </span>
                </div>
                <span className="text-[12.5px] font-semibold text-[#0067C0] dark:text-[#60CDFF] tabular-nums shrink-0">
                  {percent}%
                </span>
              </div>

              {/* Progress bar */}
              <div
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                className="w-full h-2.5 rounded-full bg-[#E5E5E5] dark:bg-[#323232] overflow-hidden"
              >
                <div
                  className="h-full rounded-full bg-[#0067C0] dark:bg-[#4CC2FF] transition-all duration-200 ease-out"
                  style={{ width: `${percent}%` }}
                />
              </div>

              {/* Transfer stats */}
              <div className="flex items-center justify-between gap-2 text-[11.5px] text-[#666666] dark:text-[#9E9E9E] tabular-nums">
                <span>
                  {progress && progress.bytes_downloaded > 0
                    ? progress.bytes_total > 0
                      ? `${formatBytes(progress.bytes_downloaded)} de ${formatBytes(progress.bytes_total)}`
                      : `${formatBytes(progress.bytes_downloaded)} descargados`
                    : 'Preparando...'}
                </span>
                <span>
                  {phase === 'downloading' && progress && progress.speed_bps > 0
                    ? formatSpeed(progress.speed_bps)
                    : phase === 'verifying'
                      ? 'Comprobando SHA-256'
                      : phase === 'installing' || phase === 'restarting'
                        ? 'Iniciando instalador...'
                        : ''}
                </span>
              </div>

              {/* Clear 3-step visual progress */}
              <div className="pt-2 border-t border-[#EAEAEA] dark:border-[#303030] grid grid-cols-3 gap-2 text-[11px]">
                <div
                  className={`flex items-center gap-1.5 ${
                    stepDownloadDone
                      ? 'text-[#107C10] dark:text-[#6CCB5F] font-medium'
                      : phase === 'downloading'
                        ? 'text-[#0067C0] dark:text-[#60CDFF] font-semibold'
                        : 'text-[#808080] dark:text-[#787878]'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">1. Descarga</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    stepVerifyDone
                      ? 'text-[#107C10] dark:text-[#6CCB5F] font-medium'
                      : phase === 'verifying'
                        ? 'text-[#0067C0] dark:text-[#60CDFF] font-semibold'
                        : 'text-[#808080] dark:text-[#787878]'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">2. Verificación</span>
                </div>
                <div
                  className={`flex items-center gap-1.5 ${
                    stepInstallDone
                      ? 'text-[#107C10] dark:text-[#6CCB5F] font-medium'
                      : phase === 'installing'
                        ? 'text-[#0067C0] dark:text-[#60CDFF] font-semibold'
                        : 'text-[#808080] dark:text-[#787878]'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">3. Instalar y abrir</span>
                </div>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="p-3 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {!hasExeInstaller && !isInstalling && (
            <div className="p-3 rounded-lg bg-[#FFFBEB] dark:bg-[#2E2514] border border-[#EBD6A7] dark:border-[#57431D] text-[12px] text-[#8A5300] dark:text-[#FCD34D]">
              Este lanzamiento aún no tiene un instalador <span className="font-mono">.exe</span> adjunto. Puedes revisarlo directamente en GitHub.
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 border-t border-[#EAEAEA] dark:border-[#323232] bg-[#F8F8F8] dark:bg-[#1E1E1E] flex flex-wrap items-center justify-between gap-2">
          <div>
            {isSafeGithubHttpsUrl(updateInfo.release_url) &&
              !isInstalling &&
              (isTauri ? (
                <button
                  type="button"
                  onClick={() => onOpenReleaseUrl(updateInfo.release_url)}
                  className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#555555] dark:text-[#B5B5B5] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Ver en GitHub</span>
                </button>
              ) : (
                <a
                  href={updateInfo.release_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="h-8 px-2.5 rounded-md text-[12px] font-medium text-[#555555] dark:text-[#B5B5B5] hover:bg-black/5 dark:hover:bg-white/10 inline-flex items-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Ver en GitHub</span>
                </a>
              ))}
          </div>

          <div className="flex items-center gap-2">
            {isInstalling ? (
              phase === 'downloading' ? (
                <button
                  type="button"
                  onClick={onCancelDownload}
                  className="h-8 px-3.5 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer"
                >
                  Cancelar descarga
                </button>
              ) : (
                <span className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E]">
                  No cierres Windows mientras finaliza la instalación...
                </span>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="h-8 px-3.5 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] cursor-pointer"
                >
                  Más tarde
                </button>

                {canAutoInstall ? (
                  <button
                    type="button"
                    onClick={onInstallNow}
                    className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Instalar y reiniciar ahora</span>
                  </button>
                ) : (
                  hasExeInstaller &&
                  asset &&
                  !isTauri && (
                    <a
                      href={asset.download_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-8 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Descargar instalador</span>
                    </a>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
