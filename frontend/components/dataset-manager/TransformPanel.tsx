'use client';

import { AlertTriangle, XCircle, Play, SlidersHorizontal, Layers, X, Trash2 } from 'lucide-react';
import { isValidFrameCount } from '@/lib/model-config';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { SanityIssue } from '@/lib/dataset';
import type { TransformConfig, ModelConfig, ResizeMode } from '@/lib/model-config';
import { RESIZE_MODE_LABELS } from '@/lib/model-config';

interface TransformPanelProps {
  sanityIssues: SanityIssue[];
  modelConfig: ModelConfig;
  transformConfig: TransformConfig;
  onConfigChange: (cfg: TransformConfig) => void;
  selectedCount: number;
  totalCount: number;
  validatingFiles: boolean;
  onDeleteSelected: () => void;
  onApplyAll: () => void;
  onApplySelected: () => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

function SegmentedControl({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
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

export function TransformPanel({
  sanityIssues,
  modelConfig,
  transformConfig,
  onConfigChange,
  selectedCount,
  totalCount,
  validatingFiles,
  onDeleteSelected,
  onApplyAll,
  onApplySelected,
  mobileOpen,
  onMobileClose,
}: TransformPanelProps) {
  const { resolution, frames } = transformConfig;

  const setResMode = (mode: 'auto' | 'manual') =>
    onConfigChange({ ...transformConfig, resolution: { ...resolution, mode } });
  const setFramesMode = (mode: 'auto' | 'strict') =>
    onConfigChange({ ...transformConfig, frames: { ...frames, mode } });

  const errors = sanityIssues.filter((i) => i.severity === 'error');
  const warnings = sanityIssues.filter((i) => i.severity === 'warning');

  const canPreview = !validatingFiles && totalCount > 0;

  const resHasIssue = resolution.mode === 'manual' && (
    (resolution.width != null && resolution.width % modelConfig.resolution.multiple !== 0) ||
    (resolution.height != null && resolution.height % modelConfig.resolution.multiple !== 0)
  );
  const framesHasIssue = frames.mode === 'strict' && frames.target != null &&
    !isValidFrameCount(frames.target, modelConfig.frames);

  return (
    <>
      {/* mobile backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={onMobileClose}
        />
      )}

      <div
        className={cn(
          'flex flex-col border-r bg-muted/20 z-40 transition-transform duration-200',
          'fixed inset-y-0 left-0 w-72 md:relative md:w-56 md:shrink-0 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* mobile header */}
        <div className="flex items-center justify-between h-11 px-3 border-b md:hidden">
          <span className="text-sm font-semibold">Transform Settings</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onMobileClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0">

          {/* ── Sanity issues ── */}
          {sanityIssues.length > 0 && (
            <>
              <Section label="Sanity Checks">
                <div className="flex flex-col gap-1">
                  {errors.map((issue, i) => (
                    <IssueRow key={i} issue={issue} />
                  ))}
                  {warnings.map((issue, i) => (
                    <IssueRow key={i} issue={issue} />
                  ))}
                </div>
              </Section>
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
                onClick={() => onConfigChange({ ...transformConfig, applyResolution: !transformConfig.applyResolution })}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
                  transformConfig.applyResolution
                    ? 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10'
                    : 'border-border text-muted-foreground'
                )}
              >
                {transformConfig.applyResolution ? 'ON' : 'OFF'}
              </button>
            </div>
            {transformConfig.applyResolution && (
              <>
                <SegmentedControl
                  options={[
                    { id: 'auto', label: `Auto ÷${modelConfig.resolution.multiple}` },
                    { id: 'manual', label: 'Manual' },
                  ]}
                  value={resolution.mode}
                  onChange={(v) => setResMode(v as 'auto' | 'manual')}
                />

                {/* Resize mode — always visible when resolution is on */}
                <div className="mt-1.5 flex flex-col gap-0.5">
                  <Label className="text-[10px] text-muted-foreground">Resize mode</Label>
                  <select
                    className="h-6 w-full text-xs px-1.5 bg-background border border-input rounded-md outline-none focus:ring-1 focus:ring-ring transition-shadow text-foreground cursor-pointer"
                    value={resolution.resizeMode ?? 'scale'}
                    onChange={(e) =>
                      onConfigChange({
                        ...transformConfig,
                        resolution: { ...resolution, resizeMode: e.target.value as ResizeMode },
                      })
                    }
                  >
                    {(Object.entries(RESIZE_MODE_LABELS) as [ResizeMode, string][]).map(([id, label]) => (
                      <option key={id} value={id}>{label}</option>
                    ))}
                  </select>
                </div>

                {resolution.mode === 'auto' ? (
                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                    Rounds to nearest multiple of {modelConfig.resolution.multiple}px
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 mt-2">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-[11px] w-6 shrink-0">W</Label>
                      <Input
                        type="number"
                        placeholder="width"
                        value={resolution.width ?? ''}
                        onChange={(e) =>
                          onConfigChange({
                            ...transformConfig,
                            resolution: { ...resolution, width: e.target.value ? +e.target.value : undefined },
                          })
                        }
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Label className="text-[11px] w-6 shrink-0">H</Label>
                      <Input
                        type="number"
                        placeholder="height"
                        value={resolution.height ?? ''}
                        onChange={(e) =>
                          onConfigChange({
                            ...transformConfig,
                            resolution: { ...resolution, height: e.target.value ? +e.target.value : undefined },
                          })
                        }
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                    {resHasIssue && (
                      <div className="flex items-start gap-1 mt-1.5 rounded bg-orange-500/10 px-2 py-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-orange-500" />
                        <p className="text-[10px] text-orange-700 dark:text-orange-400 leading-tight">
                          Not a multiple of {modelConfig.resolution.multiple}px — may break {modelConfig.name} training rules
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* ── Frames ── */}
          <div className="p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Layers className="w-3 h-3 text-muted-foreground" />
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Frames</p>
              </div>
              <button
                onClick={() => onConfigChange({ ...transformConfig, applyFrames: !transformConfig.applyFrames })}
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
                  transformConfig.applyFrames
                    ? 'border-emerald-500/60 text-emerald-500 bg-emerald-500/10'
                    : 'border-border text-muted-foreground'
                )}
              >
                {transformConfig.applyFrames ? 'ON' : 'OFF'}
              </button>
            </div>
            {transformConfig.applyFrames && (
              <>
                <SegmentedControl
                  options={
                    modelConfig.frames.rule !== 'any'
                      ? [{ id: 'auto', label: `Auto ${modelConfig.frames.rule}` }, { id: 'strict', label: 'Manual' }]
                      : [{ id: 'auto', label: 'Auto' }, { id: 'strict', label: 'Manual' }]
                  }
                  value={frames.mode}
                  onChange={(v) => setFramesMode(v as 'auto' | 'strict')}
                />

                {frames.mode === 'auto' ? (
                  <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                    {modelConfig.frames.rule !== 'any'
                      ? `Rounds to nearest frame count satisfying ${modelConfig.frames.rule}`
                      : 'Clips clamped to valid range'}
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 mt-2">
                    <div className="flex items-center gap-1.5">
                      <Label className="text-[11px] shrink-0">Frames</Label>
                      <Input
                        type="number"
                        placeholder="e.g. 49"
                        value={frames.target ?? ''}
                        onChange={(e) =>
                          onConfigChange({
                            ...transformConfig,
                            frames: { ...frames, target: e.target.value ? +e.target.value : undefined },
                          })
                        }
                        className="h-6 text-xs px-1.5"
                      />
                    </div>
                    {framesHasIssue && (
                      <div className="flex items-start gap-1 mt-1.5 rounded bg-orange-500/10 px-2 py-1.5">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-orange-500" />
                        <p className="text-[10px] text-orange-700 dark:text-orange-400 leading-tight">
                          {modelConfig.frames.rule !== 'any'
                            ? `Not ${modelConfig.frames.rule} — may break ${modelConfig.name} training rules`
                            : `Out of valid range (${modelConfig.frames.min}–${modelConfig.frames.max})`}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <Separator />

          {/* ── Apply actions ── */}
          <Section label="Apply Transform">
            <div className="flex flex-col gap-1.5">
              {selectedCount === 0 ? (
                <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 w-full"
                  onClick={onApplyAll} disabled={!canPreview}>
                  <Play className="w-3.5 h-3.5" />
                  Apply to all {totalCount}
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 text-xs gap-1.5 w-full"
                    onClick={onApplySelected}
                    disabled={!canPreview}
                  >
                    <Play className="w-3.5 h-3.5" />
                    Apply to {selectedCount} selected
                  </Button>
                  <Button size="sm" variant="outline"
                    className="h-7 text-xs gap-1.5 w-full border-destructive/50 text-destructive hover:bg-destructive/10"
                    onClick={onDeleteSelected}>
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete {selectedCount} selected
                  </Button>
                </>
              )}
              {validatingFiles && (
                <p className="text-[11px] text-muted-foreground text-center">Validating files…</p>
              )}
              {!validatingFiles && totalCount === 0 && (
                <p className="text-[11px] text-muted-foreground text-center">No files to preview</p>
              )}
            </div>
          </Section>
        </div>
      </ScrollArea>
      </div>
    </>
  );
}

function Section({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
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

function IssueRow({ issue }: { issue: SanityIssue }) {
  const isError = issue.severity === 'error';
  return (
    <div className={cn(
      'flex items-start gap-1.5 rounded px-2 py-1 text-[11px]',
      isError ? 'bg-destructive/10 text-destructive' : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    )}>
      {isError
        ? <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
        : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
      <span className="leading-tight">{issue.message}</span>
    </div>
  );
}
