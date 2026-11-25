import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import type {
  AppSettings,
  BootstrapState,
  CacheStatsDto,
  CopyJobResultDto,
  CopyPreflightDto,
  CopyToPcRequest,
  DeleteResultDto,
  DirectoryListing,
  DiskVaultCleanDetectionDto,
  EntryPropertiesDto,
  FinderSettings,
  ImportRootCandidate,
  IndexProgress,
  IndexRefreshReport,
  IndexedEntryDto,
  PathValidationInfo,
  PcQuickFoldersDto,
  SearchRequest,
  SearchResponse,
  ThemeMode,
  UpdateCheckResultDto,
  WatchedRoot,
} from '../types';

export const DEFAULT_SETTINGS: AppSettings = {
  theme_mode: 'system',
  auto_refresh_hours: 3,
  refresh_on_startup: true,
  start_with_windows: false,
  start_minimized_to_tray: true,
  minimize_to_tray: true,
  default_search_filter: 'all',
  default_view_mode: 'list',
  github_repo: '',
  check_updates_on_startup: true,
};

export const INITIAL_INDEX_PROGRESS: IndexProgress = {
  is_running: false,
  current_root_id: null,
  current_root_name: null,
  roots_completed: 0,
  roots_total: 0,
  items_scanned: 0,
  bytes_scanned: 0,
  phase: 'idle',
  last_message: null,
};

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') {
    return err;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return 'Ocurrió un error inesperado al comunicarse con el sistema.';
}

export async function getAppBootstrap(): Promise<BootstrapState> {
  if (!isTauriRuntime()) {
    return {
      is_portable: false,
      data_dir: '',
      roots: [],
      settings: { ...DEFAULT_SETTINGS },
      needs_onboarding: true,
    };
  }
  return invoke<BootstrapState>('get_app_bootstrap');
}

export async function listWatchedRoots(): Promise<WatchedRoot[]> {
  if (!isTauriRuntime()) {
    return [];
  }
  return invoke<WatchedRoot[]>('list_watched_roots');
}

export async function validateNasOrLocalPath(
  path: string,
): Promise<PathValidationInfo> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La verificación de rutas locales y de red SMB requiere ejecutar DiskVault Finder como aplicación de escritorio Tauri en Windows.',
    );
  }
  return invoke<PathValidationInfo>('validate_nas_or_local_path', { path });
}

export async function addWatchedRoot(
  name: string,
  path: string,
): Promise<WatchedRoot> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Para agregar ubicaciones reales en SQLite ejecuta la aplicación de escritorio con Tauri en Windows.',
    );
  }
  return invoke<WatchedRoot>('add_watched_root', { name, path });
}

export async function removeWatchedRoot(id: number): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Para eliminar ubicaciones en SQLite ejecuta la aplicación de escritorio con Tauri en Windows.',
    );
  }
  return invoke<void>('remove_watched_root', { id });
}

export async function toggleWatchedRoot(
  id: number,
  enabled: boolean,
): Promise<WatchedRoot> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Pausar o reactivar ubicaciones requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<WatchedRoot>('toggle_watched_root', { id, enabled });
}

export async function renameWatchedRoot(
  id: number,
  newName: string,
): Promise<WatchedRoot> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Renombrar ubicaciones requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<WatchedRoot>('rename_watched_root', { id, newName });
}

export async function updateThemeMode(mode: ThemeMode): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('update_theme_mode', { mode });
}

export async function getFinderSettings(): Promise<FinderSettings> {
  if (!isTauriRuntime()) {
    return { ...DEFAULT_SETTINGS };
  }
  return invoke<FinderSettings>('get_finder_settings');
}

export async function updateFinderSettings(
  settings: FinderSettings,
): Promise<FinderSettings> {
  if (!isTauriRuntime()) {
    return settings;
  }
  return invoke<FinderSettings>('update_finder_settings', { settings });
}

export async function resetFinderSettings(): Promise<FinderSettings> {
  if (!isTauriRuntime()) {
    return { ...DEFAULT_SETTINGS };
  }
  return invoke<FinderSettings>('reset_finder_settings');
}

export async function openDataFolder(): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Abrir la carpeta de datos solo está disponible en el escritorio de Windows.',
    );
  }
  return invoke<void>('open_data_folder');
}

export async function getCacheStats(): Promise<CacheStatsDto> {
  if (!isTauriRuntime()) {
    return {
      is_portable: false,
      data_dir: '',
      db_path: '',
      db_size_bytes: 0,
      total_roots: 0,
      enabled_roots: 0,
      total_entries: 0,
      total_files: 0,
      total_dirs: 0,
      total_indexed_bytes: 0,
      last_indexed_at: null,
    };
  }
  return invoke<CacheStatsDto>('get_cache_stats');
}

export async function vacuumCacheDb(): Promise<CacheStatsDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Compactar la base de datos SQLite requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<CacheStatsDto>('vacuum_cache_db');
}

export async function clearAllCache(): Promise<CacheStatsDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Vaciar el caché local requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<CacheStatsDto>('clear_all_cache');
}

export async function connectSmbShare(
  uncPath: string,
  username: string,
  password: string,
  rememberInWindows: boolean,
): Promise<PathValidationInfo> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La autenticación SMB con Windows Credential Manager solo está disponible en Windows.',
    );
  }
  return invoke<PathValidationInfo>('connect_smb_share', {
    uncPath,
    username,
    password,
    rememberInWindows,
  });
}

const APP_VERSION_FALLBACK = '1.0.0';

export function isSafeGithubHttpsUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed || trimmed.length > 2048 || /[\s"'<>]/.test(trimmed)) {
    return false;
  }
  return (
    trimmed.startsWith('https://github.com/') ||
    trimmed.startsWith('https://objects.githubusercontent.com/') ||
    trimmed.startsWith('https://release-assets.githubusercontent.com/')
  );
}

function normalizeGithubRepoWeb(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return '';
  }
  const stripped = trimmed
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/^(www\.)?github\.com\//i, '')
    .replace(/^\/+|\/+$/g, '');

  if (
    stripped.includes('://') ||
    stripped.includes('?') ||
    stripped.includes('#')
  ) {
    throw new Error(
      'Usa únicamente un repositorio de GitHub válido en formato usuario/repositorio.',
    );
  }
  const parts = stripped.split('/');
  const owner = (parts[0] ?? '').trim();
  const repo = (parts[1] ?? '').trim().replace(/\.git$/i, '');
  const segRegex = /^[A-Za-z0-9._-]{1,100}$/;
  if (
    !owner ||
    !repo ||
    owner.includes('..') ||
    repo.includes('..') ||
    !segRegex.test(owner) ||
    !segRegex.test(repo)
  ) {
    throw new Error(
      'El repositorio debe tener formato usuario/repositorio (ejemplo: miusuario/diskvault-finder).',
    );
  }
  return `${owner}/${repo}`;
}

function compareSemverWeb(current: string, latest: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('-')[0]
      .split('.')
      .map((n) => Number.parseInt(n, 10) || 0);
  const c = parse(current);
  const l = parse(latest);
  const len = Math.max(c.length, l.length, 3);
  for (let i = 0; i < len; i += 1) {
    const a = c[i] ?? 0;
    const b = l[i] ?? 0;
    if (a !== b) {
      return a < b ? -1 : 1;
    }
  }
  return 0;
}

export async function checkGithubUpdates(
  repoOverride?: string,
): Promise<UpdateCheckResultDto> {
  if (isTauriRuntime()) {
    return invoke<UpdateCheckResultDto>('check_github_updates', {
      repoOverride: repoOverride?.trim() ? repoOverride.trim() : null,
    });
  }

  // Vista previa web: consulta directa segura solo a api.github.com/repos/{owner}/{repo}/releases/latest
  const repo = normalizeGithubRepoWeb(repoOverride ?? '');
  if (!repo) {
    throw new Error(
      'Configura primero tu repositorio de GitHub (por ejemplo: usuario/diskvault-finder).',
    );
  }

  const res = await fetch(
    `https://api.github.com/repos/${repo}/releases/latest`,
    {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    },
  );

  if (res.status === 404) {
    throw new Error(
      `No se encontró un lanzamiento publicado (Release) en github.com/${repo}.`,
    );
  }
  if (res.status === 403 || res.status === 429) {
    throw new Error(
      'GitHub limitó temporalmente las consultas desde tu red. Intenta de nuevo en unos minutos.',
    );
  }
  if (!res.ok) {
    throw new Error(
      `GitHub devolvió una respuesta inesperada (HTTP ${res.status}).`,
    );
  }

  const data = (await res.json()) as {
    tag_name?: string;
    name?: string | null;
    body?: string | null;
    html_url?: string;
    published_at?: string | null;
    assets?: Array<{
      name?: string;
      browser_download_url?: string;
      size?: number;
    }>;
  };

  const latestVersion = (data.tag_name ?? '0.0.0').trim().replace(/^v/i, '');
  const releaseUrl =
    data.html_url && isSafeGithubHttpsUrl(data.html_url)
      ? data.html_url
      : `https://github.com/${repo}/releases`;

  const assets = (data.assets ?? [])
    .filter(
      (a): a is { name: string; browser_download_url: string; size?: number } =>
        Boolean(
          a.name &&
            a.browser_download_url &&
            isSafeGithubHttpsUrl(a.browser_download_url),
        ),
    )
    .map((a) => ({
      name: a.name,
      download_url: a.browser_download_url,
      size_bytes: typeof a.size === 'number' ? a.size : 0,
    }));

  const recommendedAsset =
    assets.find(
      (a) =>
        a.name.toLowerCase().endsWith('.exe') &&
        (a.name.toLowerCase().includes('setup') ||
          a.name.toLowerCase().includes('nsis')),
    ) ??
    assets.find((a) => a.name.toLowerCase().endsWith('.exe')) ??
    assets.find((a) => a.name.toLowerCase().endsWith('.msi')) ??
    assets.find((a) => a.name.toLowerCase().endsWith('.zip')) ??
    null;

  return {
    current_version: APP_VERSION_FALLBACK,
    latest_version: latestVersion,
    has_update: compareSemverWeb(APP_VERSION_FALLBACK, latestVersion) < 0,
    repo,
    release_name: (data.name ?? '').trim() || `v${latestVersion}`,
    release_notes: (data.body ?? '').trim(),
    release_url: releaseUrl,
    published_at: data.published_at ?? null,
    recommended_asset: recommendedAsset,
    assets,
    is_portable: false,
  };
}

export async function openGithubReleaseUrl(url: string): Promise<void> {
  if (!isSafeGithubHttpsUrl(url)) {
    throw new Error(
      'Por seguridad solo se pueden abrir enlaces oficiales HTTPS de GitHub.',
    );
  }
  if (!isTauriRuntime()) {
    throw new Error(
      'Usa el enlace directo para abrir GitHub desde el navegador web.',
    );
  }
  return invoke<void>('open_github_release_url', { url });
}

export async function detectDiskVaultCleanDestinations(): Promise<DiskVaultCleanDetectionDto> {
  if (!isTauriRuntime()) {
    return { found_sources: [], candidates: [] };
  }
  return invoke<DiskVaultCleanDetectionDto>(
    'detect_diskvault_clean_destinations',
  );
}

export async function inspectDiskVaultCleanFile(
  filePath: string,
): Promise<DiskVaultCleanDetectionDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Inspeccionar archivos de DiskVault Clean requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<DiskVaultCleanDetectionDto>('inspect_diskvault_clean_file', {
    filePath,
  });
}

export async function importDiskVaultCleanDestinations(
  candidates: ImportRootCandidate[],
): Promise<WatchedRoot[]> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Importar destinos desde DiskVault Clean requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<WatchedRoot[]>('import_diskvault_clean_destinations', {
    candidates,
  });
}

export async function refreshAllRoots(): Promise<IndexRefreshReport> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La indexación del NAS requiere ejecutar DiskVault Finder en Windows con Tauri.',
    );
  }
  return invoke<IndexRefreshReport>('refresh_all_roots');
}

export async function refreshSingleRoot(
  rootId: number,
): Promise<IndexRefreshReport> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La indexación del NAS requiere ejecutar DiskVault Finder en Windows con Tauri.',
    );
  }
  return invoke<IndexRefreshReport>('refresh_single_root', { rootId });
}

export async function cancelIndexing(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('cancel_indexing');
}

export async function getIndexProgress(): Promise<IndexProgress> {
  if (!isTauriRuntime()) {
    return { ...INITIAL_INDEX_PROGRESS };
  }
  return invoke<IndexProgress>('get_index_progress');
}

export async function searchEntries(
  request: SearchRequest,
): Promise<SearchResponse> {
  if (!isTauriRuntime()) {
    return {
      items: [],
      total_matches: 0,
      elapsed_ms: 0,
      query: request.query,
      filter: request.filter,
    };
  }
  return invoke<SearchResponse>('search_entries', { request });
}

export async function listDirectory(path: string): Promise<DirectoryListing> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La exploración en vivo de carpetas del NAS requiere ejecutar DiskVault Finder en Windows con Tauri.',
    );
  }
  return invoke<DirectoryListing>('list_directory', { path });
}

export async function openWithDefaultApp(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'La apertura de archivos con aplicaciones nativas solo está disponible en el escritorio de Windows.',
    );
  }
  return invoke<void>('open_with_default_app', { path });
}

export async function openWithDialog(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'El diálogo "Abrir con..." solo está disponible en Windows.',
    );
  }
  return invoke<void>('open_with_dialog', { path });
}

export async function revealInWindowsExplorer(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Mostrar en el Explorador de Windows solo está disponible en la aplicación de escritorio Tauri.',
    );
  }
  return invoke<void>('reveal_in_windows_explorer', { path });
}

export async function openPcPathInExplorer(path: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Abrir la carpeta destino en el PC solo está disponible en Windows.',
    );
  }
  return invoke<void>('open_pc_path_in_explorer', { path });
}

export async function createFolderOnNas(
  parentPath: string,
  folderName: string,
): Promise<IndexedEntryDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Crear carpetas en el NAS requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<IndexedEntryDto>('create_folder_on_nas', {
    parentPath,
    folderName,
  });
}

export async function renameEntryOnNas(
  path: string,
  newName: string,
): Promise<IndexedEntryDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Renombrar elementos en el NAS requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<IndexedEntryDto>('rename_entry_on_nas', { path, newName });
}

export async function moveEntryOnNas(
  sourcePath: string,
  destFolderPath: string,
): Promise<IndexedEntryDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Mover elementos en el NAS requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<IndexedEntryDto>('move_entry_on_nas', {
    sourcePath,
    destFolderPath,
  });
}

export async function deleteEntryOnNas(
  path: string,
  permanent: boolean,
): Promise<DeleteResultDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Eliminar elementos en el NAS requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<DeleteResultDto>('delete_entry_on_nas', { path, permanent });
}

export async function getEntryProperties(
  path: string,
): Promise<EntryPropertiesDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Consultar propiedades detalladas requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<EntryPropertiesDto>('get_entry_properties', { path });
}

export async function preflightCopyToPc(
  sourcePaths: string[],
  destDir: string,
): Promise<CopyPreflightDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Copiar desde el NAS hacia el PC requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<CopyPreflightDto>('preflight_copy_to_pc', {
    sourcePaths,
    destDir,
  });
}

export async function startCopyToPc(
  request: CopyToPcRequest,
): Promise<CopyJobResultDto> {
  if (!isTauriRuntime()) {
    throw new Error(
      'Copiar desde el NAS hacia el PC requiere ejecutar DiskVault Finder en Windows.',
    );
  }
  return invoke<CopyJobResultDto>('start_copy_to_pc', { request });
}

export async function pauseOrResumeCopy(paused: boolean): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('pause_or_resume_copy', { paused });
}

export async function cancelActiveCopy(): Promise<void> {
  if (!isTauriRuntime()) {
    return;
  }
  return invoke<void>('cancel_active_copy');
}

export async function getPcQuickFolders(): Promise<PcQuickFoldersDto> {
  if (!isTauriRuntime()) {
    return {
      desktop_dir: null,
      downloads_dir: null,
      documents_dir: null,
    };
  }
  return invoke<PcQuickFoldersDto>('get_pc_quick_folders');
}

export async function pickFolderDialog(title?: string): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error(
      'El selector nativo de carpetas solo está disponible dentro de la ventana de escritorio Tauri.',
    );
  }
  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: title ?? 'Seleccionar carpeta del NAS o disco local',
  });
  if (typeof selected === 'string') {
    return selected;
  }
  return null;
}

export async function pickCleanConfigFileDialog(): Promise<string | null> {
  if (!isTauriRuntime()) {
    throw new Error(
      'El selector nativo de archivos solo está disponible dentro de la ventana de escritorio Tauri.',
    );
  }
  const selected = await openDialog({
    directory: false,
    multiple: false,
    title: 'Seleccionar configuración o base de datos de DiskVault Clean',
    filters: [
      {
        name: 'Configuración DiskVault Clean',
        extensions: ['json', 'db', 'sqlite', 'sqlite3'],
      },
    ],
  });
  if (typeof selected === 'string') {
    return selected;
  }
  return null;
}
