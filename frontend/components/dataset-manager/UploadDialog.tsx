'use client';

import { useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { FolderOpen, AlertTriangle, XCircle, CheckCircle2, Film, Image } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  processUploadedFolder,
  type Dataset,
  type SanityIssue,
  type TargetModel,
  SUPPORTED_VIDEO_EXTS,
  SUPPORTED_IMAGE_EXTS,
  SUPPORTED_GIF_EXTS,
} from '@/lib/dataset';

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (dataset: Dataset) => void;
}

interface ScanResult {
  fileCount: number;
  videoCount: number;
  imageCount: number;
  gifCount: number;
  issues: SanityIssue[];
}

export function UploadDialog({ open, onClose, onConfirm }: UploadDialogProps) {
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetModel, setTargetModel] = useState<TargetModel>('LTX');
  const [files, setFiles] = useState<FileList | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [scanning, setScanning] = useState(false);

  const handleFolderChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files;
    if (!picked || picked.length === 0) return;

    setScanning(true);
    setFiles(picked);

    const fileArray = Array.from(picked);
    const getExt = (f: File) => f.name.split('.').pop()?.toLowerCase() ?? '';
    const videoCount = fileArray.filter((f) => SUPPORTED_VIDEO_EXTS.has(getExt(f))).length;
    const imageCount = fileArray.filter((f) => SUPPORTED_IMAGE_EXTS.has(getExt(f))).length;
    const gifCount = fileArray.filter((f) => SUPPORTED_GIF_EXTS.has(getExt(f))).length;

    const { issues } = await processUploadedFolder(picked);

    setScan({
      fileCount: picked.length,
      videoCount,
      imageCount,
      gifCount,
      issues,
    });
    setScanning(false);
  };

  const handleSubmit = async () => {
    if (!files || !name.trim()) return;

    const { datasetFiles, issues } = await processUploadedFolder(files);

    onConfirm({
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim(),
      targetModel,
      files: datasetFiles,
      issues,
      createdAt: new Date(),
    });

    resetForm();
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setTargetModel('LTX');
    setFiles(null);
    setScan(null);
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const canSubmit =
    !!files &&
    !!name.trim() &&
    !scanning &&
    ((scan?.videoCount ?? 0) + (scan?.imageCount ?? 0) + (scan?.gifCount ?? 0)) > 0;
  const hasErrors = scan?.issues.some((i) => i.severity === 'error') ?? false;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="w-[95vw] max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Dataset</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-1">
          {/* folder picker */}
          <div className="flex flex-col gap-1.5">
            <Label>Dataset Folder</Label>
            <div
              onClick={() => folderInputRef.current?.click()}
              className={cn(
                'flex items-center gap-3 rounded-lg border-2 border-dashed px-4 py-5 cursor-pointer transition-colors',
                'hover:border-primary/60 hover:bg-accent/30',
                files ? 'border-primary/40 bg-accent/20' : 'border-border',
              )}
            >
              <FolderOpen className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                {files ? (
                  <p className="text-sm font-medium truncate">
                    {Array.from(files)[0]?.webkitRelativePath?.split('/')[0] ?? 'Selected folder'}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Click to select a folder</p>
                )}
                {files && (
                  <p className="text-xs text-muted-foreground">{files.length} files detected</p>
                )}
              </div>
            </div>
            <input
              ref={folderInputRef}
              type="file"
              {...{ webkitdirectory: '', directory: '' } as any}
              multiple
              className="hidden"
              onChange={handleFolderChange}
            />
          </div>

          {/* scan results */}
          {scanning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Scanning folder…
            </div>
          )}

          {scan && !scanning && (
            <div className="rounded-lg border p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Scan Results
                </p>
                <div className="flex gap-1.5">
                  {scan.videoCount > 0 && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Film className="w-3 h-3" />
                      {scan.videoCount} video
                    </Badge>
                  )}
                  {scan.imageCount > 0 && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Image className="w-3 h-3" />
                      {scan.imageCount} image
                    </Badge>
                  )}
                  {scan.gifCount > 0 && (
                    <Badge variant="outline" className="text-xs gap-1">
                      <Image className="w-3 h-3" />
                      {scan.gifCount} GIF/WebP
                    </Badge>
                  )}
                </div>
              </div>

              {scan.issues.length === 0 ? (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  All files are valid
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  {scan.issues.map((issue, i) => (
                    <div
                      key={i}
                      className={cn(
                        'flex items-start gap-1.5 text-xs rounded px-2 py-1',
                        issue.severity === 'error'
                          ? 'bg-destructive/10 text-destructive'
                          : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
                      )}
                    >
                      {issue.severity === 'error' ? (
                        <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
                      ) : (
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                      )}
                      {issue.message}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <Separator />

          {/* metadata */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-name">Dataset Name *</Label>
            <Input
              id="ds-name"
              placeholder="e.g. training-batch-01"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ds-desc">Description</Label>
            <Textarea
              id="ds-desc"
              placeholder="What is this dataset for?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Target Model</Label>
            <Select value={targetModel} onValueChange={(v) => setTargetModel(v as TargetModel)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LTX">LTX</SelectItem>
                <SelectItem value="WAN">WAN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            Add Dataset
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
