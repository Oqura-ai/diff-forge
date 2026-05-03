'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { X, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Bresenham mapping (mirrors backend exactly) ─────────────────────────────

function bresenhamSourceMap(sourceCount: number, targetCount: number): number[] {
  if (sourceCount === targetCount)
    return Array.from({ length: sourceCount }, (_, i) => i);

  if (targetCount > sourceCount) {
    const n = sourceCount;
    const q = Math.floor(targetCount / n);
    const r = targetCount % n;
    const result: number[] = [];
    for (let i = 0; i < n; i++) {
      const reps = i < r ? q + 1 : q;
      for (let j = 0; j < reps; j++) result.push(i);
    }
    return result.slice(0, targetCount);
  }

  // downsample
  return Array.from({ length: targetCount }, (_, i) =>
    Math.round(i * (sourceCount - 1) / (targetCount - 1)),
  );
}

/** Smallest 8k+1 >= n — mirrors next_8n1 in backend exactly. */
export function nextValid8n1(n: number, min = 9, max = 257): number {
  if (n <= min) return min;
  const k = Math.ceil((n - 1) / 8);
  return Math.min(8 * k + 1, max);
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FrameInfo {
  outputIndex: number;
  sourceIndex: number;
  isAdded: boolean;     // duplicate injected by Bresenham
  thumbnail: string | null;
}

interface FrameGridProps {
  mediaUrl: string;
  fps: number;
  durationSecs: number;
  sourceFrameCount: number;     // original frames in the video
  targetFrameCount: number;     // after normalisation (computed outside)
  deletedFrames: Set<number>;   // currently marked for deletion
  onDeleteChange: (frames: Set<number>) => void;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function FrameGrid({
  mediaUrl,
  fps,
  durationSecs,
  sourceFrameCount,
  targetFrameCount,
  deletedFrames,
  onDeleteChange,
  onClose,
}: FrameGridProps) {
  const [frames, setFrames] = useState<FrameInfo[]>([]);
  const [loadedCount, setLoadedCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const cancelRef = useRef(false);

  // ── Build frame info list ─────────────────────────────────────────────────
  useEffect(() => {
    cancelRef.current = false;
    setIsLoading(true);
    setLoadedCount(0);

    const mapping = bresenhamSourceMap(sourceFrameCount, targetFrameCount);
    const initialFrames: FrameInfo[] = mapping.map((srcIdx, outIdx) => ({
      outputIndex: outIdx,
      sourceIndex: srcIdx,
      isAdded: outIdx > 0 && srcIdx === mapping[outIdx - 1],
      thumbnail: null,
    }));
    setFrames(initialFrames);

    // ── Extract thumbnails using a hidden video ───────────────────────────
    const video = document.createElement('video');
    video.src = mediaUrl;
    video.muted = true;
    video.preload = 'auto';

    const canvas = document.createElement('canvas');
    const THUMB_SIZE = 96;

    const loadThumbs = async () => {
      await new Promise<void>((res) => {
        video.onloadedmetadata = () => res();
        video.load();
      });

      const scale = Math.min(1, THUMB_SIZE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      const ctx = canvas.getContext('2d')!;

      // Only seek unique source indices — duplicates share the same thumbnail
      const uniqueSources = [...new Set(mapping)].sort((a, b) => a - b);
      const thumbCache = new Map<number, string>();

      for (let i = 0; i < uniqueSources.length; i++) {
        if (cancelRef.current) break;

        const srcIdx = uniqueSources[i];
        const t =
          sourceFrameCount > 1
            ? (srcIdx / (sourceFrameCount - 1)) * durationSecs
            : 0;

        video.currentTime = Math.min(t, durationSecs - 0.001);
        await new Promise<void>((res) => {
          video.onseeked = () => res();
        });

        if (cancelRef.current) break;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        thumbCache.set(srcIdx, canvas.toDataURL('image/jpeg', 0.65));

        // Batch-update thumbnails every 10 frames for smooth progressive loading
        if (i % 10 === 0 || i === uniqueSources.length - 1) {
          setFrames((prev) =>
            prev.map((f) => ({
              ...f,
              thumbnail: thumbCache.get(f.sourceIndex) ?? f.thumbnail,
            })),
          );
          setLoadedCount(i + 1);
        }
      }

      if (!cancelRef.current) setIsLoading(false);
    };

    loadThumbs().catch(console.error);

    return () => {
      cancelRef.current = true;
      video.src = '';
    };
  }, [mediaUrl, sourceFrameCount, targetFrameCount, durationSecs]);

  // ── Selection helpers ─────────────────────────────────────────────────────
  const toggleFrame = useCallback(
    (idx: number) => {
      onDeleteChange(
        new Set(
          deletedFrames.has(idx)
            ? [...deletedFrames].filter((i) => i !== idx)
            : [...deletedFrames, idx],
        ),
      );
    },
    [deletedFrames, onDeleteChange],
  );

  const selectAllAdded = () => {
    const added = new Set(
      frames.filter((f) => f.isAdded).map((f) => f.outputIndex),
    );
    onDeleteChange(added);
  };

  const clearSelection = () => onDeleteChange(new Set());

  const addedCount = frames.filter((f) => f.isAdded).length;
  const uniqueSources = new Set(frames.map((f) => f.sourceIndex)).size;

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background">
      {/* ── toolbar ── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b bg-card flex-wrap">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <span className="text-xs font-medium text-foreground">
            {sourceFrameCount} original · {targetFrameCount} normalised
          </span>
          {addedCount > 0 && (
            <Badge className="text-[10px] px-1.5 h-4 bg-amber-500/15 text-amber-400 border border-amber-500/30">
              +{addedCount} added by normalisation
            </Badge>
          )}
          {deletedFrames.size > 0 && (
            <Badge className="text-[10px] px-1.5 h-4 bg-destructive/15 text-destructive border border-destructive/30">
              {deletedFrames.size} marked for deletion
            </Badge>
          )}
          {isLoading && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              Loading {loadedCount}/{uniqueSources}…
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {addedCount > 0 && deletedFrames.size === 0 && (
            <Button
              size="sm" variant="outline"
              className="h-7 text-[11px] gap-1 text-amber-400 border-amber-500/40 hover:bg-amber-500/10"
              onClick={selectAllAdded}
            >
              <Trash2 className="w-3 h-3" />
              Select all added
            </Button>
          )}
          {deletedFrames.size > 0 && (
            <Button size="sm" variant="ghost" className="h-7 text-[11px] gap-1" onClick={clearSelection}>
              <RotateCcw className="w-3 h-3" />
              Clear
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* ── grid ── */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="grid grid-cols-5 sm:grid-cols-7 md:grid-cols-9 lg:grid-cols-11 gap-1 p-2">
          {frames.map((frame) => (
            <FrameCell
              key={frame.outputIndex}
              frame={frame}
              selected={deletedFrames.has(frame.outputIndex)}
              onToggle={() => toggleFrame(frame.outputIndex)}
            />
          ))}
        </div>
      </ScrollArea>

      {/* ── legend ── */}
      <div className="shrink-0 flex items-center gap-3 px-3 py-1.5 border-t bg-card/50 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border-2 border-muted-foreground/30 inline-block" />
          Original frame
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border-2 border-amber-400/70 inline-block" />
          Added by normalisation (duplicate)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm border-2 border-destructive inline-block bg-destructive/20" />
          Marked for deletion
        </span>
        <span className="ml-auto">Click a frame to toggle deletion</span>
      </div>
    </div>
  );
}

// ─── Individual frame cell ────────────────────────────────────────────────────

function FrameCell({
  frame,
  selected,
  onToggle,
}: {
  frame: FrameInfo;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      className={cn(
        'relative cursor-pointer rounded overflow-hidden border-2 transition-all',
        selected
          ? 'border-destructive shadow-[0_0_0_1px] shadow-destructive/30'
          : frame.isAdded
            ? 'border-amber-400/50 hover:border-amber-400'
            : 'border-transparent hover:border-muted-foreground/40',
      )}
      title={`Frame ${frame.outputIndex + 1}${frame.isAdded ? ' (added by normalisation)' : ''}${selected ? ' — marked for deletion' : ''}`}
    >
      {/* thumbnail */}
      <div className="aspect-video bg-muted">
        {frame.thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={frame.thumbnail}
            alt={`Frame ${frame.outputIndex + 1}`}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full bg-muted animate-pulse" />
        )}
      </div>

      {/* overlay when selected for deletion */}
      {selected && (
        <div className="absolute inset-0 bg-destructive/25 flex items-center justify-center">
          <Trash2 className="w-3 h-3 text-destructive drop-shadow" />
        </div>
      )}

      {/* frame number + added badge */}
      <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-0.5 pb-0.5 bg-gradient-to-t from-black/70 to-transparent">
        <span className="text-[8px] font-mono text-white leading-none">
          {frame.outputIndex + 1}
        </span>
        {frame.isAdded && (
          <span className="text-[7px] font-bold text-amber-300 leading-none">+</span>
        )}
      </div>
    </div>
  );
}
