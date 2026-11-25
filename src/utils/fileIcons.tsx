import {
  File,
  FileArchive,
  FileAudio,
  FileImage,
  FileText,
  Film,
  Folder,
} from 'lucide-react';
import type { EntryCategory } from '../types';

interface EntryIconProps {
  category: EntryCategory;
  className?: string;
}

export function EntryIcon({ category, className = 'w-4 h-4 shrink-0' }: EntryIconProps) {
  switch (category) {
    case 'folder':
      return (
        <Folder
          className={`${className} text-[#D99B00] dark:text-[#F5C542] fill-[#F7CA44]/25 dark:fill-[#F5C542]/20`}
        />
      );
    case 'video':
      return <Film className={`${className} text-[#0067C0] dark:text-[#60CDFF]`} />;
    case 'image':
      return <FileImage className={`${className} text-[#15803D] dark:text-[#4ADE80]`} />;
    case 'audio':
      return <FileAudio className={`${className} text-[#7C3AED] dark:text-[#C084FC]`} />;
    case 'document':
      return <FileText className={`${className} text-[#C2410C] dark:text-[#FB923C]`} />;
    case 'archive':
      return <FileArchive className={`${className} text-[#92400E] dark:text-[#FBBF24]`} />;
    case 'other':
    default:
      return <File className={`${className} text-[#64748B] dark:text-[#94A3B8]`} />;
  }
}
