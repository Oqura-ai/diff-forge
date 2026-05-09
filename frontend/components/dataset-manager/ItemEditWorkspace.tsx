'use client';

import { useRef, useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft, ChevronLeft, ChevronRight,
  Play, Pause, Volume2, VolumeX,
  AlertTriangle, XCircle, CheckCircle2, ArrowRight,
  Layers, Film, ImageIcon, PanelLeft, X, Scissors,
  SlidersHorizontal, Zap, Grid2x2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { DatasetFile } from '@/lib/dataset';
import type { TransformConfig, ModelConfig, ResizeMode } from '@/lib/model-config';
import {
  isValidResolution, isValidFrameCount,
  computeTransformedMetadata, nearestValidFrameCount,
  RESIZE_MODE_LABELS,
} from '@/lib/model-config';
import { processVideoWithBackend } from '@/lib/transform-utils';
import { FrameGrid } from './FrameGrid';

interface ItemEditWorkspaceProps {
  file: DatasetFile;
  allFiles: DatasetFile[];
  transformConfig: TransformConfig;   // global config — used as initial value for item config
  modelConfig: ModelConfig;
  open: boolean;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSaveSplits: (fileId: string, splits: number[]) => void;
  onReplaceWithSegments: (fileId: string, newFiles: DatasetFile[]) => void;
}

type ProcessPhase = 'idle' | 'running' | 'done' | 'error';

interface ProcessState {
  phase: ProcessPhase;
  progress: number;
  message: string;
  segmentCount?: number;
}

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
}

function SegCtrl({
  options, value, onChange,
}: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden text-[11px] h-6">
      {options.map((opt) => (
        <button
          key={opt.id}
          onClick={() => onChange(opt.id)}
          className={cn(
            'flex-1 px-2 transition-colors leading-none',
            value === opt.id
              ? 'bg-primary text-primary-foreground font-medium'
              : 'hover:bg-accent text-muted-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function ItemEditWorkspace({
  file, allFiles, transformConfig, modelConfig,
  open, onClose, onNavigate, onSaveSplits, onReplaceWithSegments,
}: ItemEditWorkspaceProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [splits, setSplits] = useState<number[]>(file.splits ?? []);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Per-item transform config — starts as copy of global, independently editable
  const [itemConfig, setItemConfig] = useState<TransformConfig>(() => ({
    resolution: { ...transformConfig.resolution },
    frames: { ...transformConfig.frames },
    applyResolution: transformConfig.applyResolution,
    applyFrames: transformConfig.applyFrames,
  }));

  const [processState, setProcessState] = useState<ProcessState>({
    phase: 'idle', progress: 0, message: '',
  });
  const [showFrameGrid, setShowFrameGrid] = useState(false);
  const [deletedFrames, setDeletedFrames] = useState<Set<number>>(new Set());

  // Derived — must be before any handler or computed value that uses it
  const isAnimated = file.type === 'video' || file.type === 'gif';

  // Reset when navigating to a new file
  useEffect(() => {
    setSplits(file.splits ?? []);
    setItemConfig({
      resolution: { ...transformConfig.resolution },
      frames: { ...transformConfig.frames },
      applyResolution: transformConfig.applyResolution,
      applyFrames: transformConfig.applyFrames,
    });
    setProcessState({ phase: 'idle', progress: 0, message: '' });
    setShowFrameGrid(false);
    setDeletedFrames(new Set());
    abortRef.current?.abort();
  }, [file.id]);

  // Cleanup abort on unmount
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  // Video events
  const handleTimeUpdate = useCallback(() => {
    setCurrentTime(videoRef.current?.currentTime ?? 0);
  }, []);
  const handleLoadedMetadata = useCallback(() => {
    setDuration(videoRef.current?.duration ?? 0);
    setCurrentTime(0);
  }, []);
  const handlePlay = useCallback(() => setIsPlaying(true), []);
  const handlePause = useCallback(() => setIsPlaying(false), []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
  };
  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setIsMuted(v.muted);
  };
  const handleSeek = (t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = t;
    setCurrentTime(t);
  };

  const handleSaveSplitsOnly = () => onSaveSplits(file.id, splits);
  const handleSaveAndClose = () => { onSaveSplits(file.id, splits); onClose(); };

  // ── Process video through backend ────────────────────────────────────────
  const handleProcess = async () => {
    if (!isAnimated) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setProcessState({ phase: 'running', progress: 0, message: 'Starting…' });
    onSaveSplits(file.id, splits); // persist split config before processing

    try {
      const newFiles = await processVideoWithBackend({
        file,
        model: modelConfig.id,
        config: itemConfig,
        splits,
        frameDeletions: deletedFrames.size > 0 ? [...deletedFrames] : undefined,
        signal: ctrl.signal,
        onProgress: (pct, msg) => {
          setProcessState({ phase: 'running', progress: pct, message: msg });
        },
      });

      setProcessState({
        phase: 'done', progress: 100, message: '',
        segmentCount: newFiles.length,
      });

      onReplaceWithSegments(file.id, newFiles);
      // Brief pause so user can see success, then close
      setTimeout(onClose, 1200);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setProcessState({
        phase: 'error', progress: 0,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleCancelProcess = () => {
    abortRef.current?.abort();
    setProcessState({ phase: 'idle', progress: 0, message: '' });
  };

  // ── Compute preview (from item-level config) ──────────────────────────────
  const meta = file.validation?.metadata;
  const hasValidation = file.validation?.status === 'validated' && meta && meta.width > 0;

  let afterWidth = meta?.width ?? 0;
  let afterHeight = meta?.height ?? 0;
  let afterFrames = meta?.frameCount ?? 0;

  if (hasValidation) {
    const transformed = computeTransformedMetadata(meta!, itemConfig, modelConfig, file.type);
    afterWidth = transformed.width;
    afterHeight = transformed.height;
    afterFrames = transformed.frameCount;
  }

  const resValid = isValidResolution(afterWidth, afterHeight, modelConfig.resolution);
  const frameValid = !isAnimated || isValidFrameCount(afterFrames, modelConfig.frames);
  const resultValid = resValid && frameValid;

  const resHasIssue = itemConfig.resolution.mode === 'manual' && (
    (itemConfig.resolution.width != null && itemConfig.resolution.width % modelConfig.resolution.multiple !== 0) ||
    (itemConfig.resolution.height != null && itemConfig.resolution.height % modelConfig.resolution.multiple !== 0)
  );
  const framesHasIssue = itemConfig.frames.mode === 'strict' && itemConfig.frames.target != null &&
    !isValidFrameCount(itemConfig.frames.target, modelConfig.frames);

  const fps = meta?.durationSecs && meta.durationSecs > 0 ? meta.frameCount / meta.durationSecs : 30;
  const totalFrames = meta?.frameCount ?? 0;
  const currentIdx = allFiles.findIndex((f) => f.id === file.id);
  const isProcessing = processState.phase === 'running';

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !isProcessing && onClose()}>
      <DialogContent className="w-[100vw] h-[100vh] max-w-[100vw] max-h-[100vh] sm:w-[72vw] sm:h-[92vh] sm:max-w-[72vw] sm:max-h-[92vh] p-0 gap-0 flex flex-col rounded-none sm:rounded-lg">

        {/* ── header ── */}
        <div className="shrink-0 flex items-center gap-2 sm:gap-3 px-2 sm:px-4 h-12 border-b bg-card">
          <Button size="icon" variant="ghost" className="h-8 w-8 md:hidden"
            onClick={() => setSidebarOpen(!sidebarOpen)}>
            <PanelLeft className="w-4 h-4" />
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 h-8 text-xs hidden sm:flex"
            onClick={onClose} disabled={isProcessing}>
            <ArrowLeft className="w-3.5 h-3.5" />Back
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8 sm:hidden"
            onClick={onClose} disabled={isProcessing}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Separator orientation="vertical" className="h-5 hidden sm:block" />
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {file.type === 'video'
              ? <Film className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              : <ImageIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
            <span className="text-sm font-semibold truncate">{file.name}</span>
            <Badge variant="outline" className="text-[10px] font-mono shrink-0 hidden sm:inline-flex">
              {file.file.name.split('.').pop()?.toLowerCase()}
            </Badge>
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <span className="text-xs text-muted-foreground hidden sm:inline">{currentIdx + 1}/{allFiles.length}</span>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onNavigate('prev')} disabled={isProcessing}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onNavigate('next')} disabled={isProcessing}>
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Separator orientation="vertical" className="h-5 hidden sm:block" />
          <Button size="sm" variant="outline" className="h-8 text-xs hidden sm:flex"
            onClick={handleSaveSplitsOnly} disabled={isProcessing}>
            Save config
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs hidden sm:flex"
            onClick={handleSaveAndClose} disabled={isProcessing}>
            Save & Close
          </Button>
        </div>

        {/* ── body ── */}
        <div className="flex flex-1 min-h-0 relative">
          {sidebarOpen && (
            <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
          )}

          {/* ── LEFT PANEL ── */}
          <div className={cn(
            'flex flex-col border-r bg-muted/20 transition-transform duration-200 ease-in-out z-50',
            'fixed inset-y-0 left-0 w-72 md:relative md:w-64 md:shrink-0',
            sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
          )}>
            <div className="flex items-center justify-between h-12 px-3 border-b bg-card md:hidden">
              <span className="text-sm font-semibold">Item Settings</span>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setSidebarOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="flex-1">
              <div className="flex flex-col gap-0">

                {/* Validation issues */}
                {file.validation?.issues && file.validation.issues.length > 0 && (
                  <>
                    <PanelSection label="Issues">
                      <div className="flex flex-col gap-1">
                        {file.validation.issues.map((iss, i) => (
                          <div key={i} className={cn(
                            'flex items-start gap-1.5 rounded px-2 py-1.5 text-[11px]',
                            iss.type === 'load_error'
                              ? 'bg-destructive/10 text-destructive'
                              : 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
                          )}>
                            <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                            <span className="leading-tight">{iss.message}</span>
                          </div>
                        ))}
                      </div>
                    </PanelSection>
                    <Separator />
                  </>
                )}

                {/* ── Resolution ── */}
                <div className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Resolution</p>
                    </div>
                    <button
                      onClick={() => setItemConfig((c) => ({ ...c, applyResolution: !c.applyResolution }))}
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
                        itemConfig.applyResolution
                          ? 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10'
                          : 'border-border text-muted-foreground',
                      )}
                    >
                      {itemConfig.applyResolution ? 'ON' : 'OFF'}
                    </button>
                  </div>
                  {itemConfig.applyResolution && (
                    <>
                      <SegCtrl
                        options={[
                          { id: 'auto', label: `Auto ÷${modelConfig.resolution.multiple}` },
                          { id: 'manual', label: 'Manual' },
                        ]}
                        value={itemConfig.resolution.mode}
                        onChange={(v) => setItemConfig((c) => ({ ...c, resolution: { ...c.resolution, mode: v as 'auto' | 'manual' } }))}
                      />
                      {/* Resize mode — always visible when resolution is on */}
                      <div className="mt-1.5 flex flex-col gap-0.5">
                        <Label className="text-[10px] text-muted-foreground">Resize mode</Label>
                        <select
                          className="h-6 w-full text-xs px-1.5 bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground cursor-pointer"
                          value={itemConfig.resolution.resizeMode ?? 'scale'}
                          onChange={(e) => setItemConfig((c) => ({
                            ...c,
                            resolution: { ...c.resolution, resizeMode: e.target.value as ResizeMode },
                          }))}
                        >
                          {(Object.entries(RESIZE_MODE_LABELS) as [ResizeMode, string][]).map(([id, label]) => (
                            <option key={id} value={id}>{label}</option>
                          ))}
                        </select>
                      </div>

                      {itemConfig.resolution.mode === 'auto' ? (
                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                          Rounds to nearest multiple of {modelConfig.resolution.multiple}px
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5 mt-2">
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[11px] w-5 shrink-0">W</Label>
                            <Input
                              type="number" placeholder="width"
                              value={itemConfig.resolution.width ?? ''}
                              onChange={(e) => setItemConfig((c) => ({ ...c, resolution: { ...c.resolution, width: e.target.value ? +e.target.value : undefined } }))}
                              className="h-6 text-xs px-1.5"
                            />
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Label className="text-[11px] w-5 shrink-0">H</Label>
                            <Input
                              type="number" placeholder="height"
                              value={itemConfig.resolution.height ?? ''}
                              onChange={(e) => setItemConfig((c) => ({ ...c, resolution: { ...c.resolution, height: e.target.value ? +e.target.value : undefined } }))}
                              className="h-6 text-xs px-1.5"
                            />
                          </div>
                          {resHasIssue && (
                            <div className="flex items-start gap-1 mt-0.5 rounded bg-orange-500/10 px-2 py-1.5">
                              <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-orange-500" />
                              <p className="text-[10px] text-orange-400 leading-tight">
                                Not ×{modelConfig.resolution.multiple} — may break {modelConfig.name} rules
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>

                <Separator />

                {/* ── Frames (video/gif only) ── */}
                {isAnimated && (
                  <>
                    <div className="p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <Layers className="w-3 h-3 text-muted-foreground" />
                          <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Frames</p>
                        </div>
                        <button
                          onClick={() => setItemConfig((c) => ({ ...c, applyFrames: !c.applyFrames }))}
                          className={cn(
                            'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
                            itemConfig.applyFrames
                              ? 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          {itemConfig.applyFrames ? 'ON' : 'OFF'}
                        </button>
                      </div>
                      {itemConfig.applyFrames && (
                        <>
                          <SegCtrl
                            options={
                              modelConfig.frames.rule !== 'any'
                                ? [{ id: 'auto', label: `Auto ${modelConfig.frames.rule}` }, { id: 'strict', label: 'Manual' }]
                                : [{ id: 'auto', label: 'Auto' }, { id: 'strict', label: 'Manual' }]
                            }
                            value={itemConfig.frames.mode}
                            onChange={(v) => setItemConfig((c) => ({ ...c, frames: { ...c.frames, mode: v as 'auto' | 'strict' } }))}
                          />
                          {itemConfig.frames.mode === 'auto' ? (
                            <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                              {modelConfig.frames.rule !== 'any'
                                ? `Rounds to nearest frame count satisfying ${modelConfig.frames.rule}`
                                : 'Clips clamped to valid range'}
                            </p>
                          ) : (
                            <div className="mt-2">
                              <Input
                                type="number" placeholder="e.g. 49"
                                value={itemConfig.frames.target ?? ''}
                                onChange={(e) => setItemConfig((c) => ({ ...c, frames: { ...c.frames, target: e.target.value ? +e.target.value : undefined } }))}
                                className="h-6 text-xs px-1.5"
                              />
                              {framesHasIssue && (
                                <div className="flex items-start gap-1 mt-1.5 rounded bg-orange-500/10 px-2 py-1.5">
                                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-orange-500" />
                                  <p className="text-[10px] text-orange-400 leading-tight">
                                    {modelConfig.frames.rule !== 'any'
                                      ? `Not ${modelConfig.frames.rule} — may break ${modelConfig.name} rules`
                                      : `Out of range (${modelConfig.frames.min}–${modelConfig.frames.max})`}
                                  </p>
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <Separator />
                  </>
                )}

                {/* ── After preview ── */}
                {hasValidation && (
                  <>
                    <div className="p-3">
                      <div className={cn(
                        'rounded-lg border px-2.5 py-2 flex flex-col gap-1',
                        resultValid ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-destructive/40 bg-destructive/5',
                      )}>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">After transform</p>
                        <div className="flex items-center gap-2 text-[11px] font-mono">
                          <span className="text-muted-foreground">{meta!.width}×{meta!.height}</span>
                          <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                          <span className={cn('font-medium', resultValid ? 'text-emerald-500' : 'text-destructive')}>
                            {afterWidth}×{afterHeight}
                          </span>
                        </div>
                        {isAnimated && (
                          <div className="flex items-center gap-2 text-[11px] font-mono">
                            <span className="text-muted-foreground">~{meta!.frameCount}f</span>
                            <ArrowRight className="w-2.5 h-2.5 text-muted-foreground" />
                            <span className={cn('font-medium', frameValid ? 'text-emerald-500' : 'text-destructive')}>
                              {afterFrames}f
                            </span>
                          </div>
                        )}
                        <div className="flex items-center gap-1 mt-0.5">
                          {resultValid
                            ? <><CheckCircle2 className="w-3 h-3 text-emerald-500" /><span className="text-[11px] text-emerald-500">Valid for {modelConfig.name}</span></>
                            : <><XCircle className="w-3 h-3 text-destructive" /><span className="text-[11px] text-destructive">Still invalid</span></>}
                        </div>
                      </div>
                    </div>
                    <Separator />
                  </>
                )}

                {/* ── Splits summary ── */}
                {isAnimated && (
                  <>
                    <PanelSection label="Splits" icon={<Scissors className="w-3 h-3" />}>
                      {splits.length === 0 ? (
                        <p className="text-[11px] text-muted-foreground">No splits — use slicer below.</p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <p className="text-[11px] text-muted-foreground">{splits.length + 1} segments · {splits.length} split{splits.length !== 1 && 's'}</p>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {splits.map((t, i) => (
                              <Badge key={i} variant="secondary" className="text-[10px] font-mono h-4 px-1.5">
                                f{Math.round(t * fps)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </PanelSection>
                    <Separator />
                  </>
                )}

                {/* ── Process section ── */}
                {isAnimated && (
                  <div className="p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Zap className="w-3 h-3 text-muted-foreground" />
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Process</p>
                    </div>

                    {processState.phase === 'idle' && (
                      <>
                        <p className="text-[10px] text-muted-foreground leading-tight">
                          Applies frame normalisation, resolution transform
                          {splits.length > 0 && `, and ${splits.length + 1} split segments`} via backend.
                          {splits.length > 0 && ' Original is replaced by the segments.'}
                        </p>
                        <Button
                          size="sm"
                          className="h-7 text-xs gap-1.5 w-full"
                          onClick={handleProcess}
                          disabled={!hasValidation}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Process video
                        </Button>
                      </>
                    )}

                    {processState.phase === 'running' && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground truncate max-w-[140px]">{processState.message}</span>
                          <span className="font-mono text-muted-foreground shrink-0">{processState.progress}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-primary transition-all duration-300"
                            style={{ width: `${processState.progress}%` }}
                          />
                        </div>
                        <Button
                          size="sm" variant="outline"
                          className="h-7 text-xs gap-1.5 w-full"
                          onClick={handleCancelProcess}
                        >
                          Cancel
                        </Button>
                      </div>
                    )}

                    {processState.phase === 'done' && (
                      <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 px-2.5 py-2">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                        <p className="text-[11px] text-emerald-500 font-medium">
                          {processState.segmentCount} segment{processState.segmentCount !== 1 && 's'} added
                        </p>
                      </div>
                    )}

                    {processState.phase === 'error' && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-2.5 py-2">
                          <XCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                          <p className="text-[11px] text-destructive leading-tight break-words">
                            {processState.message}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-xs w-full"
                          onClick={() => setProcessState({ phase: 'idle', progress: 0, message: '' })}>
                          Try again
                        </Button>
                      </div>
                    )}
                  </div>
                )}

              </div>
            </ScrollArea>
          </div>

          {/* ── RIGHT PANEL ── */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-black/5">
            {isAnimated && showFrameGrid ? (
              <FrameGrid
                mediaUrl={file.mediaUrl}
                fps={fps}
                durationSecs={meta?.durationSecs ?? (totalFrames / fps)}
                sourceFrameCount={totalFrames}
                targetFrameCount={
                  itemConfig.frames.mode === 'strict' && itemConfig.frames.target
                    ? Math.max(1, itemConfig.frames.target)
                    : nearestValidFrameCount(totalFrames, modelConfig.frames.rule)
                }
                deletedFrames={deletedFrames}
                onDeleteChange={setDeletedFrames}
                onClose={() => setShowFrameGrid(false)}
              />
            ) : isAnimated ? (
              <VideoPanel
                file={file}
                videoRef={videoRef}
                isPlaying={isPlaying} isMuted={isMuted}
                currentTime={currentTime} duration={duration}
                splits={splits} onSplitsChange={setSplits}
                onSeek={handleSeek} onTogglePlay={togglePlay} onToggleMute={toggleMute}
                onTimeUpdate={handleTimeUpdate} onLoadedMetadata={handleLoadedMetadata}
                onPlay={handlePlay} onPause={handlePause}
                fps={fps} totalFrames={totalFrames}
                showFrameGridButton={totalFrames > 0}
                deletedFrames={deletedFrames}
                onToggleFrameGrid={() => setShowFrameGrid(true)}
                afterMeta={{ width: afterWidth, height: afterHeight, frames: afterFrames, valid: resultValid }}
              />
            ) : (
              <ImagePanel
                file={file}
                afterMeta={{ width: afterWidth, height: afterHeight, valid: resultValid }}
                hasValidation={hasValidation}
                originalMeta={meta}
              />
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Video panel ─────────────────────────────────────────────────────────────

function VideoPanel({
  file, videoRef, isPlaying, isMuted, currentTime, duration, splits,
  onSplitsChange, onSeek, onTogglePlay, onToggleMute,
  onTimeUpdate, onLoadedMetadata, onPlay, onPause,
  fps, totalFrames, showFrameGridButton, deletedFrames, onToggleFrameGrid, afterMeta,
}: {
  file: DatasetFile;
  videoRef: React.RefObject<HTMLVideoElement>;
  isPlaying: boolean; isMuted: boolean;
  currentTime: number; duration: number;
  splits: number[]; onSplitsChange: (s: number[]) => void; onSeek: (t: number) => void;
  onTogglePlay: () => void; onToggleMute: () => void;
  onTimeUpdate: () => void; onLoadedMetadata: () => void; onPlay: () => void; onPause: () => void;
  fps: number; totalFrames: number;
  showFrameGridButton: boolean;
  deletedFrames: Set<number>;
  onToggleFrameGrid: () => void;
  afterMeta: { width: number; height: number; frames: number; valid: boolean };
}) {
  const isGif = file.type === 'gif';
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-[40vh] sm:min-h-[52vh] flex items-center justify-center bg-black">
        {isGif ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={file.mediaUrl} alt={file.name} className="max-w-full max-h-full object-contain" />
        ) : (
          <video
            ref={videoRef} key={file.id} src={file.mediaUrl}
            muted={isMuted} loop playsInline preload="auto"
            className="max-w-full max-h-full object-contain"
            onTimeUpdate={onTimeUpdate} onLoadedMetadata={onLoadedMetadata}
            onPlay={onPlay} onPause={onPause}
          />
        )}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <div className={cn(
            'flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-sm border',
            afterMeta.valid
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/80 border-red-500/40 text-red-300',
          )}>
            {afterMeta.valid ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            After: {afterMeta.width}×{afterMeta.height} · {afterMeta.frames}f
          </div>
        </div>
      </div>

      <div className="shrink-0 flex flex-col gap-2 px-2 sm:px-4 py-2 sm:py-2.5 border-t bg-card">
        {!isGif && (
          <div
            className="relative h-1.5 sm:h-1 rounded-full bg-muted cursor-pointer group touch-none"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div className="h-full rounded-full bg-primary/70" style={{ width: `${progressPct}%` }} />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-4 sm:w-3 sm:h-3 rounded-full bg-primary shadow sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%`, transform: 'translate(-50%, -50%)' }}
            />
          </div>
        )}
        <div className="flex items-center gap-1 sm:gap-2">
          {!isGif && (
            <>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onTogglePlay}>
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onToggleMute}>
                {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </Button>
              <span className="text-[10px] sm:text-xs font-mono text-muted-foreground ml-1">
                {formatTime(currentTime)} / {formatTime(duration)}
              </span>
            </>
          )}
          <div className="flex-1" />
          {deletedFrames.size > 0 && (
            <Badge className="text-[10px] font-mono hidden sm:inline-flex bg-destructive/15 text-destructive border-destructive/30">
              {deletedFrames.size} del
            </Badge>
          )}
          <Badge variant="secondary" className="text-[10px] font-mono hidden sm:inline-flex">
            {splits.length > 0 ? `${splits.length + 1} segs` : 'no splits'}
          </Badge>
          {showFrameGridButton && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1 px-2" onClick={onToggleFrameGrid}>
              <Grid2x2 className="w-3 h-3" />
              Frames
            </Button>
          )}
        </div>
      </div>

      <div className="shrink-0 px-2 sm:px-4 py-2 sm:py-3 border-t bg-card/50">
        <FrameSlicerPanel
          key={file.id}
          splits={splits} onSplitsChange={onSplitsChange}
          totalFrames={totalFrames} fps={fps}
        />
      </div>
    </div>
  );
}

// ─── Image panel ─────────────────────────────────────────────────────────────

function ImagePanel({
  file, afterMeta, hasValidation, originalMeta,
}: {
  file: DatasetFile;
  afterMeta: { width: number; height: number; valid: boolean };
  hasValidation: boolean;
  originalMeta: any;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="relative flex-1 min-h-[40vh] sm:min-h-[52vh] flex items-center justify-center bg-black">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={file.mediaUrl} alt={file.name} className="max-w-full max-h-full object-contain" />
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2">
          <div className={cn(
            'flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-medium backdrop-blur-sm border',
            afterMeta.valid
              ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
              : 'bg-red-950/80 border-red-500/40 text-red-300',
          )}>
            {afterMeta.valid ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
            After: {afterMeta.width}×{afterMeta.height}
          </div>
        </div>
      </div>
      <div className="shrink-0 border-t bg-card px-2 sm:px-4 py-2 sm:py-3">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Image Info</p>
        {hasValidation ? (
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <InfoChip label="Format" value={file.file.name.split('.').pop()?.toUpperCase() ?? '—'} />
            <InfoChip label="Original" value={`${originalMeta.width}×${originalMeta.height}`} />
            <InfoChip label="After" value={`${afterMeta.width}×${afterMeta.height}`} />
            <InfoChip label="Size" value={`${(file.file.size / 1024).toFixed(0)} KB`} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Validation pending…</p>
        )}
      </div>
    </div>
  );
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function PanelSection({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      </div>
      {children}
    </div>
  );
}

function InfoChip({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('text-xs font-mono font-medium', className)}>{value}</span>
    </div>
  );
}

// ─── Frame slicer panel ───────────────────────────────────────────────────────

function FrameSlicerPanel({
  splits, onSplitsChange, totalFrames, fps,
}: { splits: number[]; onSplitsChange: (s: number[]) => void; totalFrames: number; fps: number }) {
  const [mode, setMode] = useState<'manual' | 'even'>('manual');
  const [manualInput, setManualInput] = useState(() =>
    splits.length > 0 ? splits.map(s => Math.round(s * fps)).join(', ') : '',
  );
  const [evenInterval, setEvenInterval] = useState('');

  if (totalFrames === 0) {
    return (
      <div className="flex items-center justify-center h-12 text-xs text-muted-foreground">
        Loading video metadata…
      </div>
    );
  }

  const parsedFrames = manualInput.split(',')
    .map(s => parseInt(s.trim()))
    .filter(n => !isNaN(n) && n > 0 && n < totalFrames)
    .sort((a, b) => a - b);

  const evenIntervalNum = parseInt(evenInterval);
  const evenFrames = !isNaN(evenIntervalNum) && evenIntervalNum > 0
    ? Array.from({ length: Math.floor((totalFrames - 1) / evenIntervalNum) }, (_, i) => (i + 1) * evenIntervalNum).filter(f => f < totalFrames)
    : [];

  const activeFrames = mode === 'manual' ? parsedFrames : evenFrames;
  const segPoints = [0, ...activeFrames, totalFrames];
  const segments = segPoints.slice(0, -1).map((start, i) => ({ start, end: segPoints[i + 1], count: segPoints[i + 1] - start }));
  const canApply = activeFrames.length > 0;

  return (
    <div className="flex flex-col gap-2 p-3 bg-muted/20 rounded-xl border">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Scissors className="w-3 h-3" />Frame Slicing
        </p>
        <span className="text-[10px] text-muted-foreground font-mono">{totalFrames}f · {fps.toFixed(1)}fps</span>
      </div>

      <div className="flex gap-0.5 p-0.5 bg-muted rounded-lg">
        {(['manual', 'even'] as const).map(m => (
          <button key={m} onClick={() => setMode(m)}
            className={cn('flex-1 text-[11px] py-1 rounded-md transition-colors font-medium',
              mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
            {m === 'manual' ? 'Manual' : 'Even spacing'}
          </button>
        ))}
      </div>

      {mode === 'manual' ? (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground">Frames (comma-separated, 1–{totalFrames - 1})</label>
          <input
            type="text"
            placeholder={`e.g. ${Math.round(totalFrames * 0.33)}, ${Math.round(totalFrames * 0.66)}`}
            value={manualInput} onChange={e => setManualInput(e.target.value)}
            className="w-full text-xs font-mono bg-background border border-input rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
          />
          {parsedFrames.length > 0 && <p className="text-[10px] text-muted-foreground">{parsedFrames.length} split{parsedFrames.length !== 1 ? 's' : ''} → {parsedFrames.length + 1} segments</p>}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={totalFrames - 1} placeholder="e.g. 100"
            value={evenInterval} onChange={e => setEvenInterval(e.target.value)}
            className="flex-1 text-xs font-mono bg-background border border-input rounded-md px-2 py-1.5 outline-none focus:ring-1 focus:ring-ring"
          />
          {evenFrames.length > 0 && <span className="text-[10px] text-muted-foreground shrink-0">→ {evenFrames.length + 1} segs</span>}
        </div>
      )}

      {segments.length > 1 && (
        <div className="flex flex-col gap-0.5 max-h-24 overflow-y-auto rounded border bg-background/60 p-1">
          {segments.map((seg, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-0.5 text-[10px] font-mono hover:bg-muted/50">
              <span className="text-muted-foreground w-10 shrink-0">Seg {i + 1}</span>
              <span>{seg.start}–{seg.end}</span>
              <span className="text-muted-foreground ml-auto">{seg.count}f</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          disabled={!canApply} onClick={() => onSplitsChange(activeFrames.map(f => f / fps))}
          className={cn(
            'flex-1 text-[11px] py-1.5 rounded-md border font-medium transition-colors',
            canApply ? 'bg-primary text-primary-foreground border-primary hover:bg-primary/90' : 'opacity-40 cursor-not-allowed bg-muted border-border text-muted-foreground',
          )}>
          Stage splits
        </button>
        {splits.length > 0 && (
          <button onClick={() => { onSplitsChange([]); setManualInput(''); setEvenInterval(''); }}
            className="text-[11px] py-1.5 px-3 rounded-md border border-border hover:border-destructive hover:text-destructive transition-colors">
            Clear
          </button>
        )}
      </div>

      {splits.length > 0 && activeFrames.length === 0 && (
        <p className="text-[10px] text-muted-foreground text-center">
          {splits.length} split{splits.length !== 1 ? 's' : ''} staged — click "Process video" to apply
        </p>
      )}
    </div>
  );
}
