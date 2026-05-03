'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { SlidersHorizontal, MessageSquare, X, Check, Loader2, AlertTriangle, Wand2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { TransformPanel } from './TransformPanel';
import { VideoGrid } from './VideoGrid';
import { ItemDetailModal } from './ItemDetailModal';
import { ItemEditWorkspace } from './ItemEditWorkspace';
import { CaptionPanel, type CaptionConfig } from './CaptionPanel';
import type { Dataset, DatasetFile } from '@/lib/dataset';
import type { TransformConfig, ModelConfig } from '@/lib/model-config';
import { MODEL_CONFIGS } from '@/lib/model-config';
import { processVideoWithBackend } from '@/lib/transform-utils';
import { generateCaption, type ProviderConfig } from '@/lib/caption-client';
import { cn } from '@/lib/utils';

interface BatchState {
  total: number;
  completed: number;
  current: string;
  failed: string[];
}

interface DatasetViewProps {
  dataset: Dataset;
  validating: boolean;
  onApplyTransform: (cfg: TransformConfig) => Promise<void>;
  onSaveSplits: (fileId: string, splits: number[]) => void;
  onApplyTransformToSelected: (fileIds: Set<string>, cfg: TransformConfig) => Promise<void>;
  onReplaceWithSegments: (fileId: string, newFiles: DatasetFile[]) => void;
  onReplaceBatch: (updates: { fileId: string; newFiles: DatasetFile[] }[]) => void;
  onDeleteFiles: (fileIds: Set<string>) => void;
  onUpdateCaption: (fileId: string, caption: string) => void;
  onUpdateCaptionBatch: (updates: { fileId: string; caption: string }[]) => void;
}

const DEFAULT_TRANSFORM: TransformConfig = {
  resolution: { mode: 'auto' },
  frames: { mode: 'auto' },
  applyResolution: true,
  applyFrames: true,
};

const DEFAULT_CAPTION_CONFIG: CaptionConfig = {
  systemPrompt: '',
  samplingMode: 'empty-only',
};

export function DatasetView({ dataset, validating, onApplyTransform, onSaveSplits, onApplyTransformToSelected, onReplaceWithSegments, onReplaceBatch, onDeleteFiles, onUpdateCaption, onUpdateCaptionBatch }: DatasetViewProps) {
  const [activeTab, setActiveTab] = useState('transform');

  // Transform tab state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [transformConfig, setTransformConfig] = useState<TransformConfig>(DEFAULT_TRANSFORM);
  const [panelMobileOpen, setPanelMobileOpen] = useState(false);
  const [batchState, setBatchState] = useState<BatchState | null>(null);

  // Caption tab state
  const [captionConfig, setCaptionConfig] = useState<CaptionConfig>(DEFAULT_CAPTION_CONFIG);
  const [captionProviderConfig, setCaptionProviderConfig] = useState<ProviderConfig | null>(null);
  const [captionSelectedIds, setCaptionSelectedIds] = useState<Set<string>>(new Set());
  const [captionFocusedId, setCaptionFocusedId] = useState<string | null>(null);
  const [captionPanelMobileOpen, setCaptionPanelMobileOpen] = useState(false);
  const [captionGenerating, setCaptionGenerating] = useState(false);
  const [captionBatchState, setCaptionBatchState] = useState<BatchState | null>(null);
  // Preview modal state
  const [captionPreviewItems, setCaptionPreviewItems] = useState<{ file: DatasetFile; caption: string; error?: string }[]>([]);
  const [captionPreviewOpen, setCaptionPreviewOpen] = useState(false);

  // Item detail / edit state
  const [detailFileId, setDetailFileId] = useState<string | null>(null);
  const [editFileId, setEditFileId] = useState<string | null>(null);

  const modelConfig: ModelConfig = MODEL_CONFIGS[dataset.targetModel] ?? MODEL_CONFIGS['LTX'];
  const detailFile = dataset.files.find((f) => f.id === detailFileId) ?? null;
  const editFile = dataset.files.find((f) => f.id === editFileId) ?? null;
  const captionFocusedFile = dataset.files.find((f) => f.id === captionFocusedId) ?? null;

  // ── transform tab helpers ─────────────────────────────────────────────────
  const toggleSelect = (id: string) =>
    setSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const navigateFile = (currentId: string | null, direction: 'prev' | 'next'): string | null => {
    if (!currentId) return null;
    const idx = dataset.files.findIndex((f) => f.id === currentId);
    const len = dataset.files.length;
    return dataset.files[(direction === 'prev' ? (idx - 1 + len) : (idx + 1)) % len].id;
  };

  const handleDeleteSelected = () => {
    onDeleteFiles(selectedIds);
    setSelectedIds(new Set());
  };

  const handleDeleteFile = (fileId: string) => {
    onDeleteFiles(new Set([fileId]));
  };

  // Same stale-closure fix as runCaptionBatch: collect ALL results first,
  // then apply in ONE commit so earlier replacements are not overwritten.
  const runBatch = async (files: DatasetFile[]) => {
    if (files.length === 0) return;
    setBatchState({ total: files.length, completed: 0, current: '', failed: [] });

    const results: { fileId: string; newFiles: DatasetFile[] }[] = [];

    for (const file of files) {
      setBatchState(prev => prev ? { ...prev, current: file.name } : null);
      try {
        const newFiles = await processVideoWithBackend({
          file, model: modelConfig.id, config: transformConfig,
        });
        results.push({ fileId: file.id, newFiles });
      } catch {
        setBatchState(prev => prev ? { ...prev, failed: [...prev.failed, file.name] } : null);
      }
      setBatchState(prev => prev ? { ...prev, completed: prev.completed + 1 } : null);
    }

    // Single atomic commit — no stale-closure overwrite
    if (results.length > 0) onReplaceBatch(results);

    setBatchState(null);
  };

  const handleApplyAll = async () => {
    await runBatch(
      dataset.files.filter(f => (f.type === 'video' || f.type === 'gif') && f.validation?.status === 'validated'),
    );
  };

  const handleApplySelected = async () => {
    const toProcess = dataset.files.filter(
      f => selectedIds.has(f.id) && (f.type === 'video' || f.type === 'gif') && f.validation?.status === 'validated',
    );
    setSelectedIds(new Set());
    await runBatch(toProcess);
  };

  // ── caption tab helpers ───────────────────────────────────────────────────
  const toggleCaptionSelect = (id: string) =>
    setCaptionSelectedIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const captionedCount = dataset.files.filter((f) => f.caption !== null).length;

  // ── caption generation ────────────────────────────────────────────────────
  // Collect ALL results first, then commit once — avoids the stale-closure
  // bug where each onUpdateCaption call would overwrite the previous one
  // because they all started from the same original datasets snapshot.
  const runCaptionBatch = async (files: DatasetFile[]) => {
    if (!captionProviderConfig || files.length === 0) return;
    setCaptionGenerating(true);
    setCaptionBatchState({ total: files.length, completed: 0, current: '', failed: [] });

    const results: { fileId: string; caption: string }[] = [];

    for (const file of files) {
      setCaptionBatchState(prev => prev ? { ...prev, current: file.name } : null);
      try {
        const caption = await generateCaption(
          file.file, captionProviderConfig, captionConfig.systemPrompt,
        );
        results.push({ fileId: file.id, caption });
      } catch {
        setCaptionBatchState(prev =>
          prev ? { ...prev, failed: [...prev.failed, file.name] } : null,
        );
      }
      setCaptionBatchState(prev => prev ? { ...prev, completed: prev.completed + 1 } : null);
    }

    // Single atomic commit after the loop — no stale-closure issue
    if (results.length > 0) onUpdateCaptionBatch(results);

    setCaptionGenerating(false);
    setCaptionBatchState(null);
  };

  const handleGenerateAll = () => {
    const toCaption = captionConfig.samplingMode === 'empty-only'
      ? dataset.files.filter(f => f.caption === null)
      : dataset.files;
    return runCaptionBatch(toCaption);
  };

  const handleGenerateSelected = () => {
    const toCaption = dataset.files.filter(
      f => captionSelectedIds.has(f.id) &&
        (captionConfig.samplingMode === 'override' || f.caption === null),
    );
    setCaptionSelectedIds(new Set());
    return runCaptionBatch(toCaption);
  };

  const handleGenerateOne = useCallback(async (fileId: string) => {
    if (!captionProviderConfig) return;
    const file = dataset.files.find(f => f.id === fileId);
    if (!file) return;
    const caption = await generateCaption(
      file.file, captionProviderConfig, captionConfig.systemPrompt,
    );
    onUpdateCaption(fileId, caption); // single call — no stale-closure risk
  }, [captionProviderConfig, captionConfig.systemPrompt, dataset.files, onUpdateCaption]);

  const handlePreviewSamples = async () => {
    if (!captionProviderConfig) return;
    setCaptionGenerating(true);
    const shuffled = [...dataset.files].sort(() => Math.random() - 0.5).slice(0, 5);
    const items: { file: DatasetFile; caption: string; error?: string }[] = [];
    for (const file of shuffled) {
      try {
        const caption = await generateCaption(
          file.file, captionProviderConfig, captionConfig.systemPrompt,
        );
        items.push({ file, caption });
      } catch (e) {
        items.push({ file, caption: '', error: e instanceof Error ? e.message : String(e) });
      }
    }
    setCaptionPreviewItems(items);
    setCaptionPreviewOpen(true);
    setCaptionGenerating(false);
  };

  const handleApplyPreview = () => {
    const updates = captionPreviewItems
      .filter(it => !it.error)
      .map(it => ({ fileId: it.file.id, caption: it.caption }));
    if (updates.length > 0) onUpdateCaptionBatch(updates);
    setCaptionPreviewOpen(false);
  };

  // ── tab trigger style ─────────────────────────────────────────────────────
  const tabTrigger =
    'rounded-none border-b-2 border-transparent data-[state=active]:border-emerald-500 data-[state=active]:text-emerald-600 dark:data-[state=active]:text-emerald-400 data-[state=active]:bg-transparent pb-1 text-sm h-6 rounded-sm';

  return (
    <>
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex flex-col flex-1 min-h-0"
      >
        <TabsList className="shrink-0 w-full rounded-none border-b justify-start h-9 bg-transparent px-2 sm:px-4 gap-0">
          <TabsTrigger value="transform" className={tabTrigger}>Media Transform</TabsTrigger>
          <TabsTrigger value="caption" className={tabTrigger}>Caption</TabsTrigger>

          {/* mobile panel toggle — changes based on active tab */}
          <div className="ml-auto flex items-center md:hidden">
            {activeTab === 'transform' && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                onClick={() => setPanelMobileOpen(true)}>
                <SlidersHorizontal className="w-3.5 h-3.5" />
                Transform
              </Button>
            )}
            {activeTab === 'caption' && (
              <Button size="sm" variant="ghost" className="h-7 text-xs gap-1.5"
                onClick={() => setCaptionPanelMobileOpen(true)}>
                <MessageSquare className="w-3.5 h-3.5" />
                Caption
              </Button>
            )}
          </div>
        </TabsList>

        {/* ── Transform tab ─────────────────────────────────────────────── */}
        <TabsContent value="transform" className="flex flex-1 min-h-0 m-0">
          <TransformPanel
            sanityIssues={dataset.issues}
            modelConfig={modelConfig}
            transformConfig={transformConfig}
            onConfigChange={setTransformConfig}
            selectedCount={selectedIds.size}
            totalCount={dataset.files.length}
            validatingFiles={validating}
            onDeleteSelected={handleDeleteSelected}
            onApplyAll={handleApplyAll}
            onApplySelected={handleApplySelected}
            mobileOpen={panelMobileOpen}
            onMobileClose={() => setPanelMobileOpen(false)}
          />
          <VideoGrid
            files={dataset.files}
            validating={validating}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onItemClick={setDetailFileId}
            onDeleteFile={handleDeleteFile}
          />
        </TabsContent>

        {/* ── Caption tab ───────────────────────────────────────────────── */}
        <TabsContent value="caption" className="flex flex-1 min-h-0 m-0">
          <CaptionPanel
            config={captionConfig}
            onConfigChange={setCaptionConfig}
            providerConfig={captionProviderConfig}
            onProviderConfigChange={setCaptionProviderConfig}
            selectedCount={captionSelectedIds.size}
            totalCount={dataset.files.length}
            captionedCount={captionedCount}
            generating={captionGenerating}
            mobileOpen={captionPanelMobileOpen}
            onMobileClose={() => setCaptionPanelMobileOpen(false)}
            onGenerateAll={handleGenerateAll}
            onGenerateSelected={handleGenerateSelected}
            onPreviewSamples={handlePreviewSamples}
          />

          {/* caption grid + detail split */}
          <div className="flex flex-1 min-h-0 min-w-0 relative">
            <CaptionGrid
              files={dataset.files}
              selectedIds={captionSelectedIds}
              focusedId={captionFocusedId}
              onToggleSelect={toggleCaptionSelect}
              onFocus={setCaptionFocusedId}
            />

            {captionFocusedFile && (
              <CaptionDetail
                file={captionFocusedFile}
                providerConfig={captionProviderConfig}
                onClose={() => setCaptionFocusedId(null)}
                onGenerate={() => handleGenerateOne(captionFocusedFile.id)}
              />
            )}

            {/* Batch caption progress overlay */}
            {captionBatchState && (
              <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-20">
                <div className="bg-card border rounded-xl px-6 py-5 shadow-xl flex flex-col gap-3 w-72">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
                    <p className="text-sm font-semibold">Generating captions…</p>
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="truncate max-w-[180px]">{captionBatchState.current}</span>
                      <span className="font-mono shrink-0">{captionBatchState.completed}/{captionBatchState.total}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${(captionBatchState.completed / captionBatchState.total) * 100}%` }} />
                    </div>
                  </div>
                  {captionBatchState.failed.length > 0 && (
                    <div className="flex items-start gap-1.5 text-[11px] text-orange-400">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      <span>{captionBatchState.failed.length} failed: {captionBatchState.failed.slice(0, 2).join(', ')}{captionBatchState.failed.length > 2 ? '…' : ''}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      {/* Caption preview modal */}
      {captionPreviewOpen && (
        <CaptionPreviewModal
          items={captionPreviewItems}
          onApply={handleApplyPreview}
          onClose={() => setCaptionPreviewOpen(false)}
        />
      )}

      {detailFile && (
        <ItemDetailModal
          file={detailFile}
          allFiles={dataset.files}
          selectedIds={selectedIds}
          open={!!detailFileId}
          onClose={() => setDetailFileId(null)}
          onNavigate={(dir) => setDetailFileId(navigateFile(detailFileId, dir))}
          onToggleSelect={toggleSelect}
          onEdit={() => { setEditFileId(detailFileId); setDetailFileId(null); }}
        />
      )}

      {editFile && (
        <ItemEditWorkspace
          file={editFile}
          allFiles={dataset.files}
          transformConfig={transformConfig}
          modelConfig={modelConfig}
          open={!!editFileId}
          onClose={() => setEditFileId(null)}
          onNavigate={(dir) => setEditFileId(navigateFile(editFileId, dir))}
          onSaveSplits={onSaveSplits}
          onReplaceWithSegments={onReplaceWithSegments}
        />
      )}

      {/* Batch processing overlay */}
      {batchState && (
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-20">
          <div className="bg-card border rounded-xl px-6 py-5 shadow-xl flex flex-col gap-3 w-72">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
              <p className="text-sm font-semibold">Processing videos…</p>
            </div>
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="truncate max-w-[180px]">{batchState.current}</span>
                <span className="font-mono shrink-0">{batchState.completed}/{batchState.total}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{ width: `${(batchState.completed / batchState.total) * 100}%` }}
                />
              </div>
            </div>
            {batchState.failed.length > 0 && (
              <div className="flex items-start gap-1.5 text-[11px] text-orange-400">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{batchState.failed.length} failed: {batchState.failed.slice(0, 2).join(', ')}{batchState.failed.length > 2 ? '…' : ''}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

// ─── Caption grid ─────────────────────────────────────────────────────────────

function CaptionGrid({
  files,
  selectedIds,
  focusedId,
  onToggleSelect,
  onFocus,
}: {
  files: DatasetFile[];
  selectedIds: Set<string>;
  focusedId: string | null;
  onToggleSelect: (id: string) => void;
  onFocus: (id: string | null) => void;
}) {
  const captioned = files.filter((f) => f.caption !== null).length;

  if (files.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        No media files in this dataset.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 min-w-0">
      {/* summary bar */}
      <div className="shrink-0 px-4 py-2 border-b flex items-center gap-3">
        <div className="flex-1 flex h-1.5 rounded-full overflow-hidden bg-muted">
          {files.length > 0 && (
            <div
              className="bg-emerald-500 transition-all"
              style={{ width: `${(captioned / files.length) * 100}%` }}
            />
          )}
        </div>
        <div className="shrink-0 flex items-center gap-2 text-[11px]">
          {captioned > 0 && (
            <span className="text-emerald-600 dark:text-emerald-400 font-medium">{captioned} captioned</span>
          )}
          {files.length - captioned > 0 && (
            <span className="text-amber-500 font-medium">{files.length - captioned} missing</span>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 p-4">
          {files.map((file) => (
            <CaptionCard
              key={file.id}
              file={file}
              selected={selectedIds.has(file.id)}
              focused={focusedId === file.id}
              onToggleSelect={() => onToggleSelect(file.id)}
              onOpenCaption={() => onFocus(focusedId === file.id ? null : file.id)}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Caption card ─────────────────────────────────────────────────────────────

function CaptionCard({
  file,
  selected,
  focused,
  onToggleSelect,
  onOpenCaption,
}: {
  file: DatasetFile;
  selected: boolean;
  focused: boolean;
  onToggleSelect: () => void;
  onOpenCaption: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (hovered) v.play().catch(() => {});
    else { v.pause(); v.currentTime = 0; }
  }, [hovered]);

  return (
    <div
      className={cn(
        'group relative flex flex-col rounded-lg border bg-card overflow-hidden transition-all duration-150',
        selected ? 'ring-2 ring-primary border-primary' : focused ? 'border-emerald-500/50' : 'border-border',
        'hover:shadow-md',
      )}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {/* thumbnail */}
      <div className="relative aspect-video bg-black overflow-hidden cursor-pointer" onClick={onOpenCaption}>
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

        {/* caption text peek on hover */}
        <div className={cn(
          'absolute bottom-0 left-0 right-0 px-2 pb-2 pt-4',
          'bg-gradient-to-t from-black/70 to-transparent',
          'transition-opacity duration-150',
          hovered ? 'opacity-100' : 'opacity-0',
        )}>
          {file.caption ? (
            <p className="text-[10px] text-white/90 line-clamp-2 leading-tight">{file.caption}</p>
          ) : (
            <p className="text-[10px] text-white/50 italic">No caption</p>
          )}
        </div>

        {/* caption status dot */}
        <div className="absolute top-1.5 left-1.5">
          {file.caption !== null
            ? <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-sm" />
            : <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-sm" />}
        </div>

        {selected && <div className="absolute inset-0 bg-primary/10 pointer-events-none" />}
      </div>

      {/* bottom row */}
      <div className="px-2 py-1.5 flex items-center gap-1.5">
        <p className="text-[11px] text-muted-foreground truncate flex-1 min-w-0" title={file.name}>
          {file.name}
        </p>

        {/* select toggle */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          className={cn(
            'shrink-0 flex items-center justify-center w-5 h-5 rounded border-2 transition-all',
            selected
              ? 'bg-primary border-primary'
              : 'border-border hover:border-primary/60 bg-transparent',
          )}
        >
          {selected && <Check className="w-2.5 h-2.5 text-primary-foreground" />}
        </button>

        {/* caption button */}
        <button
          onClick={(e) => { e.stopPropagation(); onOpenCaption(); }}
          className={cn(
            'shrink-0 text-[10px] px-1.5 py-0.5 rounded border transition-colors font-medium',
            focused
              ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-500'
              : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground',
          )}
        >
          Caption
        </button>
      </div>
    </div>
  );
}

// ─── Caption preview modal ───────────────────────────────────────────────────

function CaptionPreviewModal({
  items,
  onApply,
  onClose,
}: {
  items: { file: DatasetFile; caption: string; error?: string }[];
  onApply: () => void;
  onClose: () => void;
}) {
  const ok = items.filter(it => !it.error).length;

  return (
    <Dialog open onOpenChange={(v: boolean) => !v && onClose()}>
      <DialogContent className="w-[95vw] max-w-[620px] max-h-[90vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base">Caption Preview</DialogTitle>
          <p className="text-xs text-muted-foreground">
            Generated for {items.length} sample{items.length !== 1 && 's'} — review before applying
          </p>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3 flex flex-col gap-3">
            {items.map(({ file, caption, error }) => (
              <div key={file.id} className={cn(
                'rounded-lg border overflow-hidden',
                error ? 'border-destructive/30' : 'border-border',
              )}>
                <div className="flex">
                  <div className="shrink-0 w-24 bg-black">
                    {file.type === 'video' ? (
                      <video src={file.mediaUrl} muted playsInline preload="none"
                        className="w-full h-full object-contain max-h-16" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={file.mediaUrl} alt={file.name}
                        className="w-full h-full object-contain max-h-16" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 p-2.5 flex flex-col gap-1">
                    <p className="text-[11px] font-medium truncate text-foreground">{file.name}</p>
                    {error
                      ? <p className="text-[10px] text-destructive leading-tight">{error}</p>
                      : <p className="text-xs text-muted-foreground leading-relaxed h-12 overflow-scroll">{caption}</p>
                    }
                  </div>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="px-5 py-2 border-t border-b bg-muted/30 shrink-0">
          <p className="text-xs text-muted-foreground">
            <span className="text-emerald-500 font-medium">{ok} caption{ok !== 1 && 's'}</span> ready to apply
            {items.length - ok > 0 && (
              <span className="text-destructive font-medium"> · {items.length - ok} failed</span>
            )}
          </p>
        </div>

        <div className="flex justify-between px-5 py-3 gap-2 shrink-0">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={onApply} disabled={ok === 0} className="gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Apply {ok} caption{ok !== 1 && 's'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Caption detail panel ─────────────────────────────────────────────────────

function CaptionDetail({
  file,
  providerConfig,
  onClose,
  onGenerate,
}: {
  file: DatasetFile;
  providerConfig: import('@/lib/caption-client').ProviderConfig | null;
  onClose: () => void;
  onGenerate: () => Promise<void>;
}) {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await onGenerate();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const canGenerate = !!providerConfig && !generating;

  return (
    <div className="shrink-0 w-64 sm:w-72 flex flex-col border-l bg-muted/20">
      {/* header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
        <p className="text-xs font-semibold truncate flex-1 min-w-0" title={file.name}>{file.name}</p>
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={onClose}>
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* thumbnail */}
      <div className="shrink-0 bg-black">
        {file.type === 'video' ? (
          <video
            key={file.id}
            src={file.mediaUrl}
            muted loop playsInline preload="metadata" controls
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
      </div>

      {/* generate button */}
      <div className="shrink-0 px-3 pt-2.5 pb-0">
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5 w-full"
          disabled={!canGenerate}
          onClick={handleGenerate}
        >
          {generating
            ? <><Loader2 className="w-3 h-3 animate-spin" />Generating…</>
            : <><Wand2 className="w-3 h-3" />Generate caption</>}
        </Button>
        {!providerConfig && (
          <p className="text-[10px] text-muted-foreground text-center mt-1">Configure a provider in the left panel first.</p>
        )}
        {error && (
          <p className="text-[10px] text-destructive mt-1 leading-tight break-words">{error}</p>
        )}
      </div>

      {/* caption display */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Caption
            </p>
            {file.caption !== null ? (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1.5 border-emerald-500/60 text-emerald-400">
                captioned
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[9px] h-3.5 px-1.5 border-amber-500/60 text-amber-400">
                missing
              </Badge>
            )}
          </div>

          {file.caption ? (
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap break-words">
              {file.caption}
            </p>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-3 text-center">
              <p className="text-xs text-muted-foreground italic">No caption yet.</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
