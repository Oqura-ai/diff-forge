'use client';

import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Archive, Download, Loader2, CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Dataset } from '@/lib/dataset';
import { exportDatasetAsZip } from '@/lib/export-utils';

interface ExportDialogProps {
  dataset: Dataset;
  open: boolean;
  onClose: () => void;
  onUpdateTriggerWord: (word: string) => void;
}

export function ExportDialog({
  dataset, open, onClose, onUpdateTriggerWord,
}: ExportDialogProps) {
  const [triggerWord, setTriggerWord] = useState(dataset.triggerWord ?? '');
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [done, setDone] = useState(false);

  // Sync trigger word if the dataset changes externally
  useEffect(() => {
    if (!exporting) setTriggerWord(dataset.triggerWord ?? '');
  }, [dataset.triggerWord, exporting]);

  const captionedCount  = dataset.files.filter(f => f.caption !== null).length;
  const missingCount    = dataset.files.length - captionedCount;
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  const handleTriggerBlur = () => {
    onUpdateTriggerWord(triggerWord.trim());
  };

  const handleExport = async () => {
    setExporting(true);
    setDone(false);
    setProgress({ completed: 0, total: dataset.files.length });

    try {
      await exportDatasetAsZip(
        dataset,
        { triggerWord: triggerWord.trim() || undefined },
        (completed, total) => setProgress({ completed, total }),
      );
      setDone(true);
    } catch (err) {
      console.error('[export]', err);
    } finally {
      setExporting(false);
    }
  };

  const handleClose = () => {
    if (!exporting) {
      setDone(false);
      onClose();
    }
  };

  const previewCaption =
    dataset.files.find(f => f.caption)?.caption ?? 'Caption text goes here…';
  const previewText = triggerWord.trim()
    ? `${triggerWord.trim()}, ${previewCaption}`
    : previewCaption;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="w-[95vw] max-w-[440px] gap-0 p-0 flex flex-col">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <Archive className="w-4 h-4 text-muted-foreground" />
            Export Dataset
          </DialogTitle>
          <p className="text-xs text-muted-foreground truncate">"{dataset.name}"</p>
        </DialogHeader>

        <div className="px-5 py-4 flex flex-col gap-4 overflow-y-auto">

          {/* Stats */}
          <div className="rounded-lg border bg-muted/30 px-3 py-2.5 flex flex-col gap-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Total files</span>
              <span className="font-mono font-medium">{dataset.files.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Captioned</span>
              <span className={cn(
                'font-mono font-medium',
                captionedCount === dataset.files.length ? 'text-emerald-500' : 'text-amber-400',
              )}>
                {captionedCount} / {dataset.files.length}
              </span>
            </div>
            {missingCount > 0 && (
              <p className="text-[10px] text-amber-400 leading-tight">
                {missingCount} file{missingCount !== 1 && 's'} without caption — exported with <code className="font-mono">null</code>.
              </p>
            )}
          </div>

          <Separator />

          {/* Trigger word */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Trigger word</Label>
              <span className="text-[10px] text-muted-foreground">optional</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                placeholder="e.g. PBmcK7uc"
                value={triggerWord}
                onChange={e => setTriggerWord(e.target.value)}
                onBlur={handleTriggerBlur}
                className="h-8 text-xs font-mono flex-1"
                disabled={exporting}
              />
              {triggerWord && (
                <Button
                  size="icon" variant="ghost" className="h-8 w-8 shrink-0"
                  onClick={() => { setTriggerWord(''); onUpdateTriggerWord(''); }}
                  disabled={exporting}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>

            {/* Live preview */}
            <div className="rounded-md bg-muted/50 border px-2.5 py-2">
              <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wide font-semibold">
                Caption preview
              </p>
              <p className="text-[10px] text-foreground leading-relaxed line-clamp-3 break-words">
                {triggerWord.trim()
                  ? <><span className="text-primary font-semibold">{triggerWord.trim()},</span> {previewCaption}</>
                  : previewCaption}
              </p>
            </div>
          </div>

          <Separator />

          {/* Output format */}
          <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
            <p className="font-semibold text-foreground text-xs mb-0.5">Export contents</p>
            <p>📦 <code className="font-mono text-[10px]">{dataset.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip</code></p>
            <p className="ml-4">└ <code className="font-mono text-[10px]">0001_filename.mp4</code> + <code className="font-mono text-[10px]">.txt</code></p>
            <p className="ml-4">└ <code className="font-mono text-[10px]">0002_…</code></p>
            <p className="ml-4">└ <code className="font-mono text-[10px]">metadata.json</code></p>
            <div className="mt-1.5 rounded border border-border/50 px-2 py-1.5 bg-background/50 text-[10px] font-mono text-muted-foreground leading-relaxed">
              {`{ "media_path", "width", "height",\n  "num_frames", "resolution", "caption" }`}
            </div>
          </div>

          {/* Progress */}
          {(exporting || done) && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs">
                {done
                  ? <span className="flex items-center gap-1.5 text-emerald-500">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Download started
                    </span>
                  : <span className="flex items-center gap-1.5 text-muted-foreground">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      Packaging files…
                    </span>}
                <span className="font-mono text-muted-foreground">{pct}%</span>
              </div>
              {!done && (
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-between items-center px-5 py-3 border-t gap-2 shrink-0">
          <Button variant="outline" onClick={handleClose} disabled={exporting}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          <Button
            onClick={handleExport}
            disabled={exporting || dataset.files.length === 0}
            className="gap-1.5"
          >
            {exporting
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Packaging…</>
              : <><Download className="w-3.5 h-3.5" />Export {dataset.files.length} files</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
