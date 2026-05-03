'use client';

import { useState, useEffect, useCallback } from 'react';
import { Database, Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sidebar } from './Sidebar';
import { UploadDialog } from './UploadDialog';
import { MetadataBar } from './MetadataBar';
import { ExportDialog } from './ExportDialog';
import { DatasetView } from './DatasetView';
import type { Dataset } from '@/lib/dataset';
import type { TransformConfig } from '@/lib/model-config';
import { MODEL_CONFIGS, computeTransformedMetadata, isValidResolution, isValidFrameCount } from '@/lib/model-config';
import { validateDatasetFile } from '@/lib/validation';
import { saveDatasets, loadDatasets, purgeDatasetFiles } from '@/lib/persistence';
import logo from "@/assets/logo.png"
import Image from 'next/image';

const MAX_HISTORY = 50;

export function DatasetManager() {
  const [past, setPast] = useState<Dataset[][]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [future, setFuture] = useState<Dataset[][]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [validatingId, setValidatingId] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [sidebarMobileOpen, setSidebarMobileOpen] = useState(false);

  const canUndo = past.length > 0;
  const canRedo = future.length > 0;

  const commit = useCallback((newDatasets: Dataset[]) => {
    setPast(p => [...p.slice(-(MAX_HISTORY - 1)), datasets]);
    setDatasets(newDatasets);
    setFuture([]);
  }, [datasets]);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    const prev = past[past.length - 1];
    setPast(p => p.slice(0, -1));
    setFuture(f => [datasets, ...f]);
    setDatasets(prev);
  }, [past, datasets]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const next = future[0];
    setFuture(f => f.slice(1));
    setPast(p => [...p, datasets]);
    setDatasets(next);
  }, [future, datasets]);

  const selectedDataset = datasets.find((d) => d.id === selectedId) ?? null;

  // Load from persistence on mount
  useEffect(() => {
    loadDatasets().then((loaded) => {
      if (loaded.length > 0) {
        setDatasets(loaded);
        setSelectedId(loaded[0].id);
      }
      setInitialized(true);
    });
  }, []);

  // Save to persistence (debounced 500ms) when datasets change
  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => saveDatasets(datasets), 500);
    return () => clearTimeout(timer);
  }, [datasets, initialized]);

  // Warn before tab close / refresh when the user has any datasets.
  // Data is auto-saved to IndexedDB, but in-progress backend jobs or
  // partial edits not yet committed could be lost.
  useEffect(() => {
    if (!initialized || datasets.length === 0) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom messages and show their own generic dialog.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [initialized, datasets.length]);

  // Run validation whenever a dataset is selected (or added) and not yet validated
  useEffect(() => {
    if (!selectedDataset) return;
    const needsValidation = selectedDataset.files.some((f) => !f.validation);
    if (!needsValidation) return;

    const modelConfig = MODEL_CONFIGS[selectedDataset.targetModel];
    if (!modelConfig) return;

    setValidatingId(selectedDataset.id);

    Promise.all(selectedDataset.files.map((f) => validateDatasetFile(f, modelConfig))).then(
      (results) => {
        setDatasets((prev) =>
          prev.map((ds) => {
            if (ds.id !== selectedDataset.id) return ds;
            return {
              ...ds,
              files: ds.files.map((f, i) => ({ ...f, validation: results[i] })),
            };
          }),
        );
        setValidatingId(null);
      },
    );
  }, [selectedDataset?.id]);

  const handleSaveSplits = (datasetId: string, fileId: string, splits: number[]) => {
    commit(datasets.map((ds) => {
      if (ds.id !== datasetId) return ds;
      return { ...ds, files: ds.files.map((f) => f.id === fileId ? { ...f, splits } : f) };
    }));
  };

  // Atomic batch replacement — applies all segment results in one commit.
  // Used by runBatch to avoid the stale-closure overwrite bug.
  const handleReplaceBatch = (
    datasetId: string,
    updates: { fileId: string; newFiles: import('@/lib/dataset').DatasetFile[] }[],
  ) => {
    commit(datasets.map(ds => {
      if (ds.id !== datasetId) return ds;
      let files = [...ds.files];
      for (const { fileId, newFiles } of updates) {
        const idx = files.findIndex(f => f.id === fileId);
        if (idx !== -1) {
          files = [...files.slice(0, idx), ...newFiles, ...files.slice(idx + 1)];
        }
      }
      return { ...ds, files };
    }));
  };

  const handleReplaceWithSegments = (datasetId: string, fileId: string, newFiles: import('@/lib/dataset').DatasetFile[]) => {
    commit(datasets.map((ds) => {
      if (ds.id !== datasetId) return ds;
      const idx = ds.files.findIndex((f) => f.id === fileId);
      if (idx === -1) return ds;
      return {
        ...ds,
        files: [
          ...ds.files.slice(0, idx),
          ...newFiles,
          ...ds.files.slice(idx + 1),
        ],
      };
    }));
  };

  const handleAddDataset = (dataset: Dataset) => {
    commit([...datasets, dataset]);
    setSelectedId(dataset.id);
    setUploadOpen(false);
  };

  const handleApplyTransform = async (datasetId: string, cfg: TransformConfig) => {
    const dataset = datasets.find((d) => d.id === datasetId);
    if (!dataset) return;

    const modelConfig = MODEL_CONFIGS[dataset.targetModel];
    if (!modelConfig) return;

    commit(datasets.map((ds) => {
      if (ds.id !== datasetId) return ds;
      return {
        ...ds,
        files: ds.files.map((file) => {
          if (!file.validation || file.validation.status !== 'validated') return file;

          const newMeta = computeTransformedMetadata(
            file.validation.metadata,
            cfg,
            modelConfig,
            file.type,
          );

          const issues: typeof file.validation.issues = [];
          if (!isValidResolution(newMeta.width, newMeta.height, modelConfig.resolution)) {
            if (newMeta.width % modelConfig.resolution.multiple !== 0)
              issues.push({ type: 'resolution_width', message: `Width ${newMeta.width}px — not ×${modelConfig.resolution.multiple}` });
            if (newMeta.height % modelConfig.resolution.multiple !== 0)
              issues.push({ type: 'resolution_height', message: `Height ${newMeta.height}px — not ×${modelConfig.resolution.multiple}` });
          }
          if ((file.type === 'video' || file.type === 'gif') && !isValidFrameCount(newMeta.frameCount, modelConfig.frames))
            issues.push({ type: 'frame_count', message: `~${newMeta.frameCount} frames — not valid` });

          return {
            ...file,
            validation: { ...file.validation, metadata: newMeta, issues, isValid: issues.length === 0 },
          };
        }),
      };
    }));
  };

  const handleApplyTransformToSelected = async (datasetId: string, fileIds: Set<string>, cfg: TransformConfig) => {
    const dataset = datasets.find((d) => d.id === datasetId);
    if (!dataset) return;
    const modelConfig = MODEL_CONFIGS[dataset.targetModel];
    if (!modelConfig) return;
    commit(datasets.map((ds) => {
      if (ds.id !== datasetId) return ds;
      return {
        ...ds,
        files: ds.files.map((file) => {
          if (!fileIds.has(file.id)) return file;
          if (!file.validation || file.validation.status !== 'validated') return file;
          const newMeta = computeTransformedMetadata(file.validation.metadata, cfg, modelConfig, file.type);
          const issues: typeof file.validation.issues = [];
          if (!isValidResolution(newMeta.width, newMeta.height, modelConfig.resolution)) {
            if (newMeta.width % modelConfig.resolution.multiple !== 0)
              issues.push({ type: 'resolution_width', message: `Width ${newMeta.width}px — not ×${modelConfig.resolution.multiple}` });
            if (newMeta.height % modelConfig.resolution.multiple !== 0)
              issues.push({ type: 'resolution_height', message: `Height ${newMeta.height}px — not ×${modelConfig.resolution.multiple}` });
          }
          if ((file.type === 'video' || file.type === 'gif') && !isValidFrameCount(newMeta.frameCount, modelConfig.frames))
            issues.push({ type: 'frame_count', message: `~${newMeta.frameCount} frames — not valid` });
          return { ...file, validation: { ...file.validation, metadata: newMeta, issues, isValid: issues.length === 0 } };
        }),
      };
    }));
  };

  const handleDeleteFiles = (datasetId: string, fileIds: Set<string>) => {
    commit(datasets.map(ds => {
      if (ds.id !== datasetId) return ds;
      return { ...ds, files: ds.files.filter(f => !fileIds.has(f.id)) };
    }));
  };

  const handleUpdateCaption = (datasetId: string, fileId: string, caption: string) => {
    commit(datasets.map(ds => {
      if (ds.id !== datasetId) return ds;
      return { ...ds, files: ds.files.map(f => f.id === fileId ? { ...f, caption } : f) };
    }));
  };

  // Batch update: applies all captions in ONE commit so undo works atomically
  // and avoids stale-closure issues when many async calls complete in sequence.
  const handleDeleteDataset = (datasetId: string) => {
    const ds = datasets.find(d => d.id === datasetId);
    if (!ds) return;

    // Kick off async cleanup — revoke blob URLs + remove files from IndexedDB
    purgeDatasetFiles(
      ds.files.map(f => f.id),
      ds.files.map(f => f.mediaUrl),
    );

    // Commit the deletion (this is undoable for 50 steps)
    const remaining = datasets.filter(d => d.id !== datasetId);
    commit(remaining);

    // Deselect if the deleted dataset was selected
    if (selectedId === datasetId) {
      setSelectedId(remaining.length > 0 ? remaining[0].id : null);
    }
  };

  const handleUpdateTriggerWord = (datasetId: string, word: string) => {
    commit(datasets.map(ds =>
      ds.id !== datasetId ? ds : { ...ds, triggerWord: word || undefined },
    ));
  };

  const handleUpdateCaptionBatch = (
    datasetId: string,
    updates: { fileId: string; caption: string }[],
  ) => {
    if (updates.length === 0) return;
    const map = new Map(updates.map(u => [u.fileId, u.caption]));
    commit(datasets.map(ds => {
      if (ds.id !== datasetId) return ds;
      return {
        ...ds,
        files: ds.files.map(f => map.has(f.id) ? { ...f, caption: map.get(f.id)! } : f),
      };
    }));
  };

  return (
    <div className="flex flex-col h-full">
      <header className="shrink-0 flex items-center gap-2 px-2 sm:px-4 h-11 border-b bg-card/80 backdrop-blur-sm">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 md:hidden"
          onClick={() => setSidebarMobileOpen(true)}
        >
          <Menu className="w-4 h-4" />
        </Button>
        {/* <Database className="w-4 h-4 text-muted-foreground hidden sm:block" /> */}
        <Image src={logo} alt='logo' className="w-6 h-6 text-muted-foreground hidden sm:block" />
        <span className="text-sm font-semibold truncate">DiffForge</span>
      </header>

      <div className="flex flex-1 min-h-0 relative">
        <Sidebar
          datasets={datasets}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onNew={() => setUploadOpen(true)}
          mobileOpen={sidebarMobileOpen}
          onMobileClose={() => setSidebarMobileOpen(false)}
          onDeleteDataset={handleDeleteDataset}
        />

        <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {selectedDataset ? (
            <>
              <MetadataBar
                dataset={selectedDataset}
                validating={validatingId === selectedDataset.id}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undo}
                onRedo={redo}
                onExport={() => setExportOpen(true)}
              />
              <DatasetView
                dataset={selectedDataset}
                validating={validatingId === selectedDataset.id}
                onApplyTransform={(cfg) => handleApplyTransform(selectedDataset.id, cfg)}
                onSaveSplits={(fileId, splits) => handleSaveSplits(selectedDataset.id, fileId, splits)}
                onApplyTransformToSelected={(fileIds, cfg) => handleApplyTransformToSelected(selectedDataset.id, fileIds, cfg)}
                onReplaceWithSegments={(fileId, newFiles) => handleReplaceWithSegments(selectedDataset.id, fileId, newFiles)}
                onReplaceBatch={(updates) => handleReplaceBatch(selectedDataset.id, updates)}
                onDeleteFiles={(fileIds) => handleDeleteFiles(selectedDataset.id, fileIds)}
                onUpdateCaption={(fileId, caption) => handleUpdateCaption(selectedDataset.id, fileId, caption)}
                onUpdateCaptionBatch={(updates) => handleUpdateCaptionBatch(selectedDataset.id, updates)}
              />
            </>
          ) : (
            <EmptyState onNew={() => setUploadOpen(true)} />
          )}
        </div>
      </div>

      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onConfirm={handleAddDataset}
      />

      {exportOpen && selectedDataset && (
        <ExportDialog
          dataset={selectedDataset}
          open={exportOpen}
          onClose={() => setExportOpen(false)}
          onUpdateTriggerWord={(word) => handleUpdateTriggerWord(selectedDataset.id, word)}
        />
      )}
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center p-8">
      <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center">
        <Database className="w-8 h-8 text-muted-foreground" />
      </div>
      <div>
        <h3 className="font-semibold text-base">No dataset selected</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Create a new dataset or select one from the sidebar.
        </p>
      </div>
      <button
        onClick={onNew}
        className="text-sm text-primary underline underline-offset-2 hover:opacity-80 transition-opacity"
      >
        Upload your first dataset
      </button>
    </div>
  );
}
