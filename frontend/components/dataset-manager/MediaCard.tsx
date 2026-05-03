'use client';

import { useRef, useEffect } from 'react';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, CheckCircle2, XCircle, Loader2, Check, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DatasetFile } from '@/lib/dataset';

interface MediaCardProps {
  file: DatasetFile;
  index: number;
  focused: boolean;
  selected: boolean;
  isFirst: boolean;
  isLast: boolean;
  onFocus: () => void;
  onToggleSelect: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onItemClick: () => void;
  onDelete: () => void;
}

export function MediaCard({
  file,
  focused,
  selected,
  onFocus,
  onToggleSelect,
  onNavigate,
  onItemClick,
  onDelete,
}: MediaCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (focused) v.play().catch(() => {});
    else { v.pause(); v.currentTime = 0; }
  }, [focused]);

  const { validation } = file;
  const valStatus =
    !validation ? null
    : validation.status === 'pending' ? 'pending'
    : validation.isValid ? 'valid'
    : 'invalid';

  return (
    <div
      id={`card-${file.id}`}
      onMouseEnter={onFocus}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-card overflow-hidden transition-all duration-150 hover:shadow-md',
        selected ? 'ring-2 ring-primary border-primary' : focused ? 'border-primary/50' : 'border-border',
      )}
    >
      {/* ── preview ── */}
      <div
        className="relative aspect-video bg-black overflow-hidden cursor-pointer"
        onClick={onItemClick}
      >
        {file.type === 'video' ? (
          <video
            ref={videoRef}
            src={file.mediaUrl}
            muted loop playsInline preload="metadata"
            className="w-full h-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.mediaUrl} alt={file.name} className="w-full h-full object-contain" />
        )}
        {/* GIF frame count badge */}
        {file.type === 'gif' && (file.validation?.metadata?.frameCount ?? 1) > 1 && (
          <div className="absolute bottom-1 left-1">
            <Badge className="text-[8px] px-1 h-3.5 bg-black/70 text-white border-0 font-mono">
              {file.validation!.metadata.frameCount}f
            </Badge>
          </div>
        )}

        {/* ── selection checkbox (top-left) ── */}
        <div
          className="absolute top-1.5 left-1.5 z-10"
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
        >
          <div className={cn(
            'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
            selected
              ? 'bg-primary border-primary'
              : 'border-white/70 bg-black/30 opacity-0 group-hover:opacity-100',
          )}>
            {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
          </div>
        </div>

        {/* ── format badge ── */}
        <div className="absolute top-1.5 right-8">
          <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 uppercase font-mono bg-black/60 text-white border-0">
            {file.type === 'video' ? 'mp4' : file.file.name.split('.').pop()?.toLowerCase()}
          </Badge>
        </div>

        {/* ── validation indicator (top-right) ── */}
        <div className="absolute top-1.5 right-1.5">
          {valStatus === 'pending' && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {valStatus === 'valid' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 drop-shadow" />}
          {valStatus === 'invalid' && (
            <div className="flex items-center gap-0.5">
              <span className="text-[9px] text-red-400 font-mono font-bold drop-shadow">
                {validation!.issues.length}
              </span>
              <XCircle className="w-3.5 h-3.5 text-red-400 drop-shadow" />
            </div>
          )}
        </div>

        {/* ── navigation arrows ── */}
        {/* {focused && (
          <>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('prev'); }}
              className="absolute left-0 top-0 h-full px-1 flex items-center bg-gradient-to-r from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronLeft className="w-4 h-4 text-white drop-shadow" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onNavigate('next'); }}
              className="absolute right-0 top-0 h-full px-1 flex items-center bg-gradient-to-l from-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <ChevronRight className="w-4 h-4 text-white drop-shadow" />
            </button>
          </>
        )} */}

        {/* splits badge */}
        {file.splits && file.splits.length > 0 && (
          <div className="absolute bottom-1 right-1">
            <Badge variant="secondary" className="text-[9px] px-1 h-3.5 bg-black/60 text-white border-0">
              {file.splits.length + 1}seg
            </Badge>
          </div>
        )}

        {selected && <div className="absolute inset-0 bg-primary/10 pointer-events-none" />}
      </div>

      {/* ── metadata ── */}
      <div
        className="px-2.5 py-2 flex flex-col gap-1 cursor-pointer"
        onClick={onItemClick}
      >
        <div className="flex items-center gap-1 min-w-0">
          <p className="text-xs font-medium truncate text-foreground flex-1" title={file.name}>
            {file.name}
          </p>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {file.caption !== null ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/60 text-emerald-600 dark:text-emerald-400">
              captioned
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-muted-foreground/40 text-muted-foreground">
              no caption
            </Badge>
          )}
          {validation?.status === 'validated' && validation.metadata.width > 0 && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {validation.metadata.width}×{validation.metadata.height}
            </span>
          )}
        </div>
        {validation?.status === 'validated' && !validation.isValid && (
          <div className="flex flex-col gap-0.5">
            {validation.issues.slice(0, 1).map((iss, i) => (
              <p key={i} className="text-[10px] text-destructive leading-tight truncate">{iss.message}</p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
