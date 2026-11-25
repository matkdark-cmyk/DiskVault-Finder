import type { SortDirection, SortField } from '../types';

export interface SortableFileItem {
  name: string;
  extension: string;
  category: string;
  is_dir: boolean;
  size_bytes: number;
  modified_ts: number;
}

const collator = new Intl.Collator('es', {
  numeric: true,
  sensitivity: 'base',
});

export function sortFileItems<T extends SortableFileItem>(
  items: readonly T[],
  field: SortField,
  direction: SortDirection,
): T[] {
  const dir = direction === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    // Estilo Explorador de Windows: siempre agrupar carpetas primero
    if (a.is_dir !== b.is_dir) {
      return a.is_dir ? -1 : 1;
    }

    let cmp = 0;
    switch (field) {
      case 'name':
        cmp = collator.compare(a.name, b.name);
        break;
      case 'modified':
        cmp = a.modified_ts - b.modified_ts;
        break;
      case 'size':
        cmp = a.size_bytes - b.size_bytes;
        break;
      case 'type':
        cmp =
          collator.compare(a.category, b.category) ||
          collator.compare(a.extension, b.extension);
        break;
    }

    if (cmp === 0) {
      return collator.compare(a.name, b.name);
    }
    return cmp * dir;
  });
}
