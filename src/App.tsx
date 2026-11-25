import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  AlertCircle,
  FolderOpen,
  FolderPlus,
  Loader2,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import { Breadcrumbs } from './components/explorer/Breadcrumbs';
import { CommandBar } from './components/explorer/CommandBar';
import { ContextMenu } from './components/explorer/ContextMenu';
import { DeleteConfirmModal } from './components/explorer/DeleteConfirmModal';
import { FileGridView } from './components/explorer/FileGridView';
import { FileListView } from './components/explorer/FileListView';
import { MoveEntryModal } from './components/explorer/MoveEntryModal';
import { NewFolderModal } from './components/explorer/NewFolderModal';
import { PropertiesModal } from './components/explorer/PropertiesModal';
import { RenameModal } from './components/explorer/RenameModal';
import { SearchResultsView } from './components/explorer/SearchResultsView';
import { SidebarRoots } from './components/layout/SidebarRoots';
import { StatusBar } from './components/layout/StatusBar';
import { TitleSearchBar } from './components/layout/TitleSearchBar';
import { ToastContainer } from './components/layout/ToastContainer';
import { FirstRunSetupModal } from './components/onboarding/FirstRunSetupModal';
import { SettingsModal } from './components/settings/SettingsModal';
import { SmbCredentialsModal } from './components/settings/SmbCredentialsModal';
import { ActiveTransfersBar } from './components/transfer/ActiveTransfersBar';
import { CopyToPcModal } from './components/transfer/CopyToPcModal';
import { useTauriEvents } from './hooks/useTauriEvents';
import { useThemeSync } from './hooks/useThemeSync';
import { useAppStore } from './store/useAppStore';
import type {
  ActiveEntryTarget,
  ContextMenuState,
  DirectoryItem,
  PathValidationInfo,
} from './types';
import { formatBytes } from './utils/format';
import { sortFileItems } from './utils/sort';

export default function App() {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [isNewFolderOpen, setIsNewFolderOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ActiveEntryTarget | null>(null);
  const [moveTarget, setMoveTarget] = useState<ActiveEntryTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ActiveEntryTarget | null>(null);
  const [propertiesTarget, setPropertiesTarget] =
    useState<ActiveEntryTarget | null>(null);
  const [copyTarget, setCopyTarget] = useState<ActiveEntryTarget | null>(null);
  const [smbModalPath, setSmbModalPath] = useState<string | null>(null);

  const {
    isLoading,
    isTauri,
    isPortable,
    roots,
    settings,
    needsOnboarding,
    selectedRootId,
    workspaceMode,
    currentListing,
    isLoadingDirectory,
    directoryError,
    history,
    historyIndex,
    selectedItemPath,
    viewMode,
    sortField,
    sortDirection,
    searchQuery,
    searchFilter,
    searchResults,
    totalMatches,
    searchElapsedMs,
    isSearching,
    searchError,
    indexProgress,
    activeTransfer,
    isAddRootModalOpen,
    isSettingsModalOpen,
    settingsActiveTab,
    updateInfo,
    isCheckingUpdates,
    updateError,
    toasts,
    bootstrap,
    reloadRoots,
    selectRoot,
    navigateToPath,
    goBack,
    goForward,
    goUp,
    refreshCurrentDirectory,
    setSelectedItemPath,
    setViewMode,
    toggleSort,
    openEntry,
    openEntryWithChooser,
    revealEntryInExplorer,
    openCopiedPathInPc,
    copyPathToClipboard,
    createFolder,
    renameEntry,
    moveEntry,
    deleteEntry,
    setCopyProgress,
    dismissTransfer,
    launchCopyToPc,
    togglePauseCopy,
    cancelCopy,
    setSearchQuery,
    setSearchFilter,
    clearSearchAndReturn,
    runSearch,
    setIndexProgress,
    startRefreshAll,
    startRefreshRoot,
    stopIndexing,
    openAddRootModal,
    closeAddRootModal,
    openSettingsModal,
    closeSettingsModal,
    setSettingsActiveTab,
    createRoot,
    deleteRoot,
    toggleRootEnabled,
    renameRootAlias,
    importCleanRoots,
    saveFinderSettings,
    resetAllSettings,
    openAppDataFolder,
    vacuumDatabase,
    clearCacheEntries,
    checkForUpdates,
    openReleaseLink,
    addToast,
    dismissToast,
  } = useAppStore();

  useThemeSync(settings.theme_mode);

  const handleRootUpdated = useCallback((): void => {
    void reloadRoots().then(() => {
      if (useAppStore.getState().workspaceMode === 'search') {
        return runSearch();
      }
      return undefined;
    });
  }, [reloadRoots, runSearch]);

  const handleTrayRefreshRequested = useCallback((): void => {
    addToast(
      'info',
      'Actualizando caché',
      'Comprobando conectividad del NAS y actualizando el índice local...',
    );
  }, [addToast]);

  useTauriEvents({
    searchInputRef,
    onIndexProgress: setIndexProgress,
    onCopyProgress: setCopyProgress,
    onRootUpdated: handleRootUpdated,
    onTrayRefreshRequested: handleTrayRefreshRequested,
  });

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  // Debounced search when in search mode
  useEffect(() => {
    if (isLoading || roots.length === 0 || workspaceMode !== 'search') {
      return;
    }
    const delay = searchQuery.trim().length > 0 ? 120 : 0;
    const timer = window.setTimeout(() => {
      void runSearch();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    isLoading,
    roots.length,
    workspaceMode,
    searchQuery,
    searchFilter,
    selectedRootId,
    runSearch,
  ]);

  const selectedRoot = useMemo(
    () => roots.find((r) => r.id === selectedRootId) ?? null,
    [roots, selectedRootId],
  );

  const sortedDirectoryItems = useMemo(() => {
    if (!currentListing) {
      return [];
    }
    return sortFileItems(currentListing.items, sortField, sortDirection);
  }, [currentListing, sortField, sortDirection]);

  const selectedEntryTarget = useMemo<ActiveEntryTarget | null>(() => {
    if (!selectedItemPath) {
      return null;
    }
    const lowerSelected = selectedItemPath.toLowerCase();

    if (workspaceMode === 'browse' && currentListing) {
      const item = currentListing.items.find(
        (i) => i.full_path.toLowerCase() === lowerSelected,
      );
      if (!item) {
        return null;
      }
      const root = roots.find((r) => r.id === currentListing.root_id);
      return {
        name: item.name,
        full_path: item.full_path,
        parent_path: item.parent_path,
        is_dir: item.is_dir,
        category: item.category,
        extension: item.extension,
        size_bytes: item.size_bytes,
        root_id: currentListing.root_id,
        is_network: root?.is_network ?? false,
        is_offline: currentListing.is_offline || root?.status === 'offline',
        from_search: false,
      };
    }

    if (workspaceMode === 'search') {
      const item = searchResults.find(
        (i) => i.full_path.toLowerCase() === lowerSelected,
      );
      if (!item) {
        return null;
      }
      const root = roots.find((r) => r.id === item.root_id);
      return {
        name: item.name,
        full_path: item.full_path,
        parent_path: item.parent_path,
        is_dir: item.is_dir,
        category: item.category,
        extension: item.extension,
        size_bytes: item.size_bytes,
        root_id: item.root_id,
        is_network: root?.is_network ?? false,
        is_offline:
          item.root_status === 'offline' || root?.status === 'offline',
        from_search: true,
      };
    }

    return null;
  }, [selectedItemPath, workspaceMode, currentListing, searchResults, roots]);

  const anyModalOpen =
    isAddRootModalOpen ||
    isSettingsModalOpen ||
    smbModalPath !== null ||
    isNewFolderOpen ||
    renameTarget !== null ||
    moveTarget !== null ||
    deleteTarget !== null ||
    propertiesTarget !== null ||
    copyTarget !== null;

  const canGoBack =
    workspaceMode === 'search' ? historyIndex >= 0 : historyIndex > 0;
  const canGoForward =
    historyIndex >= 0 && historyIndex < history.length - 1;
  const canGoUp =
    workspaceMode === 'browse' &&
    currentListing?.parent_path !== null &&
    currentListing !== null;

  const hasRunningTransfer =
    activeTransfer !== null &&
    (activeTransfer.status === 'running' || activeTransfer.status === 'paused');

  // Explorer keyboard shortcuts: Alt+Left/Right/Up, Backspace, Enter, F2, Delete, Ctrl+Shift+N
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (anyModalOpen) {
        return;
      }

      const activeTag = (document.activeElement?.tagName ?? '').toLowerCase();
      const isTyping =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        activeTag === 'select';

      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        void goBack();
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        void goForward();
        return;
      }
      if (event.altKey && event.key === 'ArrowUp') {
        event.preventDefault();
        void goUp();
        return;
      }

      if (isTyping) {
        return;
      }

      // Ctrl+Shift+N: Nueva carpeta en modo explorador conectado
      if (
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === 'n'
      ) {
        if (
          workspaceMode === 'browse' &&
          currentListing &&
          !currentListing.is_offline
        ) {
          event.preventDefault();
          setIsNewFolderOpen(true);
        }
        return;
      }

      // F2: Renombrar elemento seleccionado
      if (event.key === 'F2' && selectedEntryTarget && !selectedEntryTarget.is_offline) {
        event.preventDefault();
        setRenameTarget(selectedEntryTarget);
        return;
      }

      // Supr (Delete): Eliminar elemento seleccionado
      if (
        event.key === 'Delete' &&
        selectedEntryTarget &&
        !selectedEntryTarget.is_offline
      ) {
        event.preventDefault();
        setDeleteTarget(selectedEntryTarget);
        return;
      }

      if (event.key === 'Backspace' && canGoUp) {
        event.preventDefault();
        void goUp();
        return;
      }

      if (event.key === 'Enter' && selectedEntryTarget) {
        event.preventDefault();
        void openEntry(selectedEntryTarget.full_path, selectedEntryTarget.is_dir);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    anyModalOpen,
    canGoUp,
    currentListing,
    goBack,
    goForward,
    goUp,
    openEntry,
    selectedEntryTarget,
    workspaceMode,
  ]);

  const selectedLabel = useMemo(() => {
    if (!selectedEntryTarget) {
      return null;
    }
    return selectedEntryTarget.is_dir
      ? selectedEntryTarget.name
      : `${selectedEntryTarget.name} (${formatBytes(selectedEntryTarget.size_bytes)})`;
  }, [selectedEntryTarget]);

  const handleDirectoryItemContextMenu = useCallback(
    (event: MouseEvent, item: DirectoryItem): void => {
      event.preventDefault();
      event.stopPropagation();
      setSelectedItemPath(item.full_path);
      if (!currentListing) {
        return;
      }
      const root = roots.find((r) => r.id === currentListing.root_id);
      setContextMenu({
        kind: 'entry',
        position: { x: event.clientX, y: event.clientY },
        target: {
          name: item.name,
          full_path: item.full_path,
          parent_path: item.parent_path,
          is_dir: item.is_dir,
          category: item.category,
          extension: item.extension,
          size_bytes: item.size_bytes,
          root_id: currentListing.root_id,
          is_network: root?.is_network ?? false,
          is_offline: currentListing.is_offline || root?.status === 'offline',
          from_search: false,
        },
      });
    },
    [currentListing, roots, setSelectedItemPath],
  );

  const handleBackgroundContextMenu = useCallback(
    (event: MouseEvent): void => {
      if (workspaceMode !== 'browse' || !currentListing) {
        return;
      }
      event.preventDefault();
      setContextMenu({
        kind: 'background',
        position: { x: event.clientX, y: event.clientY },
        folderPath: currentListing.current_path,
        isOffline: currentListing.is_offline,
      });
    },
    [workspaceMode, currentListing],
  );

  const handleSearchItemContextMenu = useCallback(
    (event: MouseEvent, target: ActiveEntryTarget): void => {
      setContextMenu({
        kind: 'entry',
        position: { x: event.clientX, y: event.clientY },
        target,
      });
    },
    [],
  );

  const handleSubmitRoot = async (name: string, path: string): Promise<void> => {
    await createRoot(name, path);
  };

  const handleSmbConnected = async (
    info: PathValidationInfo,
    addAsRoot: boolean,
    alias: string,
  ): Promise<void> => {
    if (addAsRoot) {
      await createRoot(alias, info.normalized_path);
    } else {
      addToast('success', 'Conexión SMB verificada', info.message);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-[#F3F3F3] dark:bg-[#1C1C1C] text-[#1A1A1A] dark:text-[#F3F3F3] overflow-hidden">
      {/* Top Explorer + Breadcrumbs + Instant Search bar */}
      <TitleSearchBar
        searchInputRef={searchInputRef}
        selectedRoot={selectedRoot}
        workspaceMode={workspaceMode}
        currentListing={currentListing}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        canGoUp={canGoUp}
        viewMode={viewMode}
        searchQuery={searchQuery}
        searchFilter={searchFilter}
        isIndexing={indexProgress.is_running}
        isSettingsOpen={isSettingsModalOpen}
        hasUpdateAvailable={Boolean(updateInfo?.has_update)}
        onGoBack={() => void goBack()}
        onGoForward={() => void goForward()}
        onGoUp={() => void goUp()}
        onNavigateBreadcrumb={(path) =>
          void navigateToPath(path, { pushHistory: true })
        }
        onViewModeChange={setViewMode}
        onSearchQueryChange={setSearchQuery}
        onSearchFilterChange={setSearchFilter}
        onRefreshClick={() => void startRefreshAll()}
        onCancelIndexingClick={() => void stopIndexing()}
        onOpenSettings={() =>
          openSettingsModal(updateInfo?.has_update ? 'about' : undefined)
        }
      />

      {/* Contextual Windows 11 Command Bar for live NAS operations */}
      {roots.length > 0 && (
        <CommandBar
          workspaceMode={workspaceMode}
          currentListing={currentListing}
          selectedTarget={selectedEntryTarget}
          onNewFolder={() => setIsNewFolderOpen(true)}
          onCopyToPc={(target) => setCopyTarget(target)}
          onRename={(target) => setRenameTarget(target)}
          onMove={(target) => setMoveTarget(target)}
          onDelete={(target) => setDeleteTarget(target)}
          onProperties={(target) => setPropertiesTarget(target)}
        />
      )}

      {/* Main split: Left locations sidebar + Windows Explorer viewport */}
      <div className="flex-1 min-h-0 flex">
        <SidebarRoots
          roots={roots}
          selectedRootId={selectedRootId}
          indexProgress={indexProgress}
          onSelectRoot={selectRoot}
          onOpenAddRoot={openAddRootModal}
          onRefreshRoot={(id) => void startRefreshRoot(id)}
          onRemoveRoot={deleteRoot}
        />

        <main className="flex-1 min-w-0 bg-white dark:bg-[#1C1C1C] flex flex-col overflow-hidden">
          {isLoading ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2.5 text-[#5C5C5C] dark:text-[#A0A0A0]">
              <Loader2 className="w-6 h-6 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
              <span className="text-[13px]">Cargando DiskVault Finder...</span>
            </div>
          ) : roots.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
              <img
                src="/icon.svg"
                alt="DiskVault Finder"
                className="w-14 h-14 mb-4"
              />
              <h1 className="text-[18px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5] text-balance">
                Conecta tu primera carpeta del NAS o disco de respaldo
              </h1>
              <p className="mt-2 max-w-md text-[13px] text-[#5C5C5C] dark:text-[#A3A3A3] leading-relaxed">
                Agrega una ruta de red compartida (
                <span className="font-mono">\\192.168.X.X\Carpeta</span>), una
                unidad mapeada (<span className="font-mono">Z:\</span>) o un
                disco local para explorar y buscar al instante.
              </p>
              <button
                type="button"
                onClick={openAddRootModal}
                className="mt-5 h-9 px-4 rounded-md bg-[#0067C0] hover:bg-[#005A9E] dark:bg-[#4CC2FF] dark:hover:bg-[#60CDFF] text-white dark:text-[#0A1929] text-[13px] font-semibold inline-flex items-center gap-2 transition-colors cursor-pointer"
              >
                <FolderPlus className="w-4 h-4" />
                <span>Agregar primera carpeta</span>
              </button>
            </div>
          ) : workspaceMode === 'browse' ? (
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {/* Subheader with Breadcrumbs and Reload folder button */}
              <div className="px-4 py-2 border-b border-[#EAEAEA] dark:border-[#2D2D2D] bg-[#FAFAFA] dark:bg-[#1F1F1F] flex items-center justify-between gap-3 shrink-0">
                <div className="min-w-0 flex-1">
                  {currentListing ? (
                    <Breadcrumbs
                      segments={currentListing.breadcrumbs}
                      isNetwork={selectedRoot?.is_network ?? false}
                      onNavigate={(path) =>
                        void navigateToPath(path, { pushHistory: true })
                      }
                    />
                  ) : (
                    <span className="text-[12.5px] text-[#666666] dark:text-[#9E9E9E]">
                      Explorador del NAS
                    </span>
                  )}
                </div>

                {currentListing && (
                  <div className="flex items-center gap-2 shrink-0 text-[11.5px] text-[#666666] dark:text-[#9E9E9E]">
                    <span className="hidden md:inline font-mono truncate max-w-[260px]">
                      {currentListing.current_path}
                    </span>
                    <button
                      type="button"
                      onClick={() => void refreshCurrentDirectory()}
                      disabled={isLoadingDirectory}
                      title="Recargar contenido de esta carpeta"
                      className="h-7 px-2.5 rounded-md bg-white dark:bg-[#2B2B2B] border border-[#D8D8D8] dark:border-[#3D3D3D] hover:bg-[#F3F3F3] dark:hover:bg-[#353535] text-[#1A1A1A] dark:text-[#EDEDED] inline-flex items-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <RefreshCw
                        className={`w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF] ${
                          isLoadingDirectory ? 'animate-spin' : ''
                        }`}
                      />
                      <span>Recargar</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Offline fallback banner when browsing cached directory */}
              {currentListing?.is_offline && (
                <div className="px-4 py-2 border-b border-[#EBD6A7] dark:border-[#4D3B1B] bg-[#FFFBEB] dark:bg-[#2A2213] flex items-center justify-between gap-3 text-[12px] text-[#8A5300] dark:text-[#FCD34D] shrink-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <WifiOff className="w-4 h-4 shrink-0" />
                    <span className="truncate">
                      Esta ubicación está sin conexión. Estás explorando el caché local (modificar o copiar archivos requiere reconectar el NAS).
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshCurrentDirectory()}
                    className="text-[12px] font-medium underline hover:no-underline whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {/* Browse content states */}
              {isLoadingDirectory && !currentListing ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-2 text-[#5C5C5C] dark:text-[#A0A0A0]">
                  <Loader2 className="w-6 h-6 animate-spin text-[#0067C0] dark:text-[#60CDFF]" />
                  <span className="text-[12.5px]">Leyendo carpeta...</span>
                </div>
              ) : directoryError && !currentListing ? (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                  <AlertCircle className="w-8 h-8 text-[#C42B1C] dark:text-[#F87171] mb-3" />
                  <h2 className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                    No se pudo abrir esta ubicación
                  </h2>
                  <p className="mt-1 max-w-md text-[12.5px] text-[#5C5C5C] dark:text-[#A3A3A3]">
                    {directoryError}
                  </p>
                </div>
              ) : currentListing && sortedDirectoryItems.length === 0 ? (
                <div
                  className="flex-1 flex flex-col items-center justify-center p-8 text-center"
                  onContextMenu={handleBackgroundContextMenu}
                >
                  <FolderOpen className="w-8 h-8 text-[#8A8A8A] dark:text-[#787878] mb-3" />
                  <h2 className="text-[15px] font-semibold text-[#1A1A1A] dark:text-[#F5F5F5]">
                    Esta carpeta está vacía
                  </h2>
                  <p className="mt-1 text-[12.5px] text-[#5C5C5C] dark:text-[#A3A3A3] font-mono">
                    {currentListing.current_path}
                  </p>
                  {!currentListing.is_offline && (
                    <button
                      type="button"
                      onClick={() => setIsNewFolderOpen(true)}
                      className="mt-4 h-8 px-3.5 rounded-md bg-[#F3F3F3] dark:bg-[#2E2E2E] border border-[#D4D4D4] dark:border-[#404040] hover:bg-[#EAEAEA] dark:hover:bg-[#383838] text-[12.5px] font-medium text-[#1A1A1A] dark:text-[#EAEAEA] inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5 text-[#0067C0] dark:text-[#60CDFF]" />
                      <span>Nueva carpeta aquí</span>
                    </button>
                  )}
                </div>
              ) : viewMode === 'grid' ? (
                <FileGridView
                  items={sortedDirectoryItems}
                  selectedPath={selectedItemPath}
                  onSelect={setSelectedItemPath}
                  onOpen={(item) => void openEntry(item.full_path, item.is_dir)}
                  onContextMenu={handleDirectoryItemContextMenu}
                  onBackgroundContextMenu={handleBackgroundContextMenu}
                />
              ) : (
                <FileListView
                  items={sortedDirectoryItems}
                  selectedPath={selectedItemPath}
                  sortField={sortField}
                  sortDirection={sortDirection}
                  onSelect={setSelectedItemPath}
                  onOpen={(item) => void openEntry(item.full_path, item.is_dir)}
                  onContextMenu={handleDirectoryItemContextMenu}
                  onBackgroundContextMenu={handleBackgroundContextMenu}
                  onToggleSort={toggleSort}
                />
              )}
            </div>
          ) : (
            <SearchResultsView
              items={searchResults}
              totalMatches={totalMatches}
              elapsedMs={searchElapsedMs}
              query={searchQuery}
              filter={searchFilter}
              viewMode={viewMode}
              sortField={sortField}
              sortDirection={sortDirection}
              selectedPath={selectedItemPath}
              selectedRoot={selectedRoot}
              roots={roots}
              isSearching={isSearching}
              searchError={searchError}
              indexProgress={indexProgress}
              onSelectPath={setSelectedItemPath}
              onOpenItem={(item) => void openEntry(item.full_path, item.is_dir)}
              onContextMenu={handleSearchItemContextMenu}
              onToggleSort={toggleSort}
              onRefreshAll={() => void startRefreshAll()}
              onRefreshSingleRoot={(id) => void startRefreshRoot(id)}
              onCancelIndexing={() => void stopIndexing()}
              onClearSearch={clearSearchAndReturn}
            />
          )}
        </main>
      </div>

      {/* Bottom status bar */}
      <StatusBar
        rootCount={roots.length}
        workspaceMode={workspaceMode}
        currentListing={currentListing}
        totalMatches={totalMatches}
        elapsedMs={searchElapsedMs}
        selectedLabel={selectedLabel}
        isPortable={isPortable}
        isTauri={isTauri}
        searchFilter={searchFilter}
        themeMode={settings.theme_mode}
        indexProgress={indexProgress}
        onCancelIndexing={() => void stopIndexing()}
      />

      {/* Right-click context menu (items + empty folder background) */}
      <ContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpen={(target) => void openEntry(target.full_path, target.is_dir)}
        onOpenWith={(target) => void openEntryWithChooser(target.full_path)}
        onCopyToPc={(target) => setCopyTarget(target)}
        onRename={(target) => setRenameTarget(target)}
        onMove={(target) => setMoveTarget(target)}
        onDelete={(target) => setDeleteTarget(target)}
        onOpenParentFolder={(target) =>
          void navigateToPath(target.parent_path, {
            pushHistory: true,
            highlightPath: target.full_path,
          })
        }
        onRevealInExplorer={(path) => void revealEntryInExplorer(path)}
        onCopyPath={(target) => void copyPathToClipboard(target.full_path)}
        onProperties={(target) => setPropertiesTarget(target)}
        onNewFolder={() => setIsNewFolderOpen(true)}
        onRefreshCurrentFolder={() => void refreshCurrentDirectory()}
      />

      {/* Live NAS file operation modals */}
      <NewFolderModal
        isOpen={isNewFolderOpen}
        parentPath={currentListing?.current_path ?? null}
        onClose={() => setIsNewFolderOpen(false)}
        onConfirm={createFolder}
      />

      <RenameModal
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onConfirm={renameEntry}
      />

      <MoveEntryModal
        target={moveTarget}
        roots={roots}
        onClose={() => setMoveTarget(null)}
        onConfirm={moveEntry}
      />

      <DeleteConfirmModal
        target={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={deleteEntry}
      />

      <PropertiesModal
        target={propertiesTarget}
        onClose={() => setPropertiesTarget(null)}
        onCopyPath={(path) => void copyPathToClipboard(path)}
      />

      {/* Streaming copy NAS -> PC modal */}
      <CopyToPcModal
        target={copyTarget}
        isTauri={isTauri}
        hasRunningTransfer={hasRunningTransfer}
        onClose={() => setCopyTarget(null)}
        onStartCopy={(sourcePaths, destDir, conflictPolicy) => {
          void launchCopyToPc(sourcePaths, destDir, conflictPolicy);
        }}
      />

      {/* Non-blocking live transfer progress card */}
      <ActiveTransfersBar
        transfer={activeTransfer}
        onTogglePause={() => void togglePauseCopy()}
        onCancel={() => void cancelCopy()}
        onOpenInPc={(path) => void openCopiedPathInPc(path)}
        onDismiss={dismissTransfer}
      />

      {/* First-run onboarding & Add location modal */}
      <FirstRunSetupModal
        isOpen={isAddRootModalOpen}
        isFirstRun={needsOnboarding}
        isTauri={isTauri}
        onClose={closeAddRootModal}
        onSubmitRoot={handleSubmitRoot}
        onOpenSmbConnect={(initialPath) => {
          closeAddRootModal();
          setSmbModalPath(initialPath);
        }}
      />

      {/* Full Settings modal (General, Locations/SMB/Clean Import, Cache, About) */}
      <SettingsModal
        isOpen={isSettingsModalOpen}
        activeTab={settingsActiveTab}
        isPortable={isPortable}
        isTauri={isTauri}
        settings={settings}
        roots={roots}
        indexProgress={indexProgress}
        onSelectTab={setSettingsActiveTab}
        onClose={closeSettingsModal}
        onSaveSettings={saveFinderSettings}
        onResetSettings={resetAllSettings}
        onOpenAddRoot={() => {
          closeSettingsModal();
          openAddRootModal();
        }}
        onOpenSmbConnect={() => setSmbModalPath('')}
        onToggleRoot={toggleRootEnabled}
        onRenameRoot={renameRootAlias}
        onRefreshRoot={(id) => void startRefreshRoot(id)}
        onDeleteRoot={deleteRoot}
        onImportCleanDestinations={importCleanRoots}
        onRefreshAll={() => void startRefreshAll()}
        onOpenDataFolder={openAppDataFolder}
        onVacuumDb={vacuumDatabase}
        onClearCache={clearCacheEntries}
        updateInfo={updateInfo}
        isCheckingUpdates={isCheckingUpdates}
        updateError={updateError}
        onCheckUpdates={(repoOverride) => checkForUpdates({ repoOverride })}
        onOpenReleaseUrl={openReleaseLink}
      />

      {/* SMB Credentials modal (Windows Credential Manager) */}
      <SmbCredentialsModal
        isOpen={smbModalPath !== null}
        initialPath={smbModalPath ?? ''}
        onClose={() => setSmbModalPath(null)}
        onConnected={handleSmbConnected}
      />

      {/* Toast notifications (auto-lifted above ActiveTransfersBar) */}
      <ToastContainer
        toasts={toasts}
        hasActiveTransfer={activeTransfer !== null}
        onDismiss={dismissToast}
      />
    </div>
  );
}
