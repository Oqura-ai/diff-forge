import type { Dataset } from './dataset';

interface MetadataEntry {
  media_path: string;
  width: number;
  height: number;
  num_frames: number;
  resolution: number;
  bgcolor?: string;
  caption: string | null;
}

/**
 * Export a dataset as a ZIP archive containing:
 *   - All media files renamed to  0001_original.mp4, 0002_…
 *   - metadata.json  with LTX training fields
 *
 * If triggerWord is set, it is prepended to every non-null caption:
 *   "TOKEN, original caption text…"
 */
export async function exportDatasetAsZip(
  dataset: Dataset,
  options: { triggerWord?: string } = {},
  onProgress?: (completed: number, total: number) => void,
): Promise<void> {
  // Dynamic import keeps JSZip out of the initial bundle and avoids SSR issues
  const { default: JSZip } = await import('jszip');
  const zip  = new JSZip();
  const meta: MetadataEntry[] = [];
  const total  = dataset.files.length;
  const token  = options.triggerWord?.trim() ?? '';

  for (let i = 0; i < total; i++) {
    const file = dataset.files[i];
    onProgress?.(i, total);

    // Zero-padded sequential name to keep lexicographic order
    const idx      = String(i + 1).padStart(4, '0');
    const safeName = file.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filename = `${idx}_${safeName}`;

    // Add raw binary — use STORE (no recompression) since media is already compressed
    const data = await file.file.arrayBuffer();
    zip.file(filename, data, { compression: 'STORE' });

    // Caption: prepend trigger word if present
    let caption = file.caption;
    if (caption !== null && token) {
      caption = `${token}, ${caption}`;
    }

    // Sidecar .txt with the same base name (e.g. 0001_sprite.txt)
    const txtName = filename.replace(/\.[^.]+$/, '.txt');
    zip.file(txtName, caption ?? '');

    const m = file.validation?.metadata;
    meta.push({
      media_path: `./${filename}`,
      width:      m?.width      ?? 0,
      height:     m?.height     ?? 0,
      num_frames: m?.frameCount ?? 0,
      resolution: m ? Math.max(m.width, m.height) : 0,
      caption,
    });
  }

  onProgress?.(total, total);

  // metadata.json — pretty-printed, two-space indent
  zip.file('metadata.json', JSON.stringify(meta, null, 2));

  // Generate the archive
  const blob = await zip.generateAsync({
    type:               'blob',
    compression:        'STORE',
    streamFiles:        true,
  });

  // Trigger browser download
  const url = URL.createObjectURL(blob);
  const a   = Object.assign(document.createElement('a'), {
    href:     url,
    download: `${dataset.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.zip`,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
