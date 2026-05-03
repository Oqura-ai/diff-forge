import type { DatasetFile, MediaMetadata } from './dataset';
import type { ModelConfig, TransformConfig } from './model-config';
import { computeTransformedMetadata, isValidResolution, isValidFrameCount } from './model-config';

export interface TransformPreviewItem {
  fileId: string;
  fileName: string;
  fileType: 'video' | 'image' | 'gif';
  mediaUrl: string;
  caption: string | null;
  before: MediaMetadata;
  after: MediaMetadata;
  changes: string[];
  willBeValid: boolean;
}

export async function previewTransform(
  items: Array<{ file: DatasetFile; metadata: MediaMetadata }>,
  transformConfig: TransformConfig,
  modelConfig: ModelConfig,
): Promise<TransformPreviewItem[]> {
  await new Promise((r) => setTimeout(r, 650));

  return items.map(({ file, metadata }) => {
    const after = computeTransformedMetadata(metadata, transformConfig, modelConfig, file.type);

    const changes: string[] = [];
    if (after.width !== metadata.width) changes.push(`W: ${metadata.width}→${after.width}px`);
    if (after.height !== metadata.height) changes.push(`H: ${metadata.height}→${after.height}px`);
    if ((file.type === 'video' || file.type === 'gif') && after.frameCount !== metadata.frameCount)
      changes.push(`Frames: ~${metadata.frameCount}→${after.frameCount}`);
    if (changes.length === 0) changes.push('No changes needed');

    const resValid = isValidResolution(after.width, after.height, modelConfig.resolution);
    const frameValid = (file.type !== 'video' && file.type !== 'gif') || isValidFrameCount(after.frameCount, modelConfig.frames);

    return {
      fileId: file.id,
      fileName: file.name,
      fileType: file.type,
      mediaUrl: file.mediaUrl,
      caption: file.caption,
      before: metadata,
      after,
      changes,
      willBeValid: resValid && frameValid,
    };
  });
}
