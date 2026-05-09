'use client';

import { useState } from 'react';
import { MessageSquare, X, Play, Loader2, Bot, Wand2, Film } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type {
  CaptionProvider, ProviderConfig,
  AzureProviderConfig, OpenAIProviderConfig, GeminiProviderConfig,
  OpenAIModel, GeminiModel,
  FrameSheetConfig, CaptionMode,
} from '@/lib/caption-client';
import { OPENAI_MODELS, GEMINI_MODELS, DEFAULT_FRAME_SHEET } from '@/lib/caption-client';

export interface CaptionConfig {
  systemPrompt: string;
  samplingMode: 'empty-only' | 'override';
  frameSheet: FrameSheetConfig;
}

interface CaptionPanelProps {
  config: CaptionConfig;
  onConfigChange: (cfg: CaptionConfig) => void;
  providerConfig: ProviderConfig | null;
  onProviderConfigChange: (pc: ProviderConfig | null) => void;
  selectedCount: number;
  totalCount: number;
  captionedCount: number;
  generating: boolean;
  mobileOpen: boolean;
  onMobileClose: () => void;
  onPreviewSamples: () => void;
  onGenerateAll: () => void;
  onGenerateSelected: () => void;
}

// ─── Shared sub-controls ─────────────────────────────────────────────────────

function Seg({
  options, value, onChange,
}: { options: { id: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex rounded-md border overflow-hidden text-[11px] h-6">
      {options.map((o) => (
        <button key={o.id} onClick={() => onChange(o.id)}
          className={cn('flex-1 px-2 transition-colors leading-none',
            value === o.id ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-accent text-muted-foreground')}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-[10px] font-medium text-muted-foreground leading-none">{label}</label>
      {children}
    </div>
  );
}

const inputCls = 'h-7 text-xs px-2 w-full min-w-0';
const selectCls =
  'h-7 w-full min-w-0 text-xs px-2 bg-background border border-input rounded-md outline-none ' +
  'focus:ring-1 focus:ring-ring transition-shadow text-foreground cursor-pointer';

// ─── Frame sheet editor (exported for per-item override use) ──────────────────

export function FrameSheetEditor({
  config,
  onChange,
}: {
  config: FrameSheetConfig;
  onChange: (cfg: FrameSheetConfig) => void;
}) {
  const isAllFrames = config.mode === 'all_frames';

  // ── Constraint-enforcing setters ─────────────────────────────────────────
  // Invariant: gridCols * gridRows >= frameCount at all times.
  // Changing cols → snap rows to ceil(frameCount / cols).
  // Changing rows → snap cols to ceil(frameCount / rows).
  // Changing frameCount → bump rows if grid no longer covers all frames.

  const setFrameCount = (v: number) => {
    const fc   = Math.max(1, Math.min(64, v));
    const rows = Math.max(config.gridRows, Math.ceil(fc / config.gridCols));
    onChange({ ...config, frameCount: fc, gridRows: rows });
  };

  const setGridCols = (v: number) => {
    const cols = Math.max(1, v);
    const rows = Math.ceil(config.frameCount / cols);
    onChange({ ...config, gridCols: cols, gridRows: rows });
  };

  const setGridRows = (v: number) => {
    const rows = Math.max(1, v);
    const cols = Math.ceil(config.frameCount / rows);
    onChange({ ...config, gridRows: rows, gridCols: cols });
  };

  const setOpt = <K extends 'frameWidth' | 'frameHeight'>(k: K, raw: string) => {
    const v = raw.trim() === '' ? undefined : Math.max(16, Math.floor(Number(raw)) || 16);
    onChange({ ...config, [k]: v });
  };

  const totalCells = config.gridCols * config.gridRows;
  const emptyPad   = totalCells - config.frameCount;

  return (
    <div className="flex flex-col gap-2.5">
      {/* Captioning mode */}
      <Field label="Mode">
        <Seg
          options={[
            { id: 'first_frame', label: 'First frame' },
            { id: 'all_frames',  label: 'All frames'  },
          ]}
          value={config.mode}
          onChange={v => onChange({ ...config, mode: v as CaptionMode })}
        />
      </Field>

      {isAllFrames && (
        <>
          {/* Frame count */}
          <Field label="Frames to extract">
            <Input
              type="number"
              min={1}
              max={64}
              className={inputCls}
              value={config.frameCount}
              onChange={e => setFrameCount(Math.floor(Number(e.target.value)) || 1)}
            />
          </Field>

          {/* Grid dimensions — always shown; rows/cols mutually constrained */}
          <div className="flex gap-2">
            <Field label="Columns">
              <Input
                type="number"
                min={1}
                max={config.frameCount}
                className={inputCls}
                value={config.gridCols}
                onChange={e => setGridCols(Math.floor(Number(e.target.value)) || 1)}
              />
            </Field>
            <Field label="Rows">
              <Input
                type="number"
                min={Math.ceil(config.frameCount / config.gridCols)}
                className={inputCls}
                value={config.gridRows}
                onChange={e => setGridRows(Math.floor(Number(e.target.value)) || 1)}
              />
            </Field>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            {totalCells} cells · {config.frameCount} frames
            {emptyPad > 0 && <span className="text-muted-foreground/60"> · {emptyPad} white</span>}
          </p>

          {/* Frame dimensions */}
          <div className="flex gap-2">
            <Field label="W px">
              <Input
                type="number"
                min={16}
                className={inputCls}
                placeholder="auto"
                value={config.frameWidth ?? ''}
                onChange={e => setOpt('frameWidth', e.target.value)}
              />
            </Field>
            <Field label="H px">
              <Input
                type="number"
                min={16}
                className={inputCls}
                placeholder="auto"
                value={config.frameHeight ?? ''}
                onChange={e => setOpt('frameHeight', e.target.value)}
              />
            </Field>
          </div>
          <p className="text-[10px] text-muted-foreground leading-tight">
            Leave W/H blank to auto-size each frame.
          </p>
        </>
      )}
    </div>
  );
}

// ─── Provider config forms ────────────────────────────────────────────────────

function AzureForm({ cfg, onChange }: { cfg: AzureProviderConfig; onChange: (c: AzureProviderConfig) => void }) {
  const set = (k: keyof AzureProviderConfig, v: string) => onChange({ ...cfg, [k]: v });
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <Field label="Endpoint">
        <Input
          className={inputCls}
          placeholder="https://your-resource.openai.azure.com/"
          value={cfg.endpoint}
          onChange={e => set('endpoint', e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Deployment name">
        <Input
          className={inputCls}
          placeholder="gpt-4o-mini"
          value={cfg.deployment}
          onChange={e => set('deployment', e.target.value)}
          autoComplete="off"
        />
      </Field>
      <Field label="Subscription key">
        <Input
          className={cn(inputCls, 'font-mono tracking-widest')}
          type="password"
          placeholder="Enter your key"
          value={cfg.subscriptionKey}
          onChange={e => set('subscriptionKey', e.target.value)}
          autoComplete="new-password"
        />
      </Field>
      <Field label="API version">
        <Input
          className={inputCls}
          placeholder="2024-12-01-preview"
          value={cfg.apiVersion}
          onChange={e => set('apiVersion', e.target.value)}
        />
      </Field>
    </div>
  );
}

function OpenAIForm({ cfg, onChange }: { cfg: OpenAIProviderConfig; onChange: (c: OpenAIProviderConfig) => void }) {
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <Field label="API key">
        <Input
          className={cn(inputCls, 'font-mono tracking-widest')}
          type="password"
          placeholder="sk-…"
          value={cfg.apiKey}
          onChange={e => onChange({ ...cfg, apiKey: e.target.value })}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Model">
        <select
          className={selectCls}
          value={cfg.model}
          onChange={e => onChange({ ...cfg, model: e.target.value as OpenAIModel })}
        >
          {OPENAI_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function GeminiForm({ cfg, onChange }: { cfg: GeminiProviderConfig; onChange: (c: GeminiProviderConfig) => void }) {
  return (
    <div className="flex flex-col gap-2.5 mt-2">
      <Field label="API key">
        <Input
          className={cn(inputCls, 'font-mono tracking-widest')}
          type="password"
          placeholder="AIza…"
          value={cfg.apiKey}
          onChange={e => onChange({ ...cfg, apiKey: e.target.value })}
          autoComplete="new-password"
        />
      </Field>
      <Field label="Model">
        <select
          className={selectCls}
          value={cfg.model}
          onChange={e => onChange({ ...cfg, model: e.target.value as GeminiModel })}
        >
          {GEMINI_MODELS.map(m => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </Field>
    </div>
  );
}

// ─── Default configs ──────────────────────────────────────────────────────────

const DEFAULT_AZURE:  AzureProviderConfig  = { endpoint: '', deployment: '', subscriptionKey: '', apiVersion: '2024-12-01-preview' };
const DEFAULT_OPENAI: OpenAIProviderConfig = { apiKey: '', model: 'gpt-4o' };
const DEFAULT_GEMINI: GeminiProviderConfig = { apiKey: '', model: 'gemini-2.5-flash' };

// ─── Panel ────────────────────────────────────────────────────────────────────

export function CaptionPanel({
  config, onConfigChange,
  providerConfig, onProviderConfigChange,
  selectedCount, totalCount, captionedCount,
  generating,
  mobileOpen, onMobileClose,
  onPreviewSamples, onGenerateAll, onGenerateSelected,
}: CaptionPanelProps) {
  const [localProvider, setLocalProvider] = useState<CaptionProvider>(
    providerConfig?.provider ?? 'openai',
  );

  const canGenerate = !generating && totalCount > 0 && isConfigured(providerConfig);
  const uncaptioned = totalCount - captionedCount;

  const handleProviderSwitch = (p: CaptionProvider) => {
    setLocalProvider(p);
    if (p === 'azure')  onProviderConfigChange({ provider: 'azure',  azure:  DEFAULT_AZURE  });
    if (p === 'openai') onProviderConfigChange({ provider: 'openai', openai: DEFAULT_OPENAI });
    if (p === 'gemini') onProviderConfigChange({ provider: 'gemini', gemini: DEFAULT_GEMINI });
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onMobileClose} />
      )}
      <div className={cn(
        'flex flex-col border-r bg-muted/20 z-40 transition-transform duration-200 overflow-y-scroll',
        'fixed inset-y-0 left-0 w-80 md:relative md:w-64 md:shrink-0 md:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex items-center justify-between h-11 px-3 border-b md:hidden">
          <span className="text-sm font-semibold">Caption Settings</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onMobileClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <ScrollArea className="flex-1 min-w-0">
          <div className="flex flex-col gap-0 min-w-0">

            {/* ── Coverage summary ── */}
            <div className="p-3 pb-2">
              <div className="rounded-lg border px-2.5 py-2 flex flex-col gap-1 bg-muted/30">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Captioned</span>
                  <span className="font-mono font-medium text-emerald-500">{captionedCount}</span>
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-muted-foreground">Missing</span>
                  <span className={cn('font-mono font-medium', uncaptioned > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
                    {uncaptioned}
                  </span>
                </div>
                {totalCount > 0 && (
                  <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${(captionedCount / totalCount) * 100}%` }} />
                  </div>
                )}
              </div>
            </div>

            <Separator />

            {/* ── Provider ── */}
            <Section label="Provider" icon={<Bot className="w-3 h-3" />}>
              <Seg
                options={[{ id: 'azure', label: 'Azure' }, { id: 'openai', label: 'OpenAI' }, { id: 'gemini', label: 'Gemini' }]}
                value={localProvider}
                onChange={v => handleProviderSwitch(v as CaptionProvider)}
              />

              {localProvider === 'azure' && (
                <AzureForm
                  cfg={providerConfig?.azure ?? DEFAULT_AZURE}
                  onChange={c => onProviderConfigChange({ provider: 'azure', azure: c })}
                />
              )}
              {localProvider === 'openai' && (
                <OpenAIForm
                  cfg={providerConfig?.openai ?? DEFAULT_OPENAI}
                  onChange={c => onProviderConfigChange({ provider: 'openai', openai: c })}
                />
              )}
              {localProvider === 'gemini' && (
                <GeminiForm
                  cfg={providerConfig?.gemini ?? DEFAULT_GEMINI}
                  onChange={c => onProviderConfigChange({ provider: 'gemini', gemini: c })}
                />
              )}

              {!isConfigured(providerConfig) && (
                <p className="text-[10px] text-amber-400 mt-1.5 leading-tight">
                  Fill in the credentials above to enable generation.
                </p>
              )}
            </Section>

            <Separator />

            {/* ── System Prompt ── */}
            <Section label="System Prompt" icon={<MessageSquare className="w-3 h-3" />}>
              <Textarea
                placeholder="Describe what you want the model to focus on — style, scene, characters, motion…"
                value={config.systemPrompt}
                onChange={e => onConfigChange({ ...config, systemPrompt: e.target.value })}
                className="resize-none text-xs h-24 leading-relaxed"
              />
            </Section>

            <Separator />

            {/* ── Frame Ingestion ── */}
            <Section label="Frame Ingestion" icon={<Film className="w-3 h-3" />}>
              <FrameSheetEditor
                config={config.frameSheet}
                onChange={fs => onConfigChange({ ...config, frameSheet: fs })}
              />
            </Section>

            <Separator />

            {/* ── Sampling ── */}
            <Section label="Sampling">
              <Seg
                options={[{ id: 'empty-only', label: 'Empty only' }, { id: 'override', label: 'Override' }]}
                value={config.samplingMode}
                onChange={v => onConfigChange({ ...config, samplingMode: v as CaptionConfig['samplingMode'] })}
              />
              <p className="text-[11px] text-muted-foreground mt-1.5 leading-tight">
                {config.samplingMode === 'empty-only'
                  ? `Skip already-captioned items (${captionedCount} will be skipped)`
                  : 'Replace all captions including existing ones'}
              </p>
            </Section>

            <Separator />

            {/* ── Generate ── */}
            <Section label="Generate Captions">
              <div className="flex flex-col gap-1.5">
                {generating && (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Generating…
                  </div>
                )}

                {selectedCount === 0 ? (
                  <>
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 w-full"
                      disabled={!canGenerate} onClick={onPreviewSamples}>
                      <Wand2 className="w-3.5 h-3.5" />
                      Preview 5 samples
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 w-full"
                      disabled={!canGenerate} onClick={onGenerateAll}>
                      <Play className="w-3.5 h-3.5" />
                      Generate for all {totalCount}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" variant="default" className="h-7 text-xs gap-1.5 w-full"
                      disabled={!canGenerate} onClick={onGenerateSelected}>
                      <Play className="w-3.5 h-3.5" />
                      Generate for {selectedCount} selected
                    </Button>
                    <p className="text-[10px] text-muted-foreground text-center leading-tight">
                      Applies only to selected items
                    </p>
                  </>
                )}
              </div>
            </Section>
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isConfigured(pc: ProviderConfig | null): boolean {
  if (!pc) return false;
  if (pc.provider === 'azure')  return !!(pc.azure?.endpoint && pc.azure?.deployment && pc.azure?.subscriptionKey);
  if (pc.provider === 'openai') return !!pc.openai?.apiKey;
  if (pc.provider === 'gemini') return !!pc.gemini?.apiKey;
  return false;
}

function Section({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="p-3 min-w-0">
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-muted-foreground shrink-0">{icon}</span>}
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate">{label}</p>
      </div>
      <div className="min-w-0">
        {children}
      </div>
    </div>
  );
}
