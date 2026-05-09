const BASE =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_API_URL) ||
  'http://localhost:8000';

// ─── Provider config types ────────────────────────────────────────────────────

export type CaptionProvider = 'azure' | 'openai' | 'gemini';

export interface AzureProviderConfig {
  endpoint: string;
  deployment: string;
  subscriptionKey: string;
  apiVersion: string;
}

export type OpenAIModel = 'gpt-4o' | 'gpt-4.1' | 'gpt-4.1-mini';
export interface OpenAIProviderConfig {
  apiKey: string;
  model: OpenAIModel;
}

export type GeminiModel = 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'gemini-2.0-flash';
export interface GeminiProviderConfig {
  apiKey: string;
  model: GeminiModel;
}

export interface ProviderConfig {
  provider: CaptionProvider;
  azure?: AzureProviderConfig;
  openai?: OpenAIProviderConfig;
  gemini?: GeminiProviderConfig;
}

// ─── Frame sheet config types ─────────────────────────────────────────────────

export type CaptionMode = 'first_frame' | 'all_frames';

export interface FrameSheetConfig {
  mode: CaptionMode;
  frameCount: number;
  gridCols: number;   // always set; cols * rows must be >= frameCount
  gridRows: number;   // always set; auto-enforced by UI
  frameWidth?: number;
  frameHeight?: number;
}

export const DEFAULT_FRAME_SHEET: FrameSheetConfig = {
  mode: 'all_frames',
  frameCount: 8,
  gridCols: 3,  // 3×3 = 9 cells, 1 white padding for 8 frames
  gridRows: 3,
};

// ─── API call ─────────────────────────────────────────────────────────────────

export async function generateCaption(
  file: File,
  providerConfig: ProviderConfig,
  systemPrompt: string,
  frameSheetConfig?: FrameSheetConfig,
): Promise<string> {
  const configPayload: Record<string, unknown> = {
    provider: providerConfig.provider,
    system_prompt: systemPrompt,
    ...(providerConfig.azure && {
      azure_config: {
        endpoint:         providerConfig.azure.endpoint,
        deployment:       providerConfig.azure.deployment,
        subscription_key: providerConfig.azure.subscriptionKey,
        api_version:      providerConfig.azure.apiVersion,
      },
    }),
    ...(providerConfig.openai && {
      openai_config: {
        api_key: providerConfig.openai.apiKey,
        model:   providerConfig.openai.model,
      },
    }),
    ...(providerConfig.gemini && {
      gemini_config: {
        api_key: providerConfig.gemini.apiKey,
        model:   providerConfig.gemini.model,
      },
    }),
  };

  if (frameSheetConfig) {
    configPayload.frame_sheet = {
      mode:         frameSheetConfig.mode,
      frame_count:  frameSheetConfig.frameCount,
      grid_cols:    frameSheetConfig.gridCols,
      grid_rows:    frameSheetConfig.gridRows,
      frame_width:  frameSheetConfig.frameWidth,
      frame_height: frameSheetConfig.frameHeight,
    };
  }

  const form = new FormData();
  form.append('file', file);
  form.append('config', JSON.stringify(configPayload));

  const res = await fetch(`${BASE}/api/v1/caption`, { method: 'POST', body: form });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(String(err.detail ?? `HTTP ${res.status}`));
  }

  const data = await res.json();
  return data.caption as string;
}

// ─── Model option lists ───────────────────────────────────────────────────────

export const OPENAI_MODELS: { id: OpenAIModel; label: string }[] = [
  { id: 'gpt-4o',        label: 'GPT-4o'        },
  { id: 'gpt-4.1',       label: 'GPT-4.1'       },
  { id: 'gpt-4.1-mini',  label: 'GPT-4.1 mini'  },
];

export const GEMINI_MODELS: { id: GeminiModel; label: string }[] = [
  { id: 'gemini-2.5-pro',   label: 'Gemini 2.5 Pro'   },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash'  },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash'  },
];
