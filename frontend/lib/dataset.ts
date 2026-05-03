export type TargetModel = 'LTX' | 'WAN';
export type MediaType = 'video' | 'image' | 'gif';

export const SUPPORTED_VIDEO_EXTS = new Set(['mp4']);
export const SUPPORTED_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'png']);
export const SUPPORTED_GIF_EXTS = new Set(['gif', 'webp']);

// ─── Validation types ────────────────────────────────────────────────────────

export interface ValidationIssue {
  type: 'resolution_width' | 'resolution_height' | 'frame_count' | 'load_error';
  message: string;
}

export interface MediaMetadata {
  width: number;
  height: number;
  frameCount: number;
  durationSecs?: number;
}

export interface ValidationResult {
  metadata: MediaMetadata;
  issues: ValidationIssue[];
  isValid: boolean;
  status: 'pending' | 'validated' | 'error';
}

// ─── Dataset types ────────────────────────────────────────────────────────────

export interface DatasetFile {
  id: string;
  name: string;
  type: MediaType;
  file: File;
  caption: string | null;
  mediaUrl: string;
  validation?: ValidationResult;
  splits?: number[]; // split time-points in seconds (video only)
}

export interface SanityIssue {
  severity: 'error' | 'warning';
  type: 'orphan_txt' | 'unsupported_file' | 'empty_dataset';
  fileName: string;
  message: string;
}

export interface Dataset {
  id: string;
  name: string;
  description: string;
  targetModel: TargetModel;
  files: DatasetFile[];
  issues: SanityIssue[];
  createdAt: Date;
  triggerWord?: string;  // optional token prepended to all captions on export
}

// ─── Upload processing ────────────────────────────────────────────────────────

function getBaseName(file: File): { base: string; ext: string } {
  const fileName = file.name.includes('/') ? file.name.split('/').pop()! : file.name;
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) return { base: fileName, ext: '' };
  return { base: fileName.slice(0, dot), ext: fileName.slice(dot + 1).toLowerCase() };
}

export async function processUploadedFolder(files: FileList): Promise<{
  datasetFiles: DatasetFile[];
  issues: SanityIssue[];
}> {
  const fileArray = Array.from(files);

  const videoMap = new Map<string, File>();
  const imageMap = new Map<string, File>();
  const gifMap = new Map<string, File>();
  const txtMap = new Map<string, File>();
  const unsupported: string[] = [];

  for (const file of fileArray) {
    const { base, ext } = getBaseName(file);
    if (SUPPORTED_VIDEO_EXTS.has(ext)) videoMap.set(base, file);
    else if (SUPPORTED_IMAGE_EXTS.has(ext)) imageMap.set(base, file);
    else if (SUPPORTED_GIF_EXTS.has(ext)) gifMap.set(base, file);
    else if (ext === 'txt') txtMap.set(base, file);
    else unsupported.push(file.name.includes('/') ? file.name.split('/').pop()! : file.name);
  }

  const issues: SanityIssue[] = [];

  for (const fileName of unsupported) {
    issues.push({ severity: 'error', type: 'unsupported_file', fileName, message: `Unsupported file type: "${fileName}"` });
  }

  for (const [base] of txtMap) {
    if (!videoMap.has(base) && !imageMap.has(base) && !gifMap.has(base)) {
      issues.push({ severity: 'warning', type: 'orphan_txt', fileName: `${base}.txt`, message: `Orphan caption — no matching media: "${base}.txt"` });
    }
  }

  if (videoMap.size === 0 && imageMap.size === 0 && gifMap.size === 0) {
    issues.push({ severity: 'error', type: 'empty_dataset', fileName: '', message: 'No supported media files found (MP4, JPG, PNG, GIF, WebP).' });
    return { datasetFiles: [], issues };
  }

  const readCaption = async (base: string): Promise<string | null> => {
    const f = txtMap.get(base);
    if (!f) return null;
    const raw = await f.text();
    return raw.trim() || null;
  };

  const datasetFiles: DatasetFile[] = [];

  for (const [base, file] of videoMap) {
    datasetFiles.push({ id: `${base}-${crypto.randomUUID()}`, name: base, type: 'video', file, caption: await readCaption(base), mediaUrl: URL.createObjectURL(file) });
  }

  for (const [base, file] of imageMap) {
    datasetFiles.push({ id: `${base}-${crypto.randomUUID()}`, name: base, type: 'image', file, caption: await readCaption(base), mediaUrl: URL.createObjectURL(file) });
  }

  for (const [base, file] of gifMap) {
    datasetFiles.push({ id: `${base}-${crypto.randomUUID()}`, name: base, type: 'gif', file, caption: await readCaption(base), mediaUrl: URL.createObjectURL(file) });
  }

  datasetFiles.sort((a, b) => a.name.localeCompare(b.name));
  return { datasetFiles, issues };
}
