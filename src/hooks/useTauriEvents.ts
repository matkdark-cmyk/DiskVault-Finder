import { useEffect, type RefObject } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  CopyProgressEvent,
  IndexProgress,
  UpdateProgressEvent,
} from '../types';
import { isTauriRuntime } from '../utils/tauri';

interface UseTauriEventsOptions {
  searchInputRef: RefObject<HTMLInputElement | null>;
  onIndexProgress: (progress: IndexProgress) => void;
  onCopyProgress: (progress: CopyProgressEvent) => void;
  onUpdateProgress: (progress: UpdateProgressEvent) => void;
  onRootUpdated: () => void;
  onTrayRefreshRequested: () => void;
}

export function useTauriEvents({
  searchInputRef,
  onIndexProgress,
  onCopyProgress,
  onUpdateProgress,
  onRootUpdated,
  onTrayRefreshRequested,
}: UseTauriEventsOptions): void {
  useEffect(() => {
    const focusSearchInput = (): void => {
      const el = searchInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (
        (event.ctrlKey || event.metaKey) &&
        (event.key === 'k' ||
          event.key === 'K' ||
          event.key === 'f' ||
          event.key === 'F')
      ) {
        event.preventDefault();
        focusSearchInput();
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const unlisteners: UnlistenFn[] = [];
    let isMounted = true;

    const register = <T,>(
      eventName: string,
      handler: (payload: T) => void,
    ): void => {
      void listen<T>(eventName, (event) => {
        handler(event.payload);
      }).then((unlisten) => {
        if (isMounted) {
          unlisteners.push(unlisten);
        } else {
          unlisten();
        }
      });
    };

    if (isTauriRuntime()) {
      register<void>('focus-search', () => {
        focusSearchInput();
      });
      register<void>('tray-refresh-requested', () => {
        onTrayRefreshRequested();
      });
      register<IndexProgress>('index-progress', (payload) => {
        onIndexProgress(payload);
      });
      register<CopyProgressEvent>('copy-progress', (payload) => {
        onCopyProgress(payload);
      });
      register<UpdateProgressEvent>('update:progress', (payload) => {
        onUpdateProgress(payload);
      });
      register<number>('index-root-updated', () => {
        onRootUpdated();
      });
    }

    return () => {
      isMounted = false;
      window.removeEventListener('keydown', handleKeyDown);
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  }, [
    searchInputRef,
    onIndexProgress,
    onCopyProgress,
    onUpdateProgress,
    onRootUpdated,
    onTrayRefreshRequested,
  ]);
}
