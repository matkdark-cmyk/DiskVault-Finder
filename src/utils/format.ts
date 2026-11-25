import type { EntryCategory, RootStatus, SearchFilter, ThemeMode } from '../types';

const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

export function validateWindowsFilenameClient(name: string): string | null {
  if (!name.trim()) {
    return 'El nombre no puede estar vacío.';
  }
  if (name.startsWith(' ')) {
    return 'El nombre no puede comenzar con espacios.';
  }
  if (name.endsWith(' ') || name.endsWith('.')) {
    return 'El nombre no puede terminar en punto ni en espacio.';
  }
  if (name === '.' || name === '..') {
    return 'El nombre no es válido en Windows.';
  }
  if (/[<>:"/\\|?*\u0000-\u001F]/.test(name)) {
    return 'No se permiten los caracteres < > : " / \\ | ? *';
  }
  const stem = (name.split('.')[0] ?? '').trim().toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    return `"${name}" es un nombre reservado por Windows.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / Math.pow(1024, exponent);
  const decimals = exponent === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
}

export function formatSpeed(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
    return '0 MB/s';
  }
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'Calculando...';
  }
  if (seconds === 0) {
    return 'Finalizando...';
  }
  if (seconds < 60) {
    return `${Math.ceil(seconds)} s restantes`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  if (mins < 60) {
    return secs > 0 ? `${mins} min ${secs} s restantes` : `${mins} min restantes`;
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0
    ? `${hours} h ${remMins} min restantes`
    : `${hours} h restantes`;
}

export function formatDateTime(iso: string | null): string {
  if (!iso) {
    return 'Sin indexar aún';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return 'Sin indexar aún';
  }
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatUnixTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function getRootStatusLabel(status: RootStatus): string {
  switch (status) {
    case 'ready':
      return 'En línea';
    case 'indexing':
      return 'Indexando...';
    case 'offline':
      return 'Sin conexión';
    case 'error':
      return 'Con error';
    case 'pending':
    default:
      return 'Pendiente';
  }
}

export function getCategoryLabel(category: EntryCategory, extension: string): string {
  const ext = extension ? ` · ${extension.toUpperCase()}` : '';
  switch (category) {
    case 'folder':
      return 'Carpeta';
    case 'video':
      return `Video${ext}`;
    case 'image':
      return `Imagen${ext}`;
    case 'audio':
      return `Audio${ext}`;
    case 'document':
      return `Documento${ext}`;
    case 'archive':
      return `Comprimido${ext}`;
    case 'other':
    default:
      return extension ? `Archivo · ${extension.toUpperCase()}` : 'Archivo';
  }
}

export function getFilterLabel(filter: SearchFilter): string {
  switch (filter) {
    case 'all':
      return 'Todos';
    case 'file':
      return 'Archivos';
    case 'video':
      return 'Videos';
    case 'folder':
      return 'Carpetas';
  }
}

export function getThemeLabel(mode: ThemeMode): string {
  switch (mode) {
    case 'system':
      return 'Tema del sistema';
    case 'dark':
      return 'Modo oscuro';
    case 'light':
      return 'Modo claro';
  }
}
