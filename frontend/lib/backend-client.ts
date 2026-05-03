const BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8000';

// ─── Types (mirror backend schemas) ──────────────────────────────────────────

export type JobStatus = 'pending' | 'processing' | 'done' | 'failed';

export interface SegmentMeta {
  index: number;
  width: number;
  height: number;
  frame_count: number;
  fps: number;
  duration_secs: number;
  start_secs: number;
  end_secs: number;
  download_url: string;
}

export interface TransformJob {
  job_id: string;
  status: JobStatus;
  progress: number;
  message: string;
  model: string;
  segments?: SegmentMeta[];
}

export interface TransformRequestPayload {
  resolution: { mode: string; width?: number; height?: number };
  frames: { mode: string; target?: number };
  splits?: number[];
  frame_deletions?: number[];  // 0-based output frame indices to remove after normalisation
  apply_resolution?: boolean;
  apply_frames?: boolean;
}

// ─── Low-level API calls ──────────────────────────────────────────────────────

export async function startTransformJob(
  file: File,
  model: string,
  config: TransformRequestPayload,
): Promise<TransformJob> {
  const form = new FormData();
  form.append('file', file);
  form.append('model', model);
  form.append('config', JSON.stringify(config));

  const res = await fetch(`${BASE}/api/v1/transform`, { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(String(err.detail ?? `HTTP ${res.status}`));
  }
  return res.json();
}

export async function getTransformJob(jobId: string): Promise<TransformJob> {
  const res = await fetch(`${BASE}/api/v1/transform/${jobId}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function downloadSegment(jobId: string, segIdx: number): Promise<Blob> {
  const res = await fetch(`${BASE}/api/v1/transform/${jobId}/download/${segIdx}`);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return res.blob();
}

export async function cleanupJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/api/v1/transform/${jobId}`, { method: 'DELETE' });
}

// ─── Polling helper ───────────────────────────────────────────────────────────

export function pollUntilDone(
  jobId: string,
  onUpdate: (job: TransformJob) => void,
  signal?: AbortSignal,
  intervalMs = 800,
): Promise<TransformJob> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
      try {
        const job = await getTransformJob(jobId);
        onUpdate(job);
        if (job.status === 'done') return resolve(job);
        if (job.status === 'failed') return reject(new Error(job.message || 'Job failed'));
        setTimeout(tick, intervalMs);
      } catch (e) {
        reject(e);
      }
    };
    tick();
  });
}
