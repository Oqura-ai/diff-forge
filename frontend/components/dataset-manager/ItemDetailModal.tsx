'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  ChevronLeft, ChevronRight,
  Pencil, CheckSquare, Square, MessageSquare,
  CheckCircle2, XCircle, Film, ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DatasetFile } from '@/lib/dataset';

interface ItemDetailModalProps {
  file: DatasetFile;
  allFiles: DatasetFile[];
  selectedIds: Set<string>;
  open: boolean;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onToggleSelect: (id: string) => void;
  onEdit: () => void;
}

export function ItemDetailModal({
  file,
  allFiles,
  selectedIds,
  open,
  onClose,
  onNavigate,
  onToggleSelect,
  onEdit,
}: ItemDetailModalProps) {
  const [showCaption, setShowCaption] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const isSelected = selectedIds.has(file.id);
  const { validation } = file;
  const currentIdx = allFiles.findIndex((f) => f.id === file.id);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
<DialogContent
        className={cn(
          'p-2 gap-2 transition-[width,max-width] duration-300',
          'w-[100vw] max-w-[100vw] h-[100vh] max-h-[100vh] rounded-none',
          'sm:w-auto sm:h-auto sm:max-h-[90vh] sm:rounded-lg',
          showCaption ? 'sm:max-w-[790px]' : 'sm:max-w-[500px]',
        )}
      >
        <div className="flex flex-col sm:flex-row min-h-0 flex-1 sm:flex-initial overflow-hidden">
{/* ── main panel ── */}
          <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
            {/* header */}
            <div className="flex items-center gap-2 px-3 sm:px-4 py-2 sm:py-3 border-b shrink-0">
              <div className="flex-1 min-w-0 flex items-center gap-2">
                {file.type === 'video'
                  ? <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  : <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                <p className="text-sm font-semibold truncate">{file.name}</p>
                <Badge variant="outline" className="text-[10px] font-mono shrink-0 hidden sm:inline-flex">
                  {file.file.name.split('.').pop()?.toLowerCase()}
                </Badge>
              </div>
              {/* item counter + nav */}
              <div className="shrink-0 flex items-center gap-0.5">
                <span className="text-xs text-muted-foreground mr-1">
                  {currentIdx + 1}/{allFiles.length}
                </span>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onNavigate('prev')}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => onNavigate('next')}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* preview */}
            <div className="relative bg-black">
              {file.type === 'video' ? (
                <video
                  ref={videoRef}
                  key={file.id}
                  src={file.mediaUrl}
                  controls
                  loop
                  muted
                  playsInline
                  className="w-full aspect-video object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={file.mediaUrl}
                  alt={file.name}
                  className="w-full aspect-video object-contain"
                />
              )}
              {file.type === 'gif' && (
                <div className="absolute bottom-2 right-2">
                  <Badge className="text-[9px] px-1.5 h-4 bg-black/70 text-white border-0 font-mono">
                    GIF · {(file.validation?.metadata?.frameCount ?? 1)} frames
                  </Badge>
                </div>
              )}
            </div>

            {/* metadata row */}
            <div className="px-3 sm:px-4 py-2 border-b flex items-center gap-2 sm:gap-3 flex-wrap shrink-0">
              {validation?.status === 'validated' && validation.metadata.width > 0 ? (
                <>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {validation.metadata.width}×{validation.metadata.height}
                  </span>
                  {file.type === 'video' && validation.metadata.durationSecs && (
                    <span className="text-[11px] text-muted-foreground">
                      {validation.metadata.durationSecs.toFixed(1)}s · ~{validation.metadata.frameCount}f
                    </span>
                  )}
                  {file.type === 'gif' && validation.metadata.frameCount > 1 && (
                    <span className="text-[11px] text-muted-foreground">
                      {validation.metadata.frameCount} frames (animated)
                    </span>
                  )}
                  {validation.isValid ? (
                    <span className="flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 className="w-3 h-3" /> valid
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-[11px] text-destructive">
                      <XCircle className="w-3 h-3" />
                      {validation.issues.length} issue{validation.issues.length !== 1 && 's'}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">Loading metadata…</span>
              )}
              {file.splits && file.splits.length > 0 && (
                <Badge variant="secondary" className="text-[10px] h-4">
                  {file.splits.length} split{file.splits.length !== 1 && 's'}
                </Badge>
              )}
            </div>

{/* actions */}
            <div className="flex gap-2 px-3 sm:px-4 py-2 sm:py-3 shrink-0">
              <Button
                size="sm"
                variant="default"
                className="gap-1.5 text-xs h-8 flex-1"
                onClick={() => { onClose(); onEdit(); }}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Edit</span>
              </Button>
              <Button
                size="sm"
                variant={isSelected ? 'secondary' : 'outline'}
                className="gap-1.5 text-xs h-8 flex-1"
                onClick={() => onToggleSelect(file.id)}
              >
                {isSelected
                  ? <CheckSquare className="w-3.5 h-3.5" />
                  : <Square className="w-3.5 h-3.5" />}
                <span className="hidden xs:inline">{isSelected ? 'Selected' : 'Select'}</span>
              </Button>
              <Button
                size="sm"
                variant={showCaption ? 'secondary' : 'outline'}
                className="gap-1.5 text-xs h-8 flex-1"
                onClick={() => setShowCaption((v) => !v)}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span className="hidden xs:inline">Caption</span>
              </Button>
            </div>
          </div>

{/* ── caption panel ── */}
          {showCaption && (
            <>
              <Separator orientation="horizontal" className="sm:hidden" />
              <Separator orientation="vertical" className="hidden sm:block" />
              <div className="shrink-0 flex flex-col p-3 sm:p-4 gap-2 sm:w-52 max-h-32 sm:max-h-none overflow-y-auto">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  Caption
                </p>
                {file.caption ? (
                  <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap break-words">
                    {file.caption}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-xs text-muted-foreground italic">No caption for this item.</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      Go to Caption tab to add caption to this item.
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}