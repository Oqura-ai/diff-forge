import type { DatasetFile } from './dataset';
import type { TransformConfig } from './model-config';
import {
  startTransformJob,
  pollUntilDone,
  downloadSegment,
  cleanupJob,
  type TransformJob,
} from './backend-client';

interface ProcessOptions {
  file: DatasetFile;
  model: string;
  config: TransformConfig;
  splits?: number[];
  frameDeletions?: number[];
  onProgress?: (pct: number, msg: string) => void;
  signal?: AbortSignal;
}

/**
 * Upload a video to the backend, run the full transform pipeline
 * (frame normalisation + resolution normalisation + optional splits),
 * download the resulting segments, and return them as new DatasetFile objects.
 *
 * The original file's caption is broadcast to every segment.
 * Validation metadata is taken directly from the backend response —
 * no browser-side re-validation needed.
 */
export async function processVideoWithBackend(opts: ProcessOptions): Promise<DatasetFile[]> {
  const { file, model, config, splits, frameDeletions, onProgress, signal } = opts;
  const progress = onProgress ?? (() => {});

  progress(2, 'Uploading…');

  const job = await startTransformJob(file.file, model, {
    resolution: config.resolution,
    frames: config.frames,
    splits: splits && splits.length > 0 ? splits : undefined,
    frame_deletions: frameDeletions && frameDeletions.length > 0 ? frameDeletions : undefined,
    apply_resolution: config.applyResolution !== false,
    apply_frames: config.applyFrames !== false,
  });

  const done: TransformJob = await pollUntilDone(
    job.job_id,
    (j) => progress(j.progress, j.message),
    signal,
  );

  if (!done.segments?.length) {
    throw new Error('Backend returned no segments');
  }

  const totalSegs = done.segments.length;
  const newFiles: DatasetFile[] = [];

  for (const seg of done.segments) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    progress(
      95 + Math.round((seg.index / totalSegs) * 4),
      `Downloading segment ${seg.index + 1}/${totalSegs}…`,
    );

    const blob = await downloadSegment(done.job_id, seg.index);
    const segName = totalSegs > 1 ? `${file.name}_seg${seg.index}` : file.name;
    const processedFile = new File([blob], `${segName}.mp4`, { type: 'video/mp4' });

    newFiles.push({
      id: crypto.randomUUID(),
      name: segName,
      type: 'video',
      file: processedFile,
      caption: file.caption,          // broadcast caption to every segment
      mediaUrl: URL.createObjectURL(blob),
      splits: undefined,
      validation: {
        metadata: {
          width: seg.width,
          height: seg.height,
          frameCount: seg.frame_count,
          durationSecs: seg.duration_secs,
        },
        issues: [],
        isValid: true,
        status: 'validated',
      },
    });
  }

  // Free backend disk space asynchronously — don't block the caller
  cleanupJob(done.job_id).catch(() => {});

  progress(100, `Done — ${totalSegs} segment${totalSegs !== 1 ? 's' : ''}`);
  return newFiles;
}
