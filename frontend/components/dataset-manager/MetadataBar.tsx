'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Save, Download, Undo2, Redo2, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import type { Dataset } from '@/lib/dataset';

interface MetadataBarProps {
  dataset: Dataset;
  validating: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onExport: () => void;
}

export function MetadataBar({ dataset, validating, canUndo, canRedo, onUndo, onRedo, onExport }: MetadataBarProps) {
  const hasSanityErrors = dataset.issues.some((i) => i.severity === 'error');

  const validated = dataset.files.filter((f) => f.validation?.status === 'validated');
  const validCount = validated.filter((f) => f.validation!.isValid).length;
  const invalidCount = validated.filter((f) => !f.validation!.isValid).length;
  const videos = dataset.files.filter((f) => f.type === 'video').length;
  const images = dataset.files.filter((f) => f.type === 'image').length;
  const gifs = dataset.files.filter((f) => f.type === 'gif').length;
  const captioned = dataset.files.filter((f) => f.caption !== null).length;

  return (
    <div className="shrink-0 flex flex-col sm:flex-row items-stretch sm:items-start gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 sm:py-3 border-b">
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold text-sm sm:text-base truncate">{dataset.name}</h2>
          <Badge variant="outline" className="shrink-0 text-[10px] sm:text-xs font-mono border-sky-500/60 text-sky-400">
            {dataset.targetModel}
          </Badge>

          {validating ? (
            <span className="flex items-center gap-1 text-[10px] sm:text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Validating…
            </span>
          ) : validated.length > 0 ? (
            <>
              {invalidCount === 0 ? (
                <span className="flex items-center gap-1 text-[10px] sm:text-xs text-emerald-400">
                  <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  {validCount} / {dataset.files.length} valid
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] sm:text-xs text-destructive">
                  <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  {invalidCount} invalid
                  {validCount > 0 && <span className="text-muted-foreground hidden sm:inline">· {validCount} valid</span>}
                </span>
              )}
            </>
          ) : hasSanityErrors ? (
            <span className="flex items-center gap-1 text-[10px] sm:text-xs text-destructive">
              <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
              {dataset.issues.filter((i) => i.severity === 'error').length} sanity error
              {dataset.issues.filter((i) => i.severity === 'error').length !== 1 && 's'}
            </span>
          ) : null}
        </div>

        {dataset.description && (
          <p className="text-[11px] sm:text-xs text-muted-foreground truncate">{dataset.description}</p>
        )}

        <p className="text-[11px] sm:text-xs text-muted-foreground">
          {videos > 0 && <>{videos} video{videos !== 1 && 's'}</>}
          {videos > 0 && (images > 0 || gifs > 0) && ' · '}
          {images > 0 && <>{images} image{images !== 1 && 's'}</>}
          {images > 0 && gifs > 0 && ' · '}
          {gifs > 0 && <>{gifs} GIF{gifs !== 1 && 's'}</>}
          {' · '}{captioned} captioned
        </p>
      </div>

      <div className="shrink-0 flex sm:flex-col gap-1.5">
        {/* Save / Export — always visible, icon-only on mobile */}
        <div className="flex gap-1.5">
          <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 px-2 sm:px-3">
            <Save className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Save</span>
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 px-2 sm:px-3"
            onClick={onExport}>
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export</span>
          </Button>
        </div>
        {/* Undo / Redo — hidden on mobile */}
        <div className="hidden sm:flex gap-1.5">
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1"
            disabled={!canUndo} onClick={onUndo}>
            <Undo2 className="w-3.5 h-3.5" />
            Undo
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 flex-1"
            disabled={!canRedo} onClick={onRedo}>
            <Redo2 className="w-3.5 h-3.5" />
            Redo
          </Button>
        </div>
      </div>
    </div>
  );
}
