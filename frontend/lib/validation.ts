import type { DatasetFile, MediaMetadata, ValidationResult } from './dataset';
import type { ModelConfig } from './model-config';
import { isValidFrameCount } from './model-config';

// Count GIF frames by scanning for Graphic Control Extension blocks (0x21 0xF9)
async function countGifFrames(file: File): Promise<number> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let count = 0;
    for (let i = 0; i < bytes.length - 1; i++) {
      if (bytes[i] === 0x21 && bytes[i + 1] === 0xF9) count++;
    }
    return Math.max(1, count);
  } catch {
    return 1;
  }
}

async function countWebPFrames(file: File): Promise<number> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    if (bytes.length < 12) return 1;
    const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
    const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (riff !== 'RIFF' || webp !== 'WEBP') return 1;
    let count = 0;
    let i = 12;
    while (i + 8 <= bytes.length) {
      const tag = String.fromCharCode(bytes[i], bytes[i+1], bytes[i+2], bytes[i+3]);
      const size = bytes[i+4] | (bytes[i+5] << 8) | (bytes[i+6] << 16) | (bytes[i+7] << 24);
      if (tag === 'ANMF') count++;
      i += 8 + size + (size & 1);
    }
    return count > 0 ? count : 1;
  } catch {
    return 1;
  }
}

async function extractMediaMetadata(file: DatasetFile): Promise<MediaMetadata> {
  return new Promise((resolve) => {
    if (file.type === 'image') {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, frameCount: 1 });
      img.onerror = () => resolve({ width: 0, height: 0, frameCount: 1 });
      img.src = file.mediaUrl;
    } else if (file.type === 'gif') {
      const img = new Image();
      img.onload = async () => {
        const ext = file.file.name.split('.').pop()?.toLowerCase();
        const frameCount = ext === 'webp'
          ? await countWebPFrames(file.file)
          : await countGifFrames(file.file);
        resolve({ width: img.naturalWidth, height: img.naturalHeight, frameCount });
      };
      img.onerror = () => resolve({ width: 0, height: 0, frameCount: 1 });
      img.src = file.mediaUrl;
    } else {
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        const frameCount = Math.max(1, Math.round(video.duration * 30));
        resolve({ width: video.videoWidth, height: video.videoHeight, frameCount, durationSecs: video.duration });
      };
      video.onerror = () => resolve({ width: 0, height: 0, frameCount: 0 });
      video.preload = 'metadata';
      video.src = file.mediaUrl;
    }
  });
}

export async function validateDatasetFile(
  file: DatasetFile,
  model: ModelConfig,
): Promise<ValidationResult> {
  try {
    const metadata = await extractMediaMetadata(file);
    const issues = [];

    if (metadata.width > 0) {
      if (metadata.width % model.resolution.multiple !== 0)
        issues.push({ type: 'resolution_width' as const, message: `Width ${metadata.width}px — not ×${model.resolution.multiple}` });
      if (metadata.height % model.resolution.multiple !== 0)
        issues.push({ type: 'resolution_height' as const, message: `Height ${metadata.height}px — not ×${model.resolution.multiple}` });
    }

    // Frame count rules apply to videos and animated GIFs/WebP
    if ((file.type === 'video' || file.type === 'gif') && model.frames.rule !== 'any' && !isValidFrameCount(metadata.frameCount, model.frames)) {
      issues.push({ type: 'frame_count' as const, message: `~${metadata.frameCount} frames — not ${model.frames.rule}` });
    }

    return { metadata, issues, isValid: issues.length === 0, status: 'validated' };
  } catch {
    return {
      metadata: { width: 0, height: 0, frameCount: 0 },
      issues: [{ type: 'load_error' as const, message: 'Could not read file metadata' }],
      isValid: false,
      status: 'error',
    };
  }
}
