'use client';

import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2 } from 'lucide-react';
import { MediaCard } from './MediaCard';
import type { DatasetFile } from '@/lib/dataset';

interface VideoGridProps {
  files: DatasetFile[];
  validating: boolean;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onItemClick: (fileId: string) => void;
  onDeleteFile: (fileId: string) => void;
}

export function VideoGrid({ files, validating, selectedIds, onToggleSelect, onItemClick, onDeleteFile }: VideoGridProps) {
  const [focusedIdx, setFocusedIdx] = useState<number | null>(null);

  const handleNavigate = (idx: number, direction: 'prev' | 'next') => {
    const len = files.length;
    const next = direction === 'prev' ? (idx - 1 + len) % len : (idx + 1) % len;
    setFocusedIdx(next);
    document.getElementById(`card-${files[next].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No media files in this dataset.
      </div>
    );
  }

  // Validation summary bar
  const validated = files.filter((f) => f.validation?.status === 'validated');
  const validCount = validated.filter((f) => f.validation!.isValid).length;
  const invalidCount = validated.filter((f) => !f.validation!.isValid).length;
  const pendingCount = files.length - validated.length;
  const total = files.length;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* validation summary */}
      <div className="shrink-0 px-4 py-2 border-b flex items-center gap-3">
        {validating ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="w-3 h-3 animate-spin" />
            Validating {total} items…
          </div>
        ) : (
          <>
            {/* bar */}
            <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
              {total > 0 && (
                <>
                  <div
                    className="bg-emerald-500 transition-all"
                    style={{ width: `${(validCount / total) * 100}%` }}
                  />
                  <div
                    className="bg-destructive transition-all"
                    style={{ width: `${(invalidCount / total) * 100}%` }}
                  />
                </>
              )}
            </div>
            {/* counts */}
            <div className="shrink-0 flex items-center gap-2 text-[11px]">
              {validCount > 0 && (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">{validCount} valid</span>
              )}
              {invalidCount > 0 && (
                <span className="text-destructive font-medium">{invalidCount} invalid</span>
              )}
              {pendingCount > 0 && (
                <span className="text-muted-foreground">{pendingCount} pending</span>
              )}
              {pendingCount === 0 && validCount === 0 && invalidCount === 0 && (
                <span className="text-muted-foreground">No validation data</span>
              )}
            </div>
          </>
        )}
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4"
          onMouseLeave={() => setFocusedIdx(null)}
        >
          {files.map((file, idx) => (
            <MediaCard
              key={file.id}
              file={file}
              index={idx}
              focused={focusedIdx === idx}
              selected={selectedIds.has(file.id)}
              isFirst={idx === 0}
              isLast={idx === files.length - 1}
              onFocus={() => setFocusedIdx(idx)}
              onToggleSelect={() => onToggleSelect(file.id)}
              onNavigate={(dir) => handleNavigate(idx, dir)}
              onItemClick={() => onItemClick(file.id)}
              onDelete={() => onDeleteFile(file.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
