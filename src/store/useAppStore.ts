import { create } from 'zustand';
import type {
  AppSettings,
  CacheStatsDto,
  ConflictPolicy,
  CopyProgressEvent,
  DirectoryListing,
  FinderSettings,
  ImportRootCandidate,
  IndexProgress,
  IndexRefreshReport,
  SearchFilter,
  SearchResultItem,
  SettingsTab,
  SortDirection,
  SortField,
  SessionSnapshotDto,
  ThemeMode,
  ToastKind,
  ToastMessage,
  UpdateCheckResultDto,
  UpdateProgressEvent,
  ViewMode,
  WatchedRoot,
  WorkspaceMode,
} from '../types';
import {
  DEFAULT_SETTINGS,
  INITIAL_INDEX_PROGRESS,
  addWatchedRoot,
  cancelActiveCopy,
  cancelIndexing,
  cancelUpdateDownload,
  checkGithubUpdates,
  clearAllCache,
  consumePendingSessionRestore,
  createFolderOnNas,
  deleteEntryOnNas,
  downloadAndInstallUpdate,
  extractErrorMessage,
  getAppBootstrap,
  getIndexProgress,
  importDiskVaultCleanDestinations,
  isTauriRuntime,
  listDirectory,
  listWatchedRoots,
  moveEntryOnNas,
  openDataFolder,
  openGithubReleaseUrl,
  openPcPathInExplorer,
  openWithDefaultApp,
  openWithDialog,
  pauseOrResumeCopy,
  refreshAllRoots,
  refreshSingleRoot,
  removeWatchedRoot,
  renameEntryOnNas,
  renameWatchedRoot,
  resetFinderSettings,
  revealInWindowsExplorer,
  searchEntries,
  startCopyToPc,
  toggleWatchedRoot,
  updateFinderSettings,
  updateThemeMode,
  vacuumCacheDb,
} from '../utils/tauri';

interface AppStoreState {
  isLoading: boolean;
  isTauri: boolean;
  isPortable: boolean;
  dataDir: string;
  roots: WatchedRoot[];
  settings: AppSettings;
  needsOnboarding: boolean;
  selectedRootId: number | null;
  workspaceMode: WorkspaceMode;

  // Navegación estilo Explorador
  currentListing: DirectoryListing | null;
  isLoadingDirectory: boolean;
  directoryError: string | null;
  history: string[];
  historyIndex: number;
  selectedItemPath: string | null;
  viewMode: ViewMode;
  sortField: SortField;
  sortDirection: SortDirection;

  // Búsqueda SQLite FTS5
  searchQuery: string;
  searchFilter: SearchFilter;
  searchResults: SearchResultItem[];
  totalMatches: number;
  searchElapsedMs: number;
  isSearching: boolean;
  searchError: string | null;

  // Indexador
  indexProgress: IndexProgress;

  // Transferencias NAS -> PC
  activeTransfer: CopyProgressEvent | null;

  // Modales, actualizaciones y notificaciones
  isAddRootModalOpen: boolean;
  isSettingsModalOpen: boolean;
  settingsActiveTab: SettingsTab;
  isUpdateModalOpen: boolean;
  isInstallingUpdate: boolean;
  updateProgress: UpdateProgressEvent | null;
  updateInfo: UpdateCheckResultDto | null;
  isCheckingUpdates: boolean;
  updateError: string | null;
  toasts: ToastMessage[];

  bootstrap: () => Promise<void>;
  reloadRoots: () => Promise<void>;
  selectRoot: (rootId: number | null) => void;
  navigateToPath: (
    path: string,
    options?: { pushHistory?: boolean; highlightPath?: string | null },
  ) => Promise<void>;
  goBack: () => Promise<void>;
  goForward: () => Promise<void>;
  goUp: () => Promise<void>;
  refreshCurrentDirectory: () => Promise<void>;
  syncAfterMutation: (highlightPath?: string | null) => Promise<void>;
  setSelectedItemPath: (path: string | null) => void;
  setViewMode: (mode: ViewMode) => void;
  toggleSort: (field: SortField) => void;
  openEntry: (fullPath: string, isDir: boolean) => Promise<void>;
  openEntryWithChooser: (fullPath: string) => Promise<void>;
  revealEntryInExplorer: (fullPath: string) => Promise<void>;
  openCopiedPathInPc: (path: string) => Promise<void>;
  copyPathToClipboard: (fullPath: string) => Promise<void>;

  // Operaciones en vivo sobre el NAS
  createFolder: (parentPath: string, folderName: string) => Promise<void>;
  renameEntry: (path: string, newName: string) => Promise<void>;
  moveEntry: (sourcePath: string, destFolderPath: string) => Promise<void>;
  deleteEntry: (path: string, permanent: boolean) => Promise<void>;

  // Copiador por streaming al PC
  setCopyProgress: (progress: CopyProgressEvent) => void;
  dismissTransfer: () => void;
  launchCopyToPc: (
    sourcePaths: string[],
    destDir: string,
    conflictPolicy: ConflictPolicy,
  ) => Promise<void>;
  togglePauseCopy: () => Promise<void>;
  cancelCopy: () => Promise<void>;

  setSearchQuery: (query: string) => void;
  setSearchFilter: (filter: SearchFilter) => void;
  clearSearchAndReturn: () => void;
  runSearch: () => Promise<void>;
  setIndexProgress: (progress: IndexProgress) => void;
  startRefreshAll: () => Promise<void>;
  startRefreshRoot: (rootId: number) => Promise<void>;
  stopIndexing: () => Promise<void>;
  openAddRootModal: () => void;
  closeAddRootModal: () => void;
  openSettingsModal: (tab?: SettingsTab) => void;
  closeSettingsModal: () => void;
  setSettingsActiveTab: (tab: SettingsTab) => void;
  createRoot: (name: string, path: string) => Promise<WatchedRoot>;
  deleteRoot: (id: number) => Promise<void>;
  toggleRootEnabled: (id: number, enabled: boolean) => Promise<void>;
  renameRootAlias: (id: number, newName: string) => Promise<void>;
  importCleanRoots: (candidates: ImportRootCandidate[]) => Promise<WatchedRoot[]>;
  changeThemeMode: (mode: ThemeMode) => Promise<void>;
  saveFinderSettings: (next: FinderSettings) => Promise<FinderSettings>;
  resetAllSettings: () => Promise<FinderSettings>;
  openAppDataFolder: () => Promise<void>;
  vacuumDatabase: () => Promise<CacheStatsDto>;
  clearCacheEntries: () => Promise<CacheStatsDto>;
  checkForUpdates: (options?: {
    repoOverride?: string;
    silent?: boolean;
  }) => Promise<UpdateCheckResultDto | null>;
  openUpdateModal: () => void;
  closeUpdateModal: () => void;
  setUpdateProgress: (progress: UpdateProgressEvent | null) => void;
  startInstallUpdate: () => Promise<void>;
  abortUpdateDownload: () => Promise<void>;
  openReleaseLink: (url: string) => Promise<void>;
  addToast: (kind: ToastKind, title: string, detail?: string) => void;
  dismissToast: (id: string) => void;
}

let latestSearchSeq = 0;
let latestDirSeq = 0;

function notifyRefreshOutcome(
  report: IndexRefreshReport,
  addToast: (kind: ToastKind, title: string, detail?: string) => void,
): void {
  if (report.cancelled) {
    addToast(
      'info',
      'Indexación cancelada',
      'Se conservó el caché anterior de las ubicaciones no completadas.',
    );
    return;
  }

  if (report.offline_roots > 0 && report.refreshed_roots === 0) {
    addToast(
      'warning',
      'Ubicación sin conexión',
      'El NAS no respondió. Se mantuvo intacto el caché local para seguir buscando.',
    );
    return;
  }

  if (report.offline_roots > 0) {
    addToast(
      'warning',
      'Caché actualizado parcialmente',
      `Se actualizaron ${report.refreshed_roots} ubicaciones (${report.offline_roots} sin conexión conservaron su caché).`,
    );
    return;
  }

  if (report.failed_roots > 0) {
    addToast(
      'error',
      'Error al indexar algunas ubicaciones',
      `${report.failed_roots} ubicaciones reportaron errores durante la lectura.`,
    );
    return;
  }

  addToast(
    'success',
    'Caché actualizado',
    `${report.total_items.toLocaleString('es-ES')} elementos listos para búsqueda instantánea.`,
  );
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  isLoading: true,
  isTauri: isTauriRuntime(),
  isPortable: false,
  dataDir: '',
  roots: [],
  settings: { ...DEFAULT_SETTINGS },
  needsOnboarding: false,
  selectedRootId: null,
  workspaceMode: 'search',

  currentListing: null,
  isLoadingDirectory: false,
  directoryError: null,
  history: [],
  historyIndex: -1,
  selectedItemPath: null,
  viewMode: 'list',
  sortField: 'name',
  sortDirection: 'asc',

  searchQuery: '',
  searchFilter: 'all',
  searchResults: [],
  totalMatches: 0,
  searchElapsedMs: 0,
  isSearching: false,
  searchError: null,

  indexProgress: { ...INITIAL_INDEX_PROGRESS },
  activeTransfer: null,

  isAddRootModalOpen: false,
  isSettingsModalOpen: false,
  settingsActiveTab: 'general',
  isUpdateModalOpen: false,
  isInstallingUpdate: false,
  updateProgress: null,
  updateInfo: null,
  isCheckingUpdates: false,
  updateError: null,
  toasts: [],

  bootstrap: async () => {
    set({ isLoading: true });
    try {
      const [data, progress, pendingSession] = await Promise.all([
        getAppBootstrap(),
        getIndexProgress(),
        consumePendingSessionRestore().catch(() => null),
      ]);

      const validViewMode: ViewMode =
        pendingSession &&
        (pendingSession.view_mode === 'list' ||
          pendingSession.view_mode === 'grid')
          ? pendingSession.view_mode
          : data.settings.default_view_mode;

      const validSearchFilter: SearchFilter =
        pendingSession &&
        (pendingSession.search_filter === 'all' ||
          pendingSession.search_filter === 'file' ||
          pendingSession.search_filter === 'video' ||
          pendingSession.search_filter === 'folder')
          ? pendingSession.search_filter
          : data.settings.default_search_filter;

      const validSortField: SortField =
        pendingSession &&
        (pendingSession.sort_field === 'name' ||
          pendingSession.sort_field === 'modified' ||
          pendingSession.sort_field === 'type' ||
          pendingSession.sort_field === 'size')
          ? pendingSession.sort_field
          : 'name';

      const validSortDirection: SortDirection =
        pendingSession &&
        (pendingSession.sort_direction === 'asc' ||
          pendingSession.sort_direction === 'desc')
          ? pendingSession.sort_direction
          : 'asc';

      const restoredRootId =
        pendingSession?.selected_root_id !== null &&
        pendingSession?.selected_root_id !== undefined &&
        data.roots.some((r) => r.id === pendingSession.selected_root_id)
          ? pendingSession.selected_root_id
          : null;

      const restoredHistory = Array.isArray(pendingSession?.history)
        ? pendingSession.history
        : [];
      const restoredHistoryIndex =
        pendingSession &&
        restoredHistory.length > 0 &&
        pendingSession.history_index >= 0 &&
        pendingSession.history_index < restoredHistory.length
          ? pendingSession.history_index
          : restoredHistory.length - 1;

      set({
        isLoading: false,
        isTauri: isTauriRuntime(),
        isPortable: data.is_portable,
        dataDir: data.data_dir,
        roots: data.roots,
        settings: data.settings,
        viewMode: validViewMode,
        searchFilter: validSearchFilter,
        sortField: validSortField,
        sortDirection: validSortDirection,
        selectedRootId: restoredRootId,
        searchQuery: pendingSession?.search_query ?? '',
        history: restoredHistory,
        historyIndex: restoredHistoryIndex,
        selectedItemPath: pendingSession?.selected_item_path ?? null,
        workspaceMode:
          pendingSession?.workspace_mode === 'browse' &&
          pendingSession.current_path
            ? 'browse'
            : 'search',
        needsOnboarding: data.needs_onboarding,
        isAddRootModalOpen: data.needs_onboarding,
        indexProgress: progress,
      });

      if (pendingSession) {
        if (
          pendingSession.workspace_mode === 'browse' &&
          pendingSession.current_path &&
          data.roots.length > 0
        ) {
          void get().navigateToPath(pendingSession.current_path, {
            pushHistory: false,
            highlightPath: pendingSession.selected_item_path,
          });
        } else if (data.roots.length > 0) {
          void get().runSearch();
        }
        get().addToast(
          'success',
          `Actualizado a DiskVault Finder v${pendingSession.updated_to_version}`,
          'Restauramos exactamente donde estabas trabajando sin perder ningún cambio.',
        );
      } else if (data.roots.length > 0) {
        void get().runSearch();
      }

      if (
        data.settings.check_updates_on_startup &&
        data.settings.github_repo.trim().length > 0
      ) {
        void get().checkForUpdates({
          repoOverride: data.settings.github_repo,
          silent: true,
        });
      }
    } catch (err) {
      set({ isLoading: false });
      get().addToast(
        'error',
        'No se pudo cargar la configuración inicial',
        extractErrorMessage(err),
      );
    }
  },

  reloadRoots: async () => {
    try {
      const roots = await listWatchedRoots();
      set({
        roots,
        needsOnboarding: roots.length === 0,
      });
    } catch {
      // Silencioso en recarga incremental
    }
  },

  selectRoot: (rootId) => {
    if (rootId === null) {
      set({
        selectedRootId: null,
        workspaceMode: 'search',
        selectedItemPath: null,
      });
      return;
    }

    const root = get().roots.find((r) => r.id === rootId);
    if (!root) {
      return;
    }

    const hasActiveSearch =
      get().searchQuery.trim().length > 0 || get().searchFilter !== 'all';

    if (hasActiveSearch) {
      set({
        selectedRootId: rootId,
        workspaceMode: 'search',
        selectedItemPath: null,
      });
    } else {
      set({ selectedRootId: rootId });
      void get().navigateToPath(root.path, { pushHistory: true });
    }
  },

  navigateToPath: async (path, options) => {
    const pushHistory = options?.pushHistory ?? true;
    const highlightPath = options?.highlightPath ?? null;
    const seq = ++latestDirSeq;

    set({
      workspaceMode: 'browse',
      isLoadingDirectory: true,
      directoryError: null,
      searchQuery: '',
      searchFilter: 'all',
      selectedItemPath: highlightPath,
    });

    try {
      const listing = await listDirectory(path);
      if (seq !== latestDirSeq) {
        return;
      }

      set((state) => {
        let nextHistory = state.history;
        let nextIndex = state.historyIndex;

        if (pushHistory) {
          const currentPath =
            state.historyIndex >= 0 ? state.history[state.historyIndex] : null;
          if (
            !currentPath ||
            currentPath.toLowerCase() !== listing.current_path.toLowerCase()
          ) {
            nextHistory = [
              ...state.history.slice(0, state.historyIndex + 1),
              listing.current_path,
            ];
            nextIndex = nextHistory.length - 1;
          }
        }

        return {
          currentListing: listing,
          selectedRootId: listing.root_id,
          isLoadingDirectory: false,
          directoryError: null,
          history: nextHistory,
          historyIndex: nextIndex,
          selectedItemPath: highlightPath,
        };
      });

      if (listing.is_offline) {
        void get().reloadRoots();
      }
    } catch (err) {
      if (seq !== latestDirSeq) {
        return;
      }
      const message = extractErrorMessage(err);
      set({
        isLoadingDirectory: false,
        directoryError: message,
      });
      get().addToast('error', 'No se pudo abrir la carpeta', message);
    }
  },

  goBack: async () => {
    const { history, historyIndex, workspaceMode } = get();
    if (workspaceMode === 'search' && historyIndex >= 0 && history[historyIndex]) {
      await get().navigateToPath(history[historyIndex], { pushHistory: false });
      return;
    }
    if (historyIndex <= 0) {
      return;
    }
    const nextIdx = historyIndex - 1;
    set({ historyIndex: nextIdx });
    await get().navigateToPath(history[nextIdx], { pushHistory: false });
  },

  goForward: async () => {
    const { history, historyIndex } = get();
    if (historyIndex < 0 || historyIndex >= history.length - 1) {
      return;
    }
    const nextIdx = historyIndex + 1;
    set({ historyIndex: nextIdx });
    await get().navigateToPath(history[nextIdx], { pushHistory: false });
  },

  goUp: async () => {
    const { currentListing, workspaceMode } = get();
    if (workspaceMode !== 'browse' || !currentListing?.parent_path) {
      return;
    }
    await get().navigateToPath(currentListing.parent_path, {
      pushHistory: true,
    });
  },

  refreshCurrentDirectory: async () => {
    const { currentListing, workspaceMode } = get();
    if (workspaceMode !== 'browse' || !currentListing) {
      return;
    }
    await get().navigateToPath(currentListing.current_path, {
      pushHistory: false,
      highlightPath: get().selectedItemPath,
    });
  },

  syncAfterMutation: async (highlightPath) => {
    await get().reloadRoots();
    const { workspaceMode, currentListing } = get();
    if (workspaceMode === 'browse' && currentListing) {
      await get().navigateToPath(currentListing.current_path, {
        pushHistory: false,
        highlightPath: highlightPath ?? null,
      });
    } else {
      set({ selectedItemPath: highlightPath ?? null });
      await get().runSearch();
    }
  },

  setSelectedItemPath: (path) => {
    set({ selectedItemPath: path });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  toggleSort: (field) => {
    set((state) => {
      if (state.sortField === field) {
        return {
          sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc',
        };
      }
      return {
        sortField: field,
        sortDirection: field === 'modified' || field === 'size' ? 'desc' : 'asc',
      };
    });
  },

  openEntry: async (fullPath, isDir) => {
    if (isDir) {
      await get().navigateToPath(fullPath, { pushHistory: true });
      return;
    }
    try {
      await openWithDefaultApp(fullPath);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo abrir el archivo',
        extractErrorMessage(err),
      );
    }
  },

  openEntryWithChooser: async (fullPath) => {
    try {
      await openWithDialog(fullPath);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo mostrar "Abrir con..."',
        extractErrorMessage(err),
      );
    }
  },

  revealEntryInExplorer: async (fullPath) => {
    try {
      await revealInWindowsExplorer(fullPath);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo abrir en el Explorador de Windows',
        extractErrorMessage(err),
      );
    }
  },

  openCopiedPathInPc: async (path) => {
    try {
      await openPcPathInExplorer(path);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo abrir el destino en el PC',
        extractErrorMessage(err),
      );
    }
  },

  copyPathToClipboard: async (fullPath) => {
    try {
      await navigator.clipboard.writeText(fullPath);
      get().addToast('info', 'Ruta copiada al portapapeles', fullPath);
    } catch {
      get().addToast(
        'error',
        'No se pudo copiar la ruta',
        'Windows no permitió el acceso al portapapeles en este momento.',
      );
    }
  },

  createFolder: async (parentPath, folderName) => {
    const created = await createFolderOnNas(parentPath, folderName);
    await get().syncAfterMutation(created.full_path);
    get().addToast(
      'success',
      'Carpeta creada',
      `Se creó "${created.name}" y se actualizó el índice local al instante.`,
    );
  },

  renameEntry: async (path, newName) => {
    const updated = await renameEntryOnNas(path, newName);
    await get().syncAfterMutation(updated.full_path);
    get().addToast(
      'success',
      'Elemento renombrado',
      `Ahora se llama "${updated.name}" y ya está disponible en búsquedas.`,
    );
  },

  moveEntry: async (sourcePath, destFolderPath) => {
    const moved = await moveEntryOnNas(sourcePath, destFolderPath);
    await get().syncAfterMutation(null);
    get().addToast(
      'success',
      'Elemento movido',
      `"${moved.name}" se movió y el caché local fue sincronizado.`,
    );
  },

  deleteEntry: async (path, permanent) => {
    const result = await deleteEntryOnNas(path, permanent);
    await get().syncAfterMutation(null);
    get().addToast(
      'info',
      result.used_recycle_bin
        ? 'Enviado a la Papelera de Reciclaje'
        : 'Eliminado permanentemente',
      result.removed_entries > 1
        ? `Se quitaron ${result.removed_entries.toLocaleString('es-ES')} elementos del disco y del caché.`
        : 'El archivo y su registro en el índice local fueron eliminados.',
    );
  },

  setCopyProgress: (progress) => {
    set({ activeTransfer: progress });
  },

  dismissTransfer: () => {
    const current = get().activeTransfer;
    if (
      current &&
      (current.status === 'running' || current.status === 'paused')
    ) {
      return;
    }
    set({ activeTransfer: null });
  },

  launchCopyToPc: async (sourcePaths, destDir, conflictPolicy) => {
    set({
      activeTransfer: {
        job_id: 'pending',
        current_file: 'Preparando copia...',
        files_done: 0,
        files_total: sourcePaths.length,
        bytes_done: 0,
        bytes_total: 0,
        speed_bps: 0,
        eta_seconds: null,
        is_paused: false,
        status: 'running',
        dest_dir: destDir,
        first_output_path: null,
        error_message: null,
      },
    });

    try {
      const result = await startCopyToPc({
        source_paths: sourcePaths,
        dest_dir: destDir,
        conflict_policy: conflictPolicy,
      });

      if (result.status === 'completed') {
        get().addToast(
          'success',
          'Copia al PC completada',
          `${result.files_copied.toLocaleString('es-ES')} ${
            result.files_copied === 1 ? 'archivo copiado' : 'archivos copiados'
          } correctamente.`,
        );
      } else if (result.status === 'cancelled') {
        get().addToast(
          'info',
          'Copia cancelada',
          'Se limpiaron los archivos temporales incompletos en el PC.',
        );
      }
    } catch (err) {
      const msg = extractErrorMessage(err);
      set((state) => ({
        activeTransfer: state.activeTransfer
          ? {
              ...state.activeTransfer,
              status: 'failed',
              is_paused: false,
              error_message: msg,
            }
          : null,
      }));
      get().addToast('error', 'Error al copiar al PC', msg);
    }
  },

  togglePauseCopy: async () => {
    const current = get().activeTransfer;
    if (!current || (current.status !== 'running' && current.status !== 'paused')) {
      return;
    }
    const nextPaused = !current.is_paused;
    await pauseOrResumeCopy(nextPaused);
    set((state) => ({
      activeTransfer: state.activeTransfer
        ? {
            ...state.activeTransfer,
            is_paused: nextPaused,
            status: nextPaused ? 'paused' : 'running',
          }
        : null,
    }));
  },

  cancelCopy: async () => {
    await cancelActiveCopy();
  },

  setSearchQuery: (query) => {
    const trimmed = query.trim();
    const { searchFilter, currentListing } = get();
    if (trimmed.length > 0 || searchFilter !== 'all') {
      set({ searchQuery: query, workspaceMode: 'search', selectedItemPath: null });
    } else if (currentListing) {
      set({ searchQuery: query, workspaceMode: 'browse' });
    } else {
      set({ searchQuery: query, workspaceMode: 'search' });
    }
  },

  setSearchFilter: (filter) => {
    const { searchQuery, currentListing } = get();
    if (filter !== 'all' || searchQuery.trim().length > 0) {
      set({ searchFilter: filter, workspaceMode: 'search', selectedItemPath: null });
    } else if (currentListing) {
      set({ searchFilter: filter, workspaceMode: 'browse' });
    } else {
      set({ searchFilter: filter, workspaceMode: 'search' });
    }
  },

  clearSearchAndReturn: () => {
    const { currentListing } = get();
    set({
      searchQuery: '',
      searchFilter: 'all',
      workspaceMode: currentListing ? 'browse' : 'search',
      selectedItemPath: null,
    });
  },

  runSearch: async () => {
    const seq = ++latestSearchSeq;
    const { searchQuery, searchFilter, selectedRootId, roots } = get();
    if (roots.length === 0) {
      set({
        searchResults: [],
        totalMatches: 0,
        searchElapsedMs: 0,
        isSearching: false,
        searchError: null,
      });
      return;
    }

    set({ isSearching: true, searchError: null });
    try {
      const response = await searchEntries({
        query: searchQuery,
        filter: searchFilter,
        root_id: selectedRootId,
        limit: 300,
        offset: 0,
      });
      if (seq !== latestSearchSeq) {
        return;
      }
      set({
        searchResults: response.items,
        totalMatches: response.total_matches,
        searchElapsedMs: response.elapsed_ms,
        isSearching: false,
        searchError: null,
      });
    } catch (err) {
      if (seq !== latestSearchSeq) {
        return;
      }
      set({
        isSearching: false,
        searchError: extractErrorMessage(err),
      });
    }
  },

  setIndexProgress: (progress) => {
    set({ indexProgress: progress });
  },

  startRefreshAll: async () => {
    if (get().indexProgress.is_running) {
      get().addToast(
        'info',
        'Actualización en curso',
        'Ya se está indexando el caché en segundo plano.',
      );
      return;
    }
    if (get().roots.length === 0) {
      get().openAddRootModal();
      return;
    }
    try {
      const report = await refreshAllRoots();
      await get().reloadRoots();
      if (get().workspaceMode === 'browse') {
        await get().refreshCurrentDirectory();
      } else {
        await get().runSearch();
      }
      notifyRefreshOutcome(report, get().addToast);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo actualizar el caché',
        extractErrorMessage(err),
      );
    }
  },

  startRefreshRoot: async (rootId) => {
    if (get().indexProgress.is_running) {
      get().addToast(
        'info',
        'Actualización en curso',
        'Espera a que termine el escaneo actual o cancélalo primero.',
      );
      return;
    }
    try {
      const report = await refreshSingleRoot(rootId);
      await get().reloadRoots();
      if (
        get().workspaceMode === 'browse' &&
        get().currentListing?.root_id === rootId
      ) {
        await get().refreshCurrentDirectory();
      } else {
        await get().runSearch();
      }
      notifyRefreshOutcome(report, get().addToast);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo actualizar la ubicación',
        extractErrorMessage(err),
      );
    }
  },

  stopIndexing: async () => {
    try {
      await cancelIndexing();
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo cancelar la indexación',
        extractErrorMessage(err),
      );
    }
  },

  openAddRootModal: () => {
    set({ isAddRootModalOpen: true });
  },

  closeAddRootModal: () => {
    set({ isAddRootModalOpen: false });
  },

  openSettingsModal: (tab) => {
    set((state) => ({
      isSettingsModalOpen: true,
      settingsActiveTab: tab ?? state.settingsActiveTab,
    }));
  },

  closeSettingsModal: () => {
    set({ isSettingsModalOpen: false });
  },

  setSettingsActiveTab: (tab) => {
    set({ settingsActiveTab: tab });
  },

  createRoot: async (name, path) => {
    const created = await addWatchedRoot(name, path);
    set((state) => ({
      roots: [...state.roots, created],
      needsOnboarding: false,
      isAddRootModalOpen: false,
      selectedRootId: created.id,
    }));
    get().addToast(
      'success',
      'Ubicación agregada',
      `Iniciando indexación de "${created.name}"...`,
    );
    void get().navigateToPath(created.path, { pushHistory: true });
    void get().startRefreshRoot(created.id);
    return created;
  },

  deleteRoot: async (id) => {
    const target = get().roots.find((r) => r.id === id);
    await removeWatchedRoot(id);
    set((state) => {
      const nextRoots = state.roots.filter((r) => r.id !== id);
      const removedCurrentListing = state.currentListing?.root_id === id;
      return {
        roots: nextRoots,
        selectedRootId:
          state.selectedRootId === id ? null : state.selectedRootId,
        currentListing: removedCurrentListing ? null : state.currentListing,
        workspaceMode: removedCurrentListing ? 'search' : state.workspaceMode,
        history: removedCurrentListing ? [] : state.history,
        historyIndex: removedCurrentListing ? -1 : state.historyIndex,
        needsOnboarding: nextRoots.length === 0,
      };
    });
    void get().runSearch();
    if (target) {
      get().addToast(
        'info',
        'Ubicación eliminada',
        `Se quitó "${target.name}" y su caché local asociado.`,
      );
    }
  },

  toggleRootEnabled: async (id, enabled) => {
    const updated = await toggleWatchedRoot(id, enabled);
    set((state) => ({
      roots: state.roots.map((r) => (r.id === id ? updated : r)),
    }));
    void get().runSearch();
    get().addToast(
      'info',
      enabled ? 'Ubicación reactivada' : 'Ubicación pausada',
      enabled
        ? `"${updated.name}" vuelve a incluirse en búsquedas y actualizaciones automáticas.`
        : `"${updated.name}" fue pausada (su caché local se conserva intacto).`,
    );
  },

  renameRootAlias: async (id, newName) => {
    const updated = await renameWatchedRoot(id, newName);
    set((state) => ({
      roots: state.roots.map((r) => (r.id === id ? updated : r)),
    }));
    get().addToast(
      'success',
      'Nombre actualizado',
      `La ubicación ahora aparece como "${updated.name}".`,
    );
  },

  importCleanRoots: async (candidates) => {
    const added = await importDiskVaultCleanDestinations(candidates);
    if (added.length > 0) {
      await get().reloadRoots();
      get().addToast(
        'success',
        'Destinos importados desde DiskVault Clean',
        `Se agregaron ${added.length.toLocaleString('es-ES')} ${
          added.length === 1 ? 'ubicación nueva' : 'ubicaciones nuevas'
        }. Iniciando indexación...`,
      );
      void get().startRefreshAll();
    } else {
      get().addToast(
        'info',
        'Sin destinos nuevos para importar',
        'Todas las rutas seleccionadas ya estaban configuradas.',
      );
    }
    return added;
  },

  changeThemeMode: async (mode) => {
    const previous = get().settings.theme_mode;
    set((state) => ({
      settings: {
        ...state.settings,
        theme_mode: mode,
      },
    }));
    try {
      await updateThemeMode(mode);
    } catch (err) {
      set((state) => ({
        settings: {
          ...state.settings,
          theme_mode: previous,
        },
      }));
      get().addToast(
        'error',
        'No se pudo cambiar el tema',
        extractErrorMessage(err),
      );
    }
  },

  saveFinderSettings: async (next) => {
    const saved = await updateFinderSettings(next);
    set({
      settings: saved,
      viewMode: saved.default_view_mode,
    });
    return saved;
  },

  resetAllSettings: async () => {
    const defaults = await resetFinderSettings();
    set({
      settings: defaults,
      viewMode: defaults.default_view_mode,
      searchFilter: defaults.default_search_filter,
    });
    get().addToast(
      'info',
      'Ajustes restablecidos',
      'Se restauraron los valores predeterminados de DiskVault Finder.',
    );
    return defaults;
  },

  openAppDataFolder: async () => {
    try {
      await openDataFolder();
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo abrir la carpeta de datos',
        extractErrorMessage(err),
      );
    }
  },

  vacuumDatabase: async () => {
    const stats = await vacuumCacheDb();
    get().addToast(
      'success',
      'Base de datos compactada',
      'Se optimizó el índice FTS5 y se liberó espacio no utilizado en finder.db.',
    );
    return stats;
  },

  clearCacheEntries: async () => {
    const stats = await clearAllCache();
    await get().reloadRoots();
    if (get().workspaceMode === 'search') {
      await get().runSearch();
    }
    get().addToast(
      'info',
      'Caché local vaciado',
      'Tus ubicaciones siguen guardadas; pulsa "Actualizar" cuando quieras volver a indexar.',
    );
    return stats;
  },

  checkForUpdates: async (options) => {
    const silent = options?.silent ?? false;
    const repoToUse =
      options?.repoOverride?.trim() || get().settings.github_repo.trim();

    set({ isCheckingUpdates: true, updateError: null });
    try {
      const info = await checkGithubUpdates(repoToUse);
      set({
        updateInfo: info,
        isCheckingUpdates: false,
        updateError: null,
      });

      if (info.has_update) {
        set({
          isUpdateModalOpen: true,
          updateProgress: null,
        });
      } else if (!silent) {
        get().addToast(
          'success',
          'DiskVault Finder está actualizado',
          `Ya tienes la última versión publicada (v${info.current_version}).`,
        );
      }

      return info;
    } catch (err) {
      const msg = extractErrorMessage(err);
      set({
        isCheckingUpdates: false,
        updateError: silent ? null : msg,
      });
      if (!silent) {
        get().addToast('error', 'No se pudieron buscar actualizaciones', msg);
      }
      return null;
    }
  },

  openUpdateModal: () => {
    set({
      isUpdateModalOpen: true,
      isSettingsModalOpen: false,
      updateError: null,
    });
  },

  closeUpdateModal: () => {
    const { isInstallingUpdate, updateProgress } = get();
    if (
      isInstallingUpdate &&
      updateProgress?.phase !== 'error' &&
      updateProgress?.phase !== 'cancelled'
    ) {
      return;
    }
    set({
      isUpdateModalOpen: false,
      updateProgress: null,
      updateError: null,
    });
  },

  setUpdateProgress: (progress) => {
    set((state) => ({
      updateProgress: progress,
      isInstallingUpdate:
        progress !== null &&
        progress.phase !== 'error' &&
        progress.phase !== 'cancelled'
          ? true
          : state.isInstallingUpdate,
    }));
  },

  startInstallUpdate: async () => {
    const state = get();
    const { updateInfo, activeTransfer, indexProgress, isInstallingUpdate } =
      state;

    if (isInstallingUpdate) {
      return;
    }

    if (!updateInfo || !updateInfo.has_update || !updateInfo.recommended_asset) {
      set({
        updateError:
          'No se encontró un instalador compatible de Windows (.exe) en este lanzamiento de GitHub.',
      });
      return;
    }

    if (!updateInfo.recommended_asset.name.toLowerCase().endsWith('.exe')) {
      set({
        updateError:
          'La instalación automática requiere un instalador de Windows (.exe) adjunto en el Release.',
      });
      return;
    }

    if (
      activeTransfer &&
      (activeTransfer.status === 'running' || activeTransfer.status === 'paused')
    ) {
      const msg =
        'Hay una copia desde el NAS al PC en curso. Espera a que termine o cancélala antes de reiniciar para actualizar.';
      set({ updateError: msg });
      get().addToast('warning', 'Transferencia activa', msg);
      return;
    }

    if (indexProgress.is_running) {
      try {
        await cancelIndexing();
      } catch {
        // Continuar: SQLite mantiene el caché anterior intacto
      }
    }

    const sessionSnapshot: SessionSnapshotDto = {
      workspace_mode: state.workspaceMode,
      selected_root_id: state.selectedRootId,
      current_path: state.currentListing?.current_path ?? null,
      history: state.history,
      history_index: state.historyIndex,
      selected_item_path: state.selectedItemPath,
      search_query: state.searchQuery,
      search_filter: state.searchFilter,
      view_mode: state.viewMode,
      sort_field: state.sortField,
      sort_direction: state.sortDirection,
      updated_from_version: updateInfo.current_version,
      updated_to_version: updateInfo.latest_version,
    };

    set({
      isInstallingUpdate: true,
      isUpdateModalOpen: true,
      isSettingsModalOpen: false,
      updateError: null,
      updateProgress: {
        phase: 'downloading',
        percent: 0,
        bytes_downloaded: 0,
        bytes_total: updateInfo.recommended_asset.size_bytes,
        speed_bps: 0,
        message: `Conectando con GitHub para descargar v${updateInfo.latest_version}...`,
      },
    });

    try {
      await downloadAndInstallUpdate({
        download_url: updateInfo.recommended_asset.download_url,
        asset_name: updateInfo.recommended_asset.name,
        latest_version: updateInfo.latest_version,
        sha256_url: updateInfo.sha256_url,
        session_snapshot: sessionSnapshot,
      });
    } catch (err) {
      const msg = extractErrorMessage(err);
      const wasCancelled = msg.toLowerCase().includes('cancelad');
      if (wasCancelled) {
        set({
          isInstallingUpdate: false,
          updateProgress: null,
          updateError: null,
        });
        get().addToast(
          'info',
          'Actualización cancelada',
          'Puedes instalar la nueva versión más tarde desde Ajustes → Actualizaciones.',
        );
      } else {
        set({
          isInstallingUpdate: false,
          updateError: msg,
          updateProgress: {
            phase: 'error',
            percent: 0,
            bytes_downloaded: 0,
            bytes_total: 0,
            speed_bps: 0,
            message: msg,
          },
        });
        get().addToast('error', 'No se pudo completar la actualización', msg);
      }
    }
  },

  abortUpdateDownload: async () => {
    try {
      await cancelUpdateDownload();
    } catch {
      // Silencioso si ya finalizó
    }
  },

  openReleaseLink: async (url) => {
    try {
      await openGithubReleaseUrl(url);
    } catch (err) {
      get().addToast(
        'error',
        'No se pudo abrir el enlace de GitHub',
        extractErrorMessage(err),
      );
    }
  },

  addToast: (kind, title, detail) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    set((state) => ({
      toasts: [...state.toasts.slice(-3), { id, kind, title, detail }],
    }));
    window.setTimeout(() => {
      get().dismissToast(id);
    }, 5000);
  },

  dismissToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));
