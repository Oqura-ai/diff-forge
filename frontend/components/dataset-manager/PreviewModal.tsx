'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { CheckCircle2, XCircle, ArrowRight, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TransformPreviewItem } from '@/lib/api';

interface PreviewModalProps {
  open: boolean;
  items: TransformPreviewItem[];
  datasetName: string;
  totalFiles: number;
  onApply: () => Promise<void>;
  onClose: () => void;
}

export function PreviewModal({
  open, items, datasetName, totalFiles, onApply, onClose,
}: PreviewModalProps) {
  const [applying, setApplying] = useState(false);
  const [enlarged, setEnlarged] = useState<TransformPreviewItem | null>(null);

  const willBeValid = items.filter((i) => i.willBeValid).length;

  const handleApply = async () => {
    setApplying(true);
    await onApply();
    setApplying(false);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && !applying && onClose()}>
        <DialogContent className="w-[95vw] max-w-[680px] max-h-[90vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
            <DialogTitle className="text-base">Transform Preview</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {items.length} sample{items.length !== 1 && 's'} from &quot;{datasetName}&quot; — click any item to enlarge
            </p>
          </DialogHeader>

          <ScrollArea className="flex-1 min-h-0">
            <div className="px-4 py-3 flex flex-col gap-3">
              {items.map((item) => (
                <PreviewRow
                  key={item.fileId}
                  item={item}
                  onEnlarge={() => setEnlarged(item)}
                />
              ))}
            </div>
          </ScrollArea>

          {/* summary */}
          <div className="px-5 py-2 border-t border-b bg-muted/30 flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-xs text-emerald-500 font-medium">{willBeValid} valid</span>
            </div>
            {items.length - willBeValid > 0 && (
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3.5 h-3.5 text-destructive" />
                <span className="text-xs text-destructive font-medium">{items.length - willBeValid} invalid</span>
              </div>
            )}
            <span className="text-xs text-muted-foreground ml-auto">{totalFiles} total</span>
          </div>

          <DialogFooter className="px-5 py-3 gap-2 shrink-0">
            <Button variant="outline" onClick={onClose} disabled={applying}>Cancel</Button>
            <Button onClick={handleApply} disabled={applying} className="gap-1.5">
              {applying ? 'Applying…' : `Apply to all ${totalFiles}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Enlarged view */}
      {enlarged && (
        <Dialog open onOpenChange={() => setEnlarged(null)}>
          <DialogContent className="w-[95vw] max-w-[560px] max-h-[90vh] flex flex-col gap-0 p-0">
            {/* header */}
            <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b shrink-0">
              <p className="text-sm font-semibold truncate flex-1">{enlarged.fileName}</p>
              {enlarged.willBeValid
                ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                : <XCircle className="w-4 h-4 text-destructive shrink-0" />}
              <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => setEnlarged(null)}>
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {/* full-size preview */}
            <div className="shrink-0 bg-black">
              {enlarged.fileType === 'video' ? (
                <video
                  src={enlarged.mediaUrl}
                  controls muted loop playsInline
                  className="w-full max-h-[40vh] object-contain"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={enlarged.mediaUrl}
                  alt={enlarged.fileName}
                  className="w-full max-h-[40vh] object-contain"
                />
              )}
            </div>

            {/* before → after */}
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-4 text-sm">
                <div className="flex flex-col gap-0.5 font-mono text-muted-foreground flex-1">
                  <span className="text-[10px] uppercase tracking-wide mb-0.5">Before</span>
                  <span>{enlarged.before.width}×{enlarged.before.height}</span>
                  {enlarged.fileType !== 'image' && <span>~{enlarged.before.frameCount}f</span>}
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex flex-col gap-0.5 font-mono font-medium flex-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">After</span>
                  <span className={enlarged.willBeValid ? 'text-emerald-500' : 'text-destructive'}>
                    {enlarged.after.width}×{enlarged.after.height}
                  </span>
                  {enlarged.fileType !== 'image' && (
                    <span className={enlarged.willBeValid ? 'text-emerald-500' : 'text-destructive'}>
                      {enlarged.after.frameCount}f
                    </span>
                  )}
                </div>
              </div>

              {enlarged.changes[0] !== 'No changes needed' && (
                <div className="flex flex-wrap gap-1">
                  {enlarged.changes.map((c, i) => (
                    <Badge key={i} variant="secondary"
                      className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-400 border border-amber-500/25">
                      {c}
                    </Badge>
                  ))}
                </div>
              )}

              {enlarged.caption && (
                <p className="text-xs text-muted-foreground italic line-clamp-3 border-t pt-2">
                  {enlarged.caption}
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── Compact list row (static thumbnail, no hover-play) ───────────────────────

function PreviewRow({
  item, onEnlarge,
}: {
  item: TransformPreviewItem;
  onEnlarge: () => void;
}) {
  const { before, after } = item;
  const resChanged = before.width !== after.width || before.height !== after.height;
  const isAnimated = item.fileType !== 'image';
  const framesChanged = isAnimated && before.frameCount !== after.frameCount;
  const hasChanges = item.changes[0] !== 'No changes needed';

  return (
    <div
      className={cn(
        'rounded-lg border overflow-hidden cursor-pointer hover:shadow-md transition-shadow',
        item.willBeValid ? 'border-emerald-500/25' : 'border-destructive/30',
      )}
      onClick={onEnlarge}
    >
      <div className="flex">
        {/* static thumbnail — no hover-play, no auto-load */}
        <div className="relative shrink-0 w-28 sm:w-36 bg-black self-stretch overflow-hidden">
          {item.fileType === 'video' || item.fileType === 'gif' ? (
            <video
              src={item.mediaUrl}
              muted playsInline
              preload="none"   /* ← do NOT load — just show poster/black frame */
              className="w-full h-full object-contain max-h-24"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.mediaUrl} alt={item.fileName}
              className="w-full h-full object-contain max-h-24" />
          )}
          <div className="absolute top-1.5 right-1.5">
            {item.willBeValid
              ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 drop-shadow" />
              : <XCircle className="w-3.5 h-3.5 text-red-400 drop-shadow" />}
          </div>
          <div className="absolute bottom-1 left-1">
            <Badge className="text-[8px] px-1 h-3.5 bg-black/70 text-white border-0 font-mono uppercase">
              {item.fileType}
            </Badge>
          </div>
          {/* expand hint */}
          <div className="absolute inset-0 bg-black/0 hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
            <span className="text-[10px] text-white bg-black/50 rounded px-1.5 py-0.5">Click to expand</span>
          </div>
        </div>

        {/* metadata */}
        <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
          <p className="text-xs font-medium truncate">{item.fileName}</p>

          <div className="flex items-center gap-2 text-[11px]">
            <div className="flex flex-col gap-0.5 font-mono text-muted-foreground">
              <span>{before.width}×{before.height}</span>
              {isAnimated && <span>~{before.frameCount}f</span>}
            </div>
            <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
            <div className="flex flex-col gap-0.5 font-mono font-medium">
              <span className={cn(resChanged
                ? item.willBeValid ? 'text-emerald-500' : 'text-destructive'
                : 'text-muted-foreground')}>
                {after.width}×{after.height}
              </span>
              {isAnimated && (
                <span className={cn(framesChanged
                  ? item.willBeValid ? 'text-emerald-500' : 'text-destructive'
                  : 'text-muted-foreground')}>
                  {after.frameCount}f
                </span>
              )}
            </div>
            <div className="ml-auto shrink-0">
              {item.willBeValid
                ? <span className="text-[10px] text-emerald-500 font-medium">valid ✓</span>
                : <span className="text-[10px] text-destructive font-medium">invalid ✗</span>}
            </div>
          </div>

          {hasChanges && (
            <div className="flex flex-wrap gap-1">
              {item.changes.map((c, i) => (
                <Badge key={i} variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-4 bg-amber-500/10 text-amber-400 border border-amber-500/25">
                  {c}
                </Badge>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
