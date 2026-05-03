'use client';

import { useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { DatasetFile } from '@/lib/dataset';

interface VideoCardProps {
  file: DatasetFile;
  selected?: boolean;
  onClick?: () => void;
}

export function VideoCard({ file, selected, onClick }: VideoCardProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [loaded, setLoaded] = useState(false);

  const handleMouseEnter = () => {
    videoRef.current?.play().catch(() => {});
  };

  const handleMouseLeave = () => {
    const v = videoRef.current;
    if (!v) return;
    v.pause();
    v.currentTime = 0;
  };

  return (
    <div
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={cn(
        'group relative flex flex-col rounded-lg border bg-card overflow-hidden cursor-pointer transition-all duration-150',
        'hover:border-primary/60 hover:shadow-md',
        selected && 'ring-2 ring-primary border-primary',
      )}
    >
      {/* video thumbnail */}
      <div className="relative aspect-video bg-black/10 overflow-hidden">
        <video
          ref={videoRef}
          src={file.videoUrl}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => setLoaded(true)}
          className="w-full h-full object-cover"
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-6 h-6 rounded-full border-2 border-muted-foreground border-t-transparent animate-spin" />
          </div>
        )}
      </div>

      {/* metadata */}
      <div className="px-2.5 py-2 flex flex-col gap-1">
        <p className="text-xs font-medium truncate text-foreground" title={file.name}>
          {file.name}
        </p>
        <div className="flex items-center gap-1.5">
          {file.caption !== null ? (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-emerald-500/60 text-emerald-600 dark:text-emerald-400">
              captioned
            </Badge>
          ) : (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-muted-foreground/40 text-muted-foreground">
              no caption
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
