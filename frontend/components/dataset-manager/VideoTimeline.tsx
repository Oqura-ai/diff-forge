'use client';

import { useRef, useCallback, useEffect } from 'react';
import { Scissors } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Segment {
  start: number;
  end: number;
  frames: number;
  isValid8n1: boolean;
}

interface VideoTimelineProps {
  duration: number;
  currentTime: number;
  splits: number[];
  onSplitsChange: (splits: number[]) => void;
  onSeek: (time: number) => void;
  fps?: number;
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function nearestValid8n1(f: number) {
  return Math.max(1, Math.round((f - 1) / 8)) * 8 + 1;
}

export function VideoTimeline({
  duration,
  currentTime,
  splits,
  onSplitsChange,
  onSeek,
  fps = 30,
}: VideoTimelineProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const draggingIdx = useRef<number | null>(null);

  const getTimeAt = (clientX: number) => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  const handleBarClick = (e: React.MouseEvent) => {
    if (draggingIdx.current !== null) return;
    const t = getTimeAt(e.clientX);
    const MIN_GAP = duration * 0.025;
    const tooClose = splits.some((s) => Math.abs(s - t) < MIN_GAP);
    if (tooClose) { onSeek(t); return; }
    onSplitsChange([...splits, t].sort((a, b) => a - b));
    onSeek(t);
  };

  const handleSplitMouseDown = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation();
    e.preventDefault();
    draggingIdx.current = idx;
  };

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggingIdx.current === null) return;
    const t = getTimeAt(e.clientX);
    const clamped = Math.max(0.05 * duration, Math.min(0.95 * duration, t));
    const next = [...splits];
    next[draggingIdx.current] = clamped;
    onSplitsChange(next.sort((a, b) => a - b));
  }, [splits, duration, onSplitsChange]);

  const handleMouseUp = useCallback(() => { draggingIdx.current = null; }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // Build segments
  const points = [0, ...splits, duration];
  const segments: Segment[] = points.slice(0, -1).map((start, i) => {
    const end = points[i + 1];
    const rawFrames = Math.round((end - start) * fps);
    return {
      start, end,
      frames: rawFrames,
      isValid8n1: rawFrames % 8 === 1,
    };
  });

  // Tick marks (max 8)
  const tickCount = Math.min(8, Math.max(2, Math.floor(duration / 5)));
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => ({
    time: (i / tickCount) * duration,
    pct: (i / tickCount) * 100,
  }));

  const playheadPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const COLORS = [
    'bg-sky-500/25 hover:bg-sky-500/35',
    'bg-violet-500/25 hover:bg-violet-500/35',
    'bg-amber-500/25 hover:bg-amber-500/35',
    'bg-teal-500/25 hover:bg-teal-500/35',
    'bg-pink-500/25 hover:bg-pink-500/35',
  ];

  return (
    <div className="flex flex-col gap-1.5 p-3 bg-muted/20 rounded-xl border">
      {/* header */}
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Scissors className="w-3 h-3" />
          {segments.length} segment{segments.length !== 1 && 's'}
          {' · '}{formatTime(duration)}
        </p>
        {splits.length > 0 && (
          <button
            onClick={() => onSplitsChange([])}
            className="text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            Clear all
          </button>
        )}
      </div>

      {/* time ticks */}
      <div className="relative h-3 mx-1">
        {ticks.map((tick, i) => (
          <div
            key={i}
            className="absolute flex flex-col items-center -translate-x-1/2"
            style={{ left: `${tick.pct}%` }}
          >
            <div className="w-px h-1.5 bg-border" />
            <span className="text-[9px] text-muted-foreground leading-none mt-0.5">
              {formatTime(tick.time)}
            </span>
          </div>
        ))}
      </div>

      {/* main track */}
      <div
        ref={barRef}
        className="relative h-14 bg-background/80 rounded-lg border cursor-crosshair overflow-hidden select-none"
        onClick={handleBarClick}
      >
        {/* segments */}
        {segments.map((seg, i) => (
          <div
            key={i}
            onClick={(e) => { e.stopPropagation(); onSeek(seg.start + 0.01); }}
            className={cn(
              'absolute top-0 h-full flex flex-col justify-center gap-0.5 px-2 cursor-pointer transition-colors overflow-hidden',
              seg.isValid8n1 ? COLORS[i % COLORS.length] : 'bg-orange-400/20 hover:bg-orange-400/30',
            )}
            style={{
              left: `${(seg.start / duration) * 100}%`,
              width: `${((seg.end - seg.start) / duration) * 100}%`,
            }}
          >
            <span className="text-[10px] font-medium text-foreground truncate leading-none">
              {seg.frames}f {!seg.isValid8n1 && <span className="text-orange-500 text-[9px]">⚠ not 8n+1 → {nearestValid8n1(seg.frames)}f</span>}
            </span>
            <span className="text-[9px] text-muted-foreground truncate leading-none">
              {formatTime(seg.start)} – {formatTime(seg.end)}
            </span>
          </div>
        ))}

        {/* split handles */}
        {splits.map((t, idx) => (
          <div
            key={idx}
            onMouseDown={(e) => handleSplitMouseDown(e, idx)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onSplitsChange(splits.filter((_, i) => i !== idx));
            }}
            className="absolute top-0 h-full w-1 -ml-0.5 z-20 cursor-col-resize group"
            style={{ left: `${(t / duration) * 100}%` }}
            title="Drag · Double-click to remove"
          >
            <div className="w-full h-full bg-foreground/50 group-hover:bg-primary transition-colors" />
            {/* top knob */}
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground/80 group-hover:bg-primary border-2 border-background transition-colors" />
            {/* bottom knob */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-foreground/80 group-hover:bg-primary border-2 border-background transition-colors" />
          </div>
        ))}

        {/* playhead */}
        <div
          className="absolute top-0 h-full w-0.5 bg-emerald-500/90 z-30 pointer-events-none"
          style={{ left: `${playheadPct}%` }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-[6px] border-l-transparent border-r-transparent border-t-emerald-500" />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60 text-center">
        Click to add split · Drag to move · Double-click to remove
      </p>
    </div>
  );
}
