import type { MediaMetadata } from './dataset';

export type FrameRule = '8n+1' | '4n+1' | 'any';

export interface ResolutionConstraint {
  multiple: number;
  minWidth: number;
  minHeight: number;
  maxWidth?: number;
  maxHeight?: number;
}

export interface FrameConstraint {
  rule: FrameRule;
  min: number;
  max: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  resolution: ResolutionConstraint;
  frames: FrameConstraint;
}

export interface TransformConfig {
  resolution: { mode: 'auto' | 'manual'; width?: number; height?: number };
  frames: { mode: 'auto' | 'strict'; target?: number };
  applyResolution: boolean;
  applyFrames: boolean;
}

export const MODEL_CONFIGS: Record<string, ModelConfig> = {
  LTX: {
    id: 'LTX',
    name: 'LTX Video',
    resolution: { multiple: 32, minWidth: 64, minHeight: 64 },
    frames: { rule: '8n+1', min: 1, max: 257 },
  },
  WAN: {
    id: 'WAN',
    name: 'WAN',
    resolution: { multiple: 32, minWidth: 32, minHeight: 32 },
    frames: { rule: '4n+1', min: 1, max: 600 },
  },
};

export function nearestMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple);
}

export function nearestValid8n1(frames: number): number {
  return Math.max(1, Math.round((frames - 1) / 8)) * 8 + 1;
}

export function nearestValid4n1(frames: number): number {
  return Math.max(1, Math.round((frames - 1) / 4)) * 4 + 1;
}

export function nearestValidFrameCount(frames: number, rule: FrameRule): number {
  if (rule === '8n+1') return nearestValid8n1(frames);
  if (rule === '4n+1') return nearestValid4n1(frames);
  return Math.max(1, frames);
}

export function isValidResolution(w: number, h: number, c: ResolutionConstraint): boolean {
  return (
    w >= c.minWidth &&
    h >= c.minHeight &&
    w % c.multiple === 0 &&
    h % c.multiple === 0 &&
    (c.maxWidth == null || w <= c.maxWidth) &&
    (c.maxHeight == null || h <= c.maxHeight)
  );
}

export function isValidFrameCount(frameCount: number, c: FrameConstraint): boolean {
  if (frameCount < c.min || frameCount > c.max) return false;
  if (c.rule === 'any') return true;
  if (c.rule === '8n+1') return frameCount % 8 === 1;
  if (c.rule === '4n+1') return frameCount % 4 === 1;
  return true;
}

export function computeTransformedMetadata(
  meta: MediaMetadata,
  cfg: TransformConfig,
  model: ModelConfig,
  fileType: 'video' | 'image' | 'gif',
): MediaMetadata {
  let { width, height, frameCount, durationSecs } = meta;

  if (cfg.applyResolution !== false) {
    if (cfg.resolution.mode === 'auto') {
      width = nearestMultiple(width, model.resolution.multiple);
      height = nearestMultiple(height, model.resolution.multiple);
    } else if (cfg.resolution.mode === 'manual') {
      if (cfg.resolution.width) width = cfg.resolution.width;
      if (cfg.resolution.height) height = cfg.resolution.height;
    }
  }

  if (cfg.applyFrames !== false && (fileType === 'video' || fileType === 'gif')) {
    if (cfg.frames.mode === 'auto') {
      frameCount = nearestValidFrameCount(frameCount, model.frames.rule);
    } else if (cfg.frames.mode === 'strict' && cfg.frames.target != null) {
      frameCount = cfg.frames.target;
    }
  }

  return { width, height, frameCount, durationSecs };
}
