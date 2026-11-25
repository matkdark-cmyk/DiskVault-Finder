import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  FileSearch,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Pencil,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import type {
  CacheStatsDto,
  DiskVaultCleanDetectionDto,
  FinderSettings,
  ImportRootCandidate,
  IndexProgress,
  SearchFilter,
  SettingsTab,
  ThemeMode,
  UpdateCheckResultDto,
  ViewMode,
  WatchedRoot,
} from '../../types';
import {
  formatBytes,
  formatDateTime,
  getRootStatusLabel,
} from '../../utils/format';
import {
  detectDiskVaultCleanDestinations,
  extractErrorMessage,
  getCacheStats,
  inspectDiskVaultCleanFile,
  isSafeGithubHttpsUrl,
  pickCleanConfigFileDialog,
} from '../../utils/tauri';

interface SettingsModalProps {
  isOpen: boolean;
  activeTab: SettingsTab;
  isPortable: boolean;
  isTauri: boolean;
  settings: FinderSettings;
  roots: WatchedRoot[];
  indexProgress: IndexProgress;
  onSelectTab: (tab: SettingsTab) => void;
  onClose: () => void;
  onSaveSettings: (next: FinderSettings) => Promise<FinderSettings>;
  onResetSettings: () => Promise<FinderSettings>;
  onOpenAddRoot: () => void;
  onOpenSmbConnect: () => void;
  onToggleRoot: (id: number, enabled: boolean) => Promise<void>;
  onRenameRoot: (id: number, newName: string) => Promise<void>;
  onRefreshRoot: (id: number) => void;
  onDeleteRoot: (id: number) => Promise<void>;
  onImportCleanDestinations: (
    candidates: ImportRootCandidate[],
  ) => Promise<WatchedRoot[]>;
  onRefreshAll: () => void;
  onOpenDataFolder: () => Promise<void>;
  onVacuumDb: () => Promise<CacheStatsDto>;
  onClearCache: () => Promise<CacheStatsDto>;
  updateInfo: UpdateCheckResultDto | null;
  isCheckingUpdates: boolean;
  isInstallingUpdate: boolean;
  updateError: string | null;
  onCheckUpdates: (repoOverride?: string) => Promise<UpdateCheckResultDto | null>;
  onOpenUpdateModal: () => void;
  onOpenReleaseUrl: (url: string) => Promise<void>;
}

const INTERVAL_OPTIONS: ReadonlyArray<{ hours: number; label: string }> = [
  { hours: 0, label: 'Solo manual (desactivado)' },
  { hours: 1, label: 'Cada 1 hora' },
  { hours: 3, label: 'Cada 3 horas (recomendado)' },
  { hours: 6, label: 'Cada 6 horas' },
  { hours: 12, label: 'Cada 12 horas' },
  { hours: 24, label: 'Cada 24 horas' },
];

const THEME_OPTIONS: ReadonlyArray<{
  id: ThemeMode;
  label: string;
  icon: typeof Monitor;
}> = [
  { id: 'system', label: 'Sistema (Windows)', icon: Monitor },
  { id: 'light', label: 'Modo claro', icon: Sun },
  { id: 'dark', label: 'Modo oscuro', icon: Moon },
];

const FILTER_OPTIONS: ReadonlyArray<{ id: SearchFilter; label: string }> = [
  { id: 'all', label: 'Todos' },
  { id: 'file', label: 'Archivos' },
  { id: 'video', label: 'Videos' },
  { id: 'folder', label: 'Carpetas' },
];

const VIEW_OPTIONS: ReadonlyArray<{ id: ViewMode; label: string }> = [
  { id: 'list', label: 'Lista detallada' },
  { id: 'grid', label: 'Cuadrícula' },
];

const NAV_TABS: ReadonlyArray<{
  id: SettingsTab;
  label: string;
  icon: typeof SlidersHorizontal;
}> = [
  { id: 'general', label: 'General y Apariencia', icon: SlidersHorizontal },
  { id: 'locations', label: 'Ubicaciones y Red', icon: Server },
  { id: 'cache', label: 'Caché e Indexación', icon: Database },
  { id: 'about', label: 'Actualizaciones', icon: Info },
];

export function SettingsModal({
  isOpen,
  activeTab,
  isPortable,
  isTauri,
  settings,
  roots,
  indexProgress,
  onSelectTab,
  onClose,
  onSaveSettings,
  onResetSettings,
  onOpenAddRoot,
  onOpenSmbConnect,
  onToggleRoot,
  onRenameRoot,
  onRefreshRoot,
  onDeleteRoot,
  onImportCleanDestinations,
  onRefreshAll,
  onOpenDataFolder,
  onVacuumDb,
  onClearCache,
  updateInfo,
  isCheckingUpdates,
  isInstallingUpdate,
  updateError,
  onCheckUpdates,
  onOpenUpdateModal,
  onOpenReleaseUrl,
}: SettingsModalProps) {
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [repoInput, setRepoInput] = useState(settings.github_repo);

  // Gestión de raíces inline
  const [editingRootId, setEditingRootId] = useState<number | null>(null);
  const [editingRootName, setEditingRootName] = useState('');
  const [confirmDeleteRootId, setConfirmDeleteRootId] = useState<number | null>(null);

  // Importación DiskVault Clean
  const [cleanResult, setCleanResult] =
    useState<DiskVaultCleanDetectionDto | null>(null);
  const [selectedCleanPaths, setSelectedCleanPaths] = useState<string[]>([]);
  const [isDetectingClean, setIsDetectingClean] = useState(false);
  const [isImportingClean, setIsImportingClean] = useState(false);
  const [cleanError, setCleanError] = useState<string | null>(null);

  // Diagnóstico y mantenimiento del caché
  const [cacheStats, setCacheStats] = useState<CacheStatsDto | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);
  const [isVacuuming, setIsVacuuming] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [confirmingClearCache, setConfirmingClearCache] = useState(false);

  const loadCacheStats = useCallback(async (): Promise<void> => {
    setIsLoadingStats(true);
    try {
      const stats = await getCacheStats();
      setCacheStats(stats);
    } catch {
      // Silencioso en preview web
    } finally {
      setIsLoadingStats(false);
    }
  }, []);

  useEffect(() => {
    setRepoInput(settings.github_repo);
  }, [settings.github_repo]);

  useEffect(() => {
    if (!isOpen) {
      setSettingsError(null);
      setConfirmingReset(false);
      setConfirmingClearCache(false);
      setEditingRootId(null);
      setConfirmDeleteRootId(null);
      return;
    }
    if (activeTab === 'cache') {
      void loadCacheStats();
    }
  }, [isOpen, activeTab, loadCacheStats]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const patchSettings = async (patch: Partial<FinderSettings>): Promise<void> => {
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      await onSaveSettings({ ...settings, ...patch });
    } catch (err) {
      setSettingsError(extractErrorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleReset = async (): Promise<void> => {
    setIsSavingSettings(true);
    setSettingsError(null);
    try {
      await onResetSettings();
      setConfirmingReset(false);
    } catch (err) {
      setSettingsError(extractErrorMessage(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleSaveRootRename = async (id: number): Promise<void> => {
    if (!editingRootName.trim()) {
      return;
    }
    setSettingsError(null);
    try {
      await onRenameRoot(id, editingRootName.trim());
      setEditingRootId(null);
    } catch (err) {
      setSettingsError(extractErrorMessage(err));
    }
  };

  const applyCleanDetection = (dto: DiskVaultCleanDetectionDto): void => {
    setCleanResult(dto);
    const selectable = dto.candidates
      .filter((c) => !c.already_added)
      .map((c) => c.path);
    setSelectedCleanPaths(selectable);
  };

  const handleDetectClean = async (): Promise<void> => {
    setIsDetectingClean(true);
    setCleanError(null);
    try {
      const dto = await detectDiskVaultCleanDestinations();
      applyCleanDetection(dto);
    } catch (err) {
      setCleanError(extractErrorMessage(err));
    } finally {
      setIsDetectingClean(false);
    }
  };

  const handlePickCleanFile = async (): Promise<void> => {
    setCleanError(null);
    try {
      const picked = await pickCleanConfigFileDialog();
      if (!picked) {
        return;
      }
      setIsDetectingClean(true);
      const dto = await inspectDiskVaultCleanFile(picked);
      applyCleanDetection(dto);
    } catch (err) {
      setCleanError(extractErrorMessage(err));
    } finally {
      setIsDetectingClean(false);
    }
  };

  const handleImportClean = async (): Promise<void> => {
    if (!cleanResult) {
      return;
    }
    const chosen: ImportRootCandidate[] = cleanResult.candidates
      .filter((c) => !c.already_added && selectedCleanPaths.includes(c.path))
      .map((c) => ({ name: c.name, path: c.path }));
    if (chosen.length === 0) {
      return;
    }
    setIsImportingClean(true);
    setCleanError(null);
    try {
      await onImportCleanDestinations(chosen);
      // Actualizar estado visual de los candidatos ya agregados
      setCleanResult((prev) =>
        prev
          ? {
              ...prev,
              candidates: prev.candidates.map((c) =>
                selectedCleanPaths.includes(c.path)
                  ? { ...c, already_added: true }
                  : c,
              ),
            }
          : null,
      );
      setSelectedCleanPaths([]);
    } catch (err) {
      setCleanError(extractErrorMessage(err));
    } finally {
      setIsImportingClean(false);
    }
  };

  const handleVacuum = async (): Promise<void> => {
    setIsVacuuming(true);
    setSettingsError(null);
    try {
      const updated = await onVacuumDb();
      setCacheStats(updated);
    } catch (err) {
      setSettingsError(extractErrorMessage(err));
    } finally {
      setIsVacuuming(false);
    }
  };

  const handleClearCache = async (): Promise<void> => {
    setIsClearingCache(true);
    setSettingsError(null);
    try {
      const updated = await onClearCache();
      setCacheStats(updated);
      setConfirmingClearCache(false);
    } catch (err) {
      setSettingsError(extractErrorMessage(err));
    } finally {
      setIsClearingCache(false);
    }
  };

  const handleSaveAndCheckUpdates = async (): Promise<void> => {
    const trimmed = repoInput.trim();
    setSettingsError(null);
    if (trimmed !== settings.github_repo) {
      setIsSavingSettings(true);
      try {
        const saved = await onSaveSettings({
          ...settings,
          github_repo: trimmed,
        });
        setRepoInput(saved.github_repo);
        if (saved.github_repo) {
          await onCheckUpdates(saved.github_repo);
        }
      } catch (err) {
        setSettingsError(extractErrorMessage(err));
      } finally {
        setIsSavingSettings(false);
      }
      return;
    }

    await onCheckUpdates(trimmed);
  };

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
        aria-labelledby="settings-modal-title"
        className="w-full max-w-4xl h-[640px] max-h-[88vh] rounded-xl bg-white dark:bg-[#222222] border border-[#D4D4D4] dark:border-[#3A3A3A] shadow-2xl overflow-hidden flex flex-col"
      >
        {/* Top bar */}
        <div className="px-5 py-3.5 border-b border-[#EAEAEA] dark:border-[#323232] bg-[#F8F8F8] dark:bg-[#1E1E1E] flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <img src="/icon.svg" alt="" className="w-5 h-5 shrink-0" />
            <h2
              id="settings-modal-title"
              className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] truncate"
            >
              Ajustes de DiskVault Finder
            </h2>
            {isSavingSettings && (
              <span className="inline-flex items-center gap-1 text-[11.5px] text-[#0067C0] dark:text-[#60CDFF]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Guardando...</span>
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar ajustes"
            className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#666666] dark:text-[#A0A0A0] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main split body */}
        <div className="flex-1 min-h-0 flex">
          {/* Left vertical navigation */}
          <nav
            aria-label="Secciones de ajustes"
            className="w-56 shrink-0 border-r border-[#EAEAEA] dark:border-[#323232] bg-[#F5F5F5] dark:bg-[#1D1D1D] p-2.5 space-y-1 overflow-y-auto"
          >
            {NAV_TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onSelectTab(tab.id)}
                  className={`w-full px-3 py-2 rounded-md text-left text-[12.5px] flex items-center gap-2.5 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#E5F1FB] dark:bg-[#24394C] text-[#005A9E] dark:text-[#7CD4FF] font-semibold'
                      : 'text-[#2B2B2B] dark:text-[#DCDCDC] hover:bg-black/5 dark:hover:bg-white/5 font-medium'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate flex-1">{tab.label}</span>
                  {tab.id === 'about' && updateInfo?.has_update && (
                    <span
                      className="w-2 h-2 rounded-full bg-[#0067C0] dark:bg-[#60CDFF] shrink-0"
                      aria-label="Actualización disponible"
                    />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Right settings content */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6 space-y-5">
            {settingsError && (
              <div className="p-3 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{settingsError}</span>
              </div>
            )}

            {/* TAB 1: GENERAL Y APARIENCIA */}
            {activeTab === 'general' && (
              <div className="space-y-6">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                      Apariencia y tema de Windows
                    </h3>
                    <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                      Sincroniza la barra de título nativa y toda la interfaz con el tema de tu sistema.
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-2.5">
                    {THEME_OPTIONS.map((opt) => {
                      const Icon = opt.icon;
                      const active = settings.theme_mode === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => void patchSettings({ theme_mode: opt.id })}
                          className={`p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                            active
                              ? 'bg-[#EBF4FC] dark:bg-[#22384A] border-[#0067C0] dark:border-[#60CDFF] text-[#005A9E] dark:text-[#7CD4FF]'
                              : 'bg-white dark:bg-[#272727] border-[#DCDCDC] dark:border-[#3A3A3A] text-[#1A1A1A] dark:text-[#EDEDED] hover:bg-[#F7F7F7] dark:hover:bg-[#2E2E2E]'
                          }`}
                        >
                          <Icon className="w-4 h-4 mb-1.5" />
                          <div className="text-[12.5px] font-semibold">
                            {opt.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className="space-y-3 pt-4 border-t border-[#EAEAEA] dark:border-[#323232]">
                  <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                    Preferencias iniciales del explorador
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label
                        htmlFor="default-view-select"
                        className="block text-[12px] font-medium text-[#333333] dark:text-[#D4D4D4] mb-1.5"
                      >
                        Vista predeterminada
                      </label>
                      <select
                        id="default-view-select"
                        value={settings.default_view_mode}
                        onChange={(event) =>
                          void patchSettings({
                            default_view_mode: event.target.value as ViewMode,
                          })
                        }
                        className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] text-[12.5px] text-[#1A1A1A] dark:text-[#F0F0F0]"
                      >
                        {VIEW_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="default-filter-select"
                        className="block text-[12px] font-medium text-[#333333] dark:text-[#D4D4D4] mb-1.5"
                      >
                        Filtro predeterminado de búsqueda
                      </label>
                      <select
                        id="default-filter-select"
                        value={settings.default_search_filter}
                        onChange={(event) =>
                          void patchSettings({
                            default_search_filter: event.target.value as SearchFilter,
                          })
                        }
                        className="w-full h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] text-[12.5px] text-[#1A1A1A] dark:text-[#F0F0F0]"
                      >
                        {FILTER_OPTIONS.map((opt) => (
                          <option key={opt.id} value={opt.id}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>

                <section className="space-y-3 pt-4 border-t border-[#EAEAEA] dark:border-[#323232]">
                  <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                    Bandeja del sistema e inicio con Windows
                  </h3>

                  <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E6E6E6] dark:border-[#363636] cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                        Minimizar a la bandeja al cerrar la ventana (X)
                      </div>
                      <div className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                        Mantiene la lupa junto al reloj para abrir el buscador en milisegundos y actualizar el caché en segundo plano.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.minimize_to_tray}
                      onChange={(event) =>
                        void patchSettings({
                          minimize_to_tray: event.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[#0067C0] shrink-0"
                    />
                  </label>

                  <div className="p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E6E6E6] dark:border-[#363636] space-y-3">
                    <label
                      className={`flex items-start justify-between gap-4 ${
                        isPortable ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                          Iniciar DiskVault Finder automáticamente con Windows
                        </div>
                        <div className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                          {isPortable
                            ? 'Bloqueado en Modo Portable para garantizar cero modificaciones en el Registro de Windows.'
                            : 'Agrega una entrada limpia en HKCU\\...\\Run para iniciar al encender el PC.'}
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={isPortable}
                        checked={isPortable ? false : settings.start_with_windows}
                        onChange={(event) =>
                          void patchSettings({
                            start_with_windows: event.target.checked,
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[#0067C0] shrink-0"
                      />
                    </label>

                    <label
                      className={`flex items-start justify-between gap-4 pl-4 pt-2.5 border-t border-[#EAEAEA] dark:border-[#363636] ${
                        isPortable || !settings.start_with_windows
                          ? 'opacity-50 cursor-not-allowed'
                          : 'cursor-pointer'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                          Iniciar minimizado en la bandeja del sistema
                        </div>
                        <div className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                          Arranca silenciosamente con el ícono de la lupa sin abrir la ventana sobre tu escritorio.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        disabled={isPortable || !settings.start_with_windows}
                        checked={settings.start_minimized_to_tray}
                        onChange={(event) =>
                          void patchSettings({
                            start_minimized_to_tray: event.target.checked,
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[#0067C0] shrink-0"
                      />
                    </label>
                  </div>
                </section>

                <section className="pt-4 border-t border-[#EAEAEA] dark:border-[#323232] flex items-center justify-between gap-4">
                  <div className="text-[12px] text-[#666666] dark:text-[#9E9E9E]">
                    Restaurar los ajustes predeterminados no elimina tus ubicaciones ni el caché indexado.
                  </div>
                  {confirmingReset ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setConfirmingReset(false)}
                        className="h-8 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12px] font-medium cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleReset()}
                        className="h-8 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] text-white text-[12px] font-semibold cursor-pointer"
                      >
                        Confirmar restablecimiento
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingReset(true)}
                      className="h-8 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#2F2F2F] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#EAEAEA] dark:hover:bg-[#393939] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restablecer ajustes</span>
                    </button>
                  )}
                </section>
              </div>
            )}

            {/* TAB 2: UBICACIONES Y RED (SMB + DISKVAULT CLEAN) */}
            {activeTab === 'locations' && (
              <div className="space-y-6">
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                        Carpetas vigiladas del NAS y discos locales
                      </h3>
                      <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                        Puedes pausar una ubicación para excluirla de búsquedas sin perder su caché local.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={onOpenSmbConnect}
                        className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <KeyRound className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
                        <span>Conectar SMB...</span>
                      </button>
                      <button
                        type="button"
                        onClick={onOpenAddRoot}
                        className="h-8 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                      >
                        <FolderPlus className="w-3.5 h-3.5" />
                        <span>Agregar carpeta</span>
                      </button>
                    </div>
                  </div>

                  {roots.length === 0 ? (
                    <div className="p-6 rounded-lg border border-dashed border-[#D4D4D4] dark:border-[#404040] text-center text-[12.5px] text-[#666666] dark:text-[#9E9E9E]">
                      Aún no hay ubicaciones configuradas. Agrega una carpeta del NAS o impórtalas desde DiskVault Clean.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {roots.map((root) => {
                        const isEditing = editingRootId === root.id;
                        const isConfirmingDel = confirmDeleteRootId === root.id;

                        return (
                          <div
                            key={root.id}
                            className={`p-3 rounded-lg border transition-colors ${
                              root.enabled
                                ? 'bg-[#FAFAFA] dark:bg-[#272727] border-[#E5E5E5] dark:border-[#363636]'
                                : 'bg-[#F5F5F5] dark:bg-[#212121] border-[#E2E2E2] dark:border-[#313131] opacity-75'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-2.5 min-w-0 flex-1">
                                {root.is_network ? (
                                  <Server className="w-4 h-4 mt-0.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
                                ) : (
                                  <HardDrive className="w-4 h-4 mt-0.5 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
                                )}
                                <div className="min-w-0 flex-1">
                                  {isEditing ? (
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={editingRootName}
                                        onChange={(e) =>
                                          setEditingRootName(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            void handleSaveRootRename(root.id);
                                          } else if (e.key === 'Escape') {
                                            setEditingRootId(null);
                                          }
                                        }}
                                        autoFocus
                                        className="h-7 px-2 rounded bg-white dark:bg-[#1C1C1C] border border-[#0067C0] dark:border-[#60CDFF] text-[12.5px] text-[#1A1A1A] dark:text-[#F3F3F3] flex-1 min-w-0"
                                      />
                                      <button
                                        type="button"
                                        onClick={() =>
                                          void handleSaveRootRename(root.id)
                                        }
                                        aria-label="Guardar nombre"
                                        className="h-7 px-2 rounded bg-[#0067C0] text-white text-[11.5px] inline-flex items-center gap-1 cursor-pointer"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => setEditingRootId(null)}
                                        aria-label="Cancelar"
                                        className="h-7 px-2 rounded bg-[#EAEAEA] dark:bg-[#383838] text-[11.5px] cursor-pointer"
                                      >
                                        <X className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-2 min-w-0">
                                      <span className="text-[13px] font-semibold text-[#1A1A1A] dark:text-[#F3F3F3] truncate">
                                        {root.name}
                                      </span>
                                      <span className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] shrink-0">
                                        ·{' '}
                                        {root.enabled
                                          ? getRootStatusLabel(root.status)
                                          : 'Pausada'}
                                      </span>
                                    </div>
                                  )}
                                  <div className="font-mono text-[11.5px] text-[#666666] dark:text-[#989898] truncate mt-0.5">
                                    {root.path}
                                  </div>
                                  <div className="text-[11px] text-[#757575] dark:text-[#8E8E8E] mt-1 tabular-nums">
                                    {root.item_count.toLocaleString('es-ES')} elementos ·{' '}
                                    {formatBytes(root.total_bytes)} ·{' '}
                                    {formatDateTime(root.last_indexed_at)}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <label className="inline-flex items-center gap-1.5 text-[11.5px] text-[#444444] dark:text-[#CCCCCC] mr-1 cursor-pointer select-none">
                                  <input
                                    type="checkbox"
                                    checked={root.enabled}
                                    onChange={(e) =>
                                      void onToggleRoot(root.id, e.target.checked)
                                    }
                                    className="accent-[#0067C0]"
                                  />
                                  <span>Activa</span>
                                </label>

                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRootId(root.id);
                                    setEditingRootName(root.name);
                                  }}
                                  title="Cambiar nombre visible"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#555555] dark:text-[#B5B5B5] hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={indexProgress.is_running || !root.enabled}
                                  onClick={() => onRefreshRoot(root.id)}
                                  title="Actualizar caché de esta ubicación"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#555555] dark:text-[#B5B5B5] hover:text-[#0067C0] dark:hover:text-[#60CDFF] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={indexProgress.is_running}
                                  onClick={() => setConfirmDeleteRootId(root.id)}
                                  title="Quitar ubicación"
                                  className="h-7 w-7 inline-flex items-center justify-center rounded-md text-[#555555] dark:text-[#B5B5B5] hover:text-[#C42B1C] dark:hover:text-[#F87171] hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-40 cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>

                            {isConfirmingDel && (
                              <div className="mt-2.5 pt-2.5 border-t border-[#E5E5E5] dark:border-[#3A3A3A] flex items-center justify-between gap-2 text-[11.5px]">
                                <span className="text-[#9A1F14] dark:text-[#FCA5A5]">
                                  ¿Quitar "{root.name}" de la lista? (Solo borra el índice local, no los archivos del NAS)
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteRootId(null)}
                                    className="h-7 px-2.5 rounded bg-[#EAEAEA] dark:bg-[#383838] cursor-pointer"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      void onDeleteRoot(root.id);
                                      setConfirmDeleteRootId(null);
                                    }}
                                    className="h-7 px-2.5 rounded bg-[#C42B1C] text-white font-medium cursor-pointer"
                                  >
                                    Quitar
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* DiskVault Clean importer */}
                <section className="space-y-3 pt-4 border-t border-[#EAEAEA] dark:border-[#323232]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] flex items-center gap-1.5">
                        <Sparkles className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF]" />
                        <span>Importar destinos desde DiskVault Clean</span>
                      </h3>
                      <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                        Detecta automáticamente los destinos configurados en DiskVault Clean o selecciona su archivo de configuración.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={isDetectingClean}
                        onClick={() => void handleDetectClean()}
                        className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-50"
                      >
                        {isDetectingClean ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <FileSearch className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
                        )}
                        <span>Detectar automáticamente</span>
                      </button>
                      <button
                        type="button"
                        disabled={!isTauri || isDetectingClean}
                        onClick={() => void handlePickCleanFile()}
                        className="h-8 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#2F2F2F] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#EAEAEA] dark:hover:bg-[#383838] text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40"
                      >
                        <FolderOpen className="w-3.5 h-3.5" />
                        <span>Elegir archivo...</span>
                      </button>
                    </div>
                  </div>

                  {cleanError && (
                    <div className="p-2.5 rounded-lg bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
                      {cleanError}
                    </div>
                  )}

                  {cleanResult && (
                    <div className="p-3.5 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E5E5E5] dark:border-[#363636] space-y-3">
                      {cleanResult.candidates.length === 0 ? (
                        <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E]">
                          No se encontraron destinos de DiskVault Clean en las ubicaciones habituales de Windows. Puedes usar <strong>Elegir archivo...</strong> para abrir manualmente su archivo <span className="font-mono">.json</span> o <span className="font-mono">.db</span>.
                        </p>
                      ) : (
                        <>
                          <div className="space-y-1.5 max-h-44 overflow-y-auto">
                            {cleanResult.candidates.map((cand) => {
                              const isChecked = selectedCleanPaths.includes(
                                cand.path,
                              );
                              return (
                                <label
                                  key={cand.path}
                                  className={`flex items-start gap-2.5 p-2 rounded-md border text-[12px] ${
                                    cand.already_added
                                      ? 'opacity-60 border-transparent'
                                      : 'border-[#E6E6E6] dark:border-[#383838] bg-white dark:bg-[#202020] cursor-pointer'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    disabled={cand.already_added}
                                    checked={cand.already_added || isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedCleanPaths((prev) => [
                                          ...prev,
                                          cand.path,
                                        ]);
                                      } else {
                                        setSelectedCleanPaths((prev) =>
                                          prev.filter((p) => p !== cand.path),
                                        );
                                      }
                                    }}
                                    className="mt-0.5 accent-[#0067C0]"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="font-medium text-[#1A1A1A] dark:text-[#F0F0F0] flex items-center gap-2">
                                      <span className="truncate">{cand.name}</span>
                                      <span className="text-[11px] text-[#666666] dark:text-[#9A9A9A] shrink-0">
                                        · {cand.is_network ? 'Red NAS' : 'Local'}
                                        {cand.already_added
                                          ? ' · Ya agregada'
                                          : cand.exists
                                            ? ' · Accesible'
                                            : ' · Sin conexión'}
                                      </span>
                                    </div>
                                    <div className="font-mono text-[11px] text-[#666666] dark:text-[#969696] truncate">
                                      {cand.path}
                                    </div>
                                  </div>
                                </label>
                              );
                            })}
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-1">
                            <span className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] tabular-nums">
                              {selectedCleanPaths.length}{' '}
                              {selectedCleanPaths.length === 1
                                ? 'destino seleccionado'
                                : 'destinos seleccionados'}
                            </span>
                            <button
                              type="button"
                              disabled={
                                isImportingClean ||
                                selectedCleanPaths.length === 0
                              }
                              onClick={() => void handleImportClean()}
                              className="h-8 px-3.5 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-40"
                            >
                              {isImportingClean && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              )}
                              <span>Importar seleccionados</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}

            {/* TAB 3: CACHÉ E INDEXACIÓN AUTOMÁTICA */}
            {activeTab === 'cache' && (
              <div className="space-y-6">
                <section className="space-y-3">
                  <div>
                    <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                      Actualización automática del caché SQLite FTS5
                    </h3>
                    <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                      Los cambios en la programación se aplican inmediatamente sin reiniciar DiskVault Finder. Si el NAS está desconectado, el caché anterior siempre se protege intacto.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="auto-refresh-select"
                        className="block text-[12px] font-medium text-[#333333] dark:text-[#D4D4D4] mb-1.5"
                      >
                        Frecuencia de re-escaneo en segundo plano
                      </label>
                      <select
                        id="auto-refresh-select"
                        value={settings.auto_refresh_hours}
                        onChange={(event) =>
                          void patchSettings({
                            auto_refresh_hours: Number(event.target.value),
                          })
                        }
                        className="w-full max-w-xs h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] text-[12.5px] text-[#1A1A1A] dark:text-[#F0F0F0]"
                      >
                        {INTERVAL_OPTIONS.map((opt) => (
                          <option key={opt.hours} value={opt.hours}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-start justify-between gap-4 p-3 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E6E6E6] dark:border-[#363636] cursor-pointer">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                          Actualizar caché al iniciar la aplicación
                        </div>
                        <div className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                          Comprueba conectividad con tus carpetas del NAS al abrir DiskVault Finder y refresca el índice en segundo plano.
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.refresh_on_startup}
                        onChange={(event) =>
                          void patchSettings({
                            refresh_on_startup: event.target.checked,
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[#0067C0] shrink-0"
                      />
                    </label>
                  </div>
                </section>

                {/* Diagnostics & Maintenance */}
                <section className="space-y-3 pt-4 border-t border-[#EAEAEA] dark:border-[#323232]">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                      Diagnóstico y mantenimiento de la base de datos
                    </h3>
                    <button
                      type="button"
                      onClick={() => void loadCacheStats()}
                      disabled={isLoadingStats}
                      className="text-[12px] text-[#0067C0] dark:text-[#60CDFF] hover:underline cursor-pointer"
                    >
                      Actualizar datos
                    </button>
                  </div>

                  {isLoadingStats && !cacheStats ? (
                    <div className="p-4 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E5E5E5] dark:border-[#363636] flex items-center gap-2 text-[12px] text-[#666666] dark:text-[#9E9E9E]">
                      <Loader2 className="w-4 h-4 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
                      <span>Leyendo métricas de SQLite...</span>
                    </div>
                  ) : cacheStats ? (
                    <div className="p-4 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E5E5E5] dark:border-[#363636] space-y-3">
                      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px]">
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Modo de almacenamiento
                          </dt>
                          <dd className="font-semibold text-[#1A1A1A] dark:text-[#F3F3F3] mt-0.5">
                            {cacheStats.is_portable
                              ? 'Modo Portable'
                              : 'Instalación estándar'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Tamaño de finder.db
                          </dt>
                          <dd className="font-semibold text-[#1A1A1A] dark:text-[#F3F3F3] mt-0.5 tabular-nums">
                            {formatBytes(cacheStats.db_size_bytes)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Elementos indexados
                          </dt>
                          <dd className="font-semibold text-[#1A1A1A] dark:text-[#F3F3F3] mt-0.5 tabular-nums">
                            {cacheStats.total_entries.toLocaleString('es-ES')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Archivos / Carpetas
                          </dt>
                          <dd className="font-medium text-[#1A1A1A] dark:text-[#E8E8E8] mt-0.5 tabular-nums">
                            {cacheStats.total_files.toLocaleString('es-ES')} /{' '}
                            {cacheStats.total_dirs.toLocaleString('es-ES')}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Volumen catalogado
                          </dt>
                          <dd className="font-medium text-[#1A1A1A] dark:text-[#E8E8E8] mt-0.5 tabular-nums">
                            {formatBytes(cacheStats.total_indexed_bytes)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[#666666] dark:text-[#9A9A9A]">
                            Última actualización
                          </dt>
                          <dd className="font-medium text-[#1A1A1A] dark:text-[#E8E8E8] mt-0.5 tabular-nums">
                            {formatDateTime(cacheStats.last_indexed_at)}
                          </dd>
                        </div>
                      </dl>

                      {cacheStats.db_path && (
                        <div className="pt-2.5 border-t border-[#E6E6E6] dark:border-[#363636] text-[11px] text-[#666666] dark:text-[#989898]">
                          <span className="block mb-0.5">Ruta de la base de datos:</span>
                          <span className="font-mono break-all text-[#1A1A1A] dark:text-[#E2E2E2]">
                            {cacheStats.db_path}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void onOpenDataFolder()}
                      className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
                      <span>Abrir carpeta de datos</span>
                    </button>

                    <button
                      type="button"
                      disabled={isVacuuming || indexProgress.is_running}
                      onClick={() => void handleVacuum()}
                      className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      {isVacuuming ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Database className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
                      )}
                      <span>Compactar base de datos (VACUUM)</span>
                    </button>

                    <button
                      type="button"
                      disabled={indexProgress.is_running}
                      onClick={onRefreshAll}
                      className="h-8 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap cursor-pointer disabled:opacity-40"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Actualizar todo ahora</span>
                    </button>
                  </div>

                  {/* Clear cache with inline confirmation */}
                  <div className="pt-3 border-t border-[#EAEAEA] dark:border-[#323232] flex flex-wrap items-center justify-between gap-3">
                    <div className="text-[12px] text-[#666666] dark:text-[#9E9E9E]">
                      Vaciar el caché borra únicamente el índice local en SQLite (nunca toca archivos del NAS).
                    </div>
                    {confirmingClearCache ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={isClearingCache}
                          onClick={() => setConfirmingClearCache(false)}
                          className="h-8 px-3 rounded-md bg-[#F3F3F3] dark:bg-[#303030] border border-[#D4D4D4] dark:border-[#444444] text-[12px] font-medium cursor-pointer"
                        >
                          Cancelar
                        </button>
                        <button
                          type="button"
                          disabled={isClearingCache}
                          onClick={() => void handleClearCache()}
                          className="h-8 px-3 rounded-md bg-[#C42B1C] hover:bg-[#A62215] text-white text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                        >
                          {isClearingCache && (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          )}
                          <span>Confirmar vaciado</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={indexProgress.is_running}
                        onClick={() => setConfirmingClearCache(true)}
                        className="h-8 px-3 rounded-md bg-[#FDF3F2] dark:bg-[#3A2222] border border-[#F2C6C2] dark:border-[#5C3030] hover:bg-[#FADBD8] dark:hover:bg-[#4A2929] text-[12px] font-medium text-[#A62215] dark:text-[#FCA5A5] inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Vaciar caché local</span>
                      </button>
                    )}
                  </div>
                </section>
              </div>
            )}

            {/* TAB 4: ACTUALIZACIONES Y ACERCA DE */}
            {activeTab === 'about' && (
              <div className="space-y-5">
                <div className="flex items-start gap-4 p-4 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E5E5E5] dark:border-[#363636]">
                  <img
                    src="/icon.svg"
                    alt="DiskVault Finder"
                    className="w-12 h-12 shrink-0"
                  />
                  <div>
                    <h3 className="text-[16px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                      DiskVault Finder{' '}
                      <span className="text-[12.5px] font-normal text-[#666666] dark:text-[#9E9E9E] tabular-nums">
                        v{updateInfo?.current_version ?? '1.0.0'}
                      </span>
                    </h3>
                    <p className="text-[12.5px] text-[#555555] dark:text-[#B5B5B5] mt-1 leading-relaxed">
                      Explorador y buscador instantáneo de escritorio para carpetas NAS SMB y discos de respaldo en Windows 10 y 11.
                    </p>
                    <p className="text-[11.5px] text-[#707070] dark:text-[#969696] mt-2">
                      Modo actual:{' '}
                      <strong className="text-[#1A1A1A] dark:text-[#EDEDED]">
                        {isPortable ? 'Portable (cero Registro de Windows)' : 'Instalación Windows x64'}
                      </strong>{' '}
                      · Motor SQLite FTS5 Trigram · Tauri v2 + Rust
                    </p>
                  </div>
                </div>

                {/* Actualizaciones desde repositorio de GitHub */}
                <section className="p-4 rounded-lg bg-[#FAFAFA] dark:bg-[#272727] border border-[#E5E5E5] dark:border-[#363636] space-y-3.5">
                  <div>
                    <h4 className="text-[13.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                      Actualizaciones desde GitHub
                    </h4>
                    <p className="text-[12px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                      Consulta los lanzamientos oficiales (Releases) de tu repositorio en GitHub para descargar nuevas versiones.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor="github-repo-input"
                      className="block text-[12px] font-medium text-[#333333] dark:text-[#D4D4D4]"
                    >
                      Repositorio de GitHub
                    </label>
                    <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                      <input
                        id="github-repo-input"
                        type="text"
                        value={repoInput}
                        onChange={(e) => setRepoInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void handleSaveAndCheckUpdates();
                          }
                        }}
                        placeholder="usuario/diskvault-finder o https://github.com/usuario/repo"
                        className="flex-1 min-w-[200px] h-9 px-3 rounded-md bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] text-[12.5px] font-mono text-[#1A1A1A] dark:text-[#F0F0F0] placeholder:font-sans placeholder:text-[#808080]"
                      />
                      <button
                        type="button"
                        disabled={isCheckingUpdates || isSavingSettings || !repoInput.trim()}
                        onClick={() => void handleSaveAndCheckUpdates()}
                        className="h-9 px-3.5 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-45"
                      >
                        {isCheckingUpdates ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        <span>
                          {isCheckingUpdates
                            ? 'Buscando...'
                            : 'Buscar actualizaciones'}
                        </span>
                      </button>
                    </div>
                  </div>

                  <label className="flex items-start justify-between gap-4 pt-2 border-t border-[#EAEAEA] dark:border-[#363636] cursor-pointer">
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#F0F0F0]">
                        Comprobar actualizaciones automáticamente al iniciar
                      </div>
                      <div className="text-[11.5px] text-[#666666] dark:text-[#9E9E9E] mt-0.5">
                        Solo consulta GitHub si tienes un repositorio configurado arriba.
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.check_updates_on_startup}
                      onChange={(e) =>
                        void patchSettings({
                          check_updates_on_startup: e.target.checked,
                        })
                      }
                      className="mt-1 h-4 w-4 accent-[#0067C0] shrink-0"
                    />
                  </label>

                  {updateError && (
                    <div className="p-3 rounded-md bg-[#FDF3F2] dark:bg-[#331E1E] border border-[#F2C6C2] dark:border-[#5C3030] flex items-start gap-2 text-[12px] text-[#A62215] dark:text-[#FCA5A5]">
                      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{updateError}</span>
                    </div>
                  )}

                  {updateInfo && (
                    <div
                      className={`p-3.5 rounded-md border space-y-2.5 ${
                        updateInfo.has_update
                          ? 'bg-[#EBF4FC] dark:bg-[#1E2E3D] border-[#B6D6F2] dark:border-[#2E506E]'
                          : 'bg-[#F0FAF2] dark:bg-[#1C2D22] border-[#C3E6CB] dark:border-[#2E5238]'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {updateInfo.has_update ? (
                            <Download className="w-4 h-4 text-[#0067C0] dark:text-[#60CDFF] shrink-0" />
                          ) : (
                            <CheckCircle2 className="w-4 h-4 text-[#107C10] dark:text-[#6CCB5F] shrink-0" />
                          )}
                          <span className="text-[12.5px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                            {updateInfo.has_update
                              ? `Nueva versión disponible: v${updateInfo.latest_version}`
                              : `Ya tienes la última versión (v${updateInfo.current_version})`}
                          </span>
                        </div>
                        {updateInfo.published_at && (
                          <span className="text-[11px] text-[#666666] dark:text-[#A3A3A3] tabular-nums">
                            Publicado: {formatDateTime(updateInfo.published_at)}
                          </span>
                        )}
                      </div>

                      {updateInfo.has_update && updateInfo.release_notes && (
                        <div className="max-h-28 overflow-y-auto p-2.5 rounded bg-white/80 dark:bg-[#18222C] border border-[#D4E3F3] dark:border-[#2B4358] text-[11.5px] text-[#333333] dark:text-[#D4DCE4] whitespace-pre-wrap leading-relaxed">
                          {updateInfo.release_notes}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {updateInfo.has_update &&
                          updateInfo.recommended_asset &&
                          isSafeGithubHttpsUrl(
                            updateInfo.recommended_asset.download_url,
                          ) &&
                          (isTauri &&
                          updateInfo.recommended_asset.name
                            .toLowerCase()
                            .endsWith('.exe') ? (
                            <button
                              type="button"
                              disabled={isInstallingUpdate}
                              onClick={onOpenUpdateModal}
                              className="h-8 px-3.5 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>
                                Instalar y reiniciar ahora
                                {updateInfo.recommended_asset.size_bytes > 0
                                  ? ` (${formatBytes(updateInfo.recommended_asset.size_bytes)})`
                                  : ''}
                              </span>
                            </button>
                          ) : isTauri ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onOpenReleaseUrl(
                                  updateInfo.recommended_asset!.download_url,
                                )
                              }
                              className="h-8 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>
                                Descargar {updateInfo.recommended_asset.name}
                                {updateInfo.recommended_asset.size_bytes > 0
                                  ? ` (${formatBytes(updateInfo.recommended_asset.size_bytes)})`
                                  : ''}
                              </span>
                            </button>
                          ) : (
                            <a
                              href={updateInfo.recommended_asset.download_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-8 px-3 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[12px] font-semibold inline-flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>
                                Descargar {updateInfo.recommended_asset.name}
                                {updateInfo.recommended_asset.size_bytes > 0
                                  ? ` (${formatBytes(updateInfo.recommended_asset.size_bytes)})`
                                  : ''}
                              </span>
                            </a>
                          ))}

                        {isSafeGithubHttpsUrl(updateInfo.release_url) &&
                          (isTauri ? (
                            <button
                              type="button"
                              onClick={() =>
                                void onOpenReleaseUrl(updateInfo.release_url)
                              }
                              className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Ver en GitHub</span>
                            </button>
                          ) : (
                            <a
                              href={updateInfo.release_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="h-8 px-3 rounded-md bg-white dark:bg-[#2C2C2C] border border-[#D4D4D4] dark:border-[#424242] hover:bg-[#F3F3F3] dark:hover:bg-[#363636] text-[12px] font-medium text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1.5"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                              <span>Ver en GitHub</span>
                            </a>
                          ))}
                      </div>
                    </div>
                  )}
                </section>

                <div className="p-4 rounded-lg bg-[#F4F8FC] dark:bg-[#1E2A36] border border-[#D4E3F3] dark:border-[#2E465E] flex items-start gap-2.5 text-[12px] text-[#1E4B7A] dark:text-[#93D5FF] leading-relaxed">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Protección de caché sin conexión y privacidad total
                    </p>
                    <p className="mt-0.5">
                      Tus búsquedas, índice SQLite y transferencias ocurren 100% en tu red local. Solo se conecta a GitHub cuando configuras un repositorio para buscar nuevas versiones.
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-[12.5px] font-semibold text-[#1A1A1A] dark:text-[#F0F0F0]">
                    Atajos de teclado
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                    {[
                      ['Ctrl + K', 'Enfocar barra de búsqueda'],
                      ['Ctrl + Shift + N', 'Crear nueva carpeta en el NAS'],
                      ['F2', 'Renombrar elemento seleccionado'],
                      ['Supr', 'Eliminar elemento seleccionado'],
                      ['Alt + ← / →', 'Navegar Atrás / Adelante'],
                      ['Alt + ↑ / Backspace', 'Subir a la carpeta superior'],
                    ].map(([keys, desc]) => (
                      <div
                        key={keys}
                        className="px-3 py-2 rounded-md bg-[#FAFAFA] dark:bg-[#272727] border border-[#EAEAEA] dark:border-[#343434] flex items-center justify-between gap-2"
                      >
                        <span className="text-[#555555] dark:text-[#B5B5B5]">
                          {desc}
                        </span>
                        <kbd className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-white dark:bg-[#1C1C1C] border border-[#D4D4D4] dark:border-[#424242] text-[#1A1A1A] dark:text-[#EDEDED] shrink-0">
                          {keys}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
