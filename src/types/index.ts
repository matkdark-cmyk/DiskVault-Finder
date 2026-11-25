export type ThemeMode = 'system' | 'light' | 'dark';

export type SearchFilter = 'all' | 'file' | 'video' | 'folder';

export type ViewMode = 'list' | 'grid';

export type SortField = 'name' | 'modified' | 'type' | 'size';

export type SortDirection = 'asc' | 'desc';

export type WorkspaceMode = 'browse' | 'search';

export type EntryCategory =
  | 'folder'
  | 'video'
  | 'image'
  | 'audio'
  | 'document'
  | 'archive'
  | 'other';

export type RootStatus = 'pending' | 'indexing' | 'ready' | 'offline' | 'error';

export type IndexPhase =
  | 'idle'
  | 'checking'
  | 'scanning'
  | 'writing'
  | 'done'
  | 'cancelled';

export type ConflictPolicy = 'KeepBoth' | 'Overwrite' | 'Skip';

export type TransferStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type SettingsTab = 'general' | 'locations' | 'cache' | 'about';

export interface AppSettings {
  theme_mode: ThemeMode;
  auto_refresh_hours: number;
  refresh_on_startup: boolean;
  start_with_windows: boolean;
  start_minimized_to_tray: boolean;
  minimize_to_tray: boolean;
  default_search_filter: SearchFilter;
  default_view_mode: ViewMode;
  github_repo: string;
  check_updates_on_startup: boolean;
}

export type FinderSettings = AppSettings;

export interface ReleaseAssetDto {
  name: string;
  download_url: string;
  size_bytes: number;
}

export interface UpdateCheckResultDto {
  current_version: string;
  latest_version: string;
  has_update: boolean;
  repo: string;
  release_name: string;
  release_notes: string;
  release_url: string;
  published_at: string | null;
  recommended_asset: ReleaseAssetDto | null;
  sha256_url: string | null;
  assets: ReleaseAssetDto[];
  is_portable: boolean;
}

export type UpdatePhase =
  | 'downloading'
  | 'verifying'
  | 'installing'
  | 'restarting'
  | 'cancelled'
  | 'error';

export interface UpdateProgressEvent {
  phase: UpdatePhase;
  percent: number;
  bytes_downloaded: number;
  bytes_total: number;
  speed_bps: number;
  message: string;
}

export interface SessionSnapshotDto {
  workspace_mode: WorkspaceMode;
  selected_root_id: number | null;
  current_path: string | null;
  history: string[];
  history_index: number;
  selected_item_path: string | null;
  search_query: string;
  search_filter: SearchFilter;
  view_mode: ViewMode;
  sort_field: SortField;
  sort_direction: SortDirection;
  updated_from_version: string;
  updated_to_version: string;
}

export interface InstallUpdateRequest {
  download_url: string;
  asset_name: string;
  latest_version: string;
  sha256_url: string | null;
  session_snapshot: SessionSnapshotDto;
}

export interface CacheStatsDto {
  is_portable: boolean;
  data_dir: string;
  db_path: string;
  db_size_bytes: number;
  total_roots: number;
  enabled_roots: number;
  total_entries: number;
  total_files: number;
  total_dirs: number;
  total_indexed_bytes: number;
  last_indexed_at: string | null;
}

export interface CleanDestinationCandidate {
  name: string;
  path: string;
  is_network: boolean;
  exists: boolean;
  already_added: boolean;
  source_label: string;
}

export interface DiskVaultCleanDetectionDto {
  found_sources: string[];
  candidates: CleanDestinationCandidate[];
}

export interface ImportRootCandidate {
  name: string;
  path: string;
}

export interface WatchedRoot {
  id: number;
  name: string;
  path: string;
  is_network: boolean;
  enabled: boolean;
  status: RootStatus;
  last_indexed_at: string | null;
  item_count: number;
  total_bytes: number;
  created_at: string;
}

export interface BootstrapState {
  is_portable: boolean;
  data_dir: string;
  roots: WatchedRoot[];
  settings: AppSettings;
  needs_onboarding: boolean;
}

export interface PathValidationInfo {
  normalized_path: string;
  suggested_name: string;
  is_network: boolean;
  exists: boolean;
  is_accessible: boolean;
  free_bytes: number | null;
  total_bytes: number | null;
  message: string;
}

export interface IndexProgress {
  is_running: boolean;
  current_root_id: number | null;
  current_root_name: string | null;
  roots_completed: number;
  roots_total: number;
  items_scanned: number;
  bytes_scanned: number;
  phase: IndexPhase;
  last_message: string | null;
}

export interface IndexRefreshReport {
  refreshed_roots: number;
  offline_roots: number;
  failed_roots: number;
  cancelled: boolean;
  total_items: number;
  total_bytes: number;
}

export interface SearchRequest {
  query: string;
  filter: SearchFilter;
  root_id: number | null;
  limit?: number;
  offset?: number;
}

export interface SearchResultItem {
  id: number;
  root_id: number;
  root_name: string;
  root_status: RootStatus;
  parent_path: string;
  full_path: string;
  name: string;
  extension: string;
  category: EntryCategory;
  is_dir: boolean;
  size_bytes: number;
  modified_ts: number;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total_matches: number;
  elapsed_ms: number;
  query: string;
  filter: string;
}

export interface BreadcrumbSegment {
  name: string;
  path: string;
}

export interface DirectoryItem {
  name: string;
  full_path: string;
  parent_path: string;
  extension: string;
  category: EntryCategory;
  is_dir: boolean;
  size_bytes: number;
  modified_ts: number;
}

export interface DirectoryListing {
  root_id: number;
  root_name: string;
  root_path: string;
  current_path: string;
  parent_path: string | null;
  breadcrumbs: BreadcrumbSegment[];
  items: DirectoryItem[];
  source: 'live' | 'cache';
  is_offline: boolean;
}

export interface IndexedEntryDto {
  root_id: number;
  parent_path: string;
  full_path: string;
  name: string;
  extension: string;
  category: EntryCategory;
  is_dir: boolean;
  size_bytes: number;
  modified_ts: number;
}

export interface DeleteResultDto {
  deleted_path: string;
  used_recycle_bin: boolean;
  removed_entries: number;
  freed_bytes: number;
}

export interface EntryPropertiesDto {
  name: string;
  full_path: string;
  parent_path: string;
  root_name: string;
  is_network: boolean;
  is_dir: boolean;
  category: EntryCategory;
  extension: string;
  size_bytes: number;
  created_ts: number;
  modified_ts: number;
  child_files: number;
  child_dirs: number;
}

export interface PcQuickFoldersDto {
  desktop_dir: string | null;
  downloads_dir: string | null;
  documents_dir: string | null;
}

export interface CopyPreflightDto {
  total_files: number;
  total_dirs: number;
  total_bytes: number;
  conflicting_names: string[];
  dest_free_bytes: number | null;
  dest_total_bytes: number | null;
  has_enough_space: boolean;
  quick_folders: PcQuickFoldersDto;
}

export interface CopyToPcRequest {
  source_paths: string[];
  dest_dir: string;
  conflict_policy: ConflictPolicy;
}

export interface CopyProgressEvent {
  job_id: string;
  current_file: string;
  files_done: number;
  files_total: number;
  bytes_done: number;
  bytes_total: number;
  speed_bps: number;
  eta_seconds: number | null;
  is_paused: boolean;
  status: TransferStatus;
  dest_dir: string;
  first_output_path: string | null;
  error_message: string | null;
}

export interface CopyJobResultDto {
  job_id: string;
  status: TransferStatus;
  files_copied: number;
  files_skipped: number;
  bytes_copied: number;
  dest_dir: string;
  first_output_path: string | null;
}

export interface ActiveEntryTarget {
  name: string;
  full_path: string;
  parent_path: string;
  is_dir: boolean;
  category: EntryCategory;
  extension: string;
  size_bytes: number;
  root_id: number;
  is_network: boolean;
  is_offline: boolean;
  from_search: boolean;
}

export type ContextMenuState =
  | {
      kind: 'entry';
      position: { x: number; y: number };
      target: ActiveEntryTarget;
    }
  | {
      kind: 'background';
      position: { x: number; y: number };
      folderPath: string;
      isOffline: boolean;
    };

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}
