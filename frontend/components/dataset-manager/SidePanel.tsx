'use client';

import { AlertTriangle, XCircle, Info } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SanityIssue } from '@/lib/dataset';

interface SidePanelProps {
  issues: SanityIssue[];
}

const TRANSFORM_OPTIONS = [
  { label: 'Sampling', description: 'Frame sampling rate' },
  { label: 'Autofix', description: 'Auto-correct malformed videos' },
  { label: 'Duration split', description: 'Split clips by duration' },
  { label: 'Frame split (8n+1)', description: 'Ensure frame count is 8n+1' },
  { label: 'Resize buckets', description: 'Resize to 32x × 32y buckets' },
];

export function SidePanel({ issues }: SidePanelProps) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return (
    <div className="w-56 shrink-0 flex flex-col border-r bg-muted/30">
      <ScrollArea className="flex-1">
        {/* Warnings */}
        {issues.length > 0 && (
          <div className="p-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Sanity Checks
            </p>
            <div className="flex flex-col gap-1.5">
              {errors.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
              {warnings.map((issue, i) => (
                <IssueRow key={i} issue={issue} />
              ))}
            </div>
          </div>
        )}

        {issues.length > 0 && <Separator />}

        {/* Transform config */}
        <div className="p-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Video Transform
          </p>
          <p className="text-[11px] text-muted-foreground mb-3">
            Applied to all or selected videos
          </p>
          <div className="flex flex-col gap-1">
            {TRANSFORM_OPTIONS.map((opt) => (
              <button
                key={opt.label}
                className={cn(
                  'flex items-start gap-2 text-left rounded-md px-2 py-1.5 text-xs',
                  'text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors',
                )}
              >
                <Info className="w-3 h-3 mt-0.5 shrink-0 opacity-60" />
                <div>
                  <p className="font-medium text-foreground">{opt.label}</p>
                  <p className="text-[10px] opacity-70">{opt.description}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

function IssueRow({ issue }: { issue: SanityIssue }) {
  const isError = issue.severity === 'error';
  return (
    <div
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]',
        isError ? 'bg-destructive/10 text-destructive' : 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
      )}
    >
      {isError ? (
        <XCircle className="w-3 h-3 mt-0.5 shrink-0" />
      ) : (
        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      )}
      <span className="leading-tight">{issue.message}</span>
    </div>
  );
}
