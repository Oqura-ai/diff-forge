'use client';

import { useState, useEffect, useRef } from 'react';
import { Plus, AlertCircle, CheckCircle2, Loader2, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Dataset } from '@/lib/dataset';

interface SidebarProps {
  datasets: Dataset[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDeleteDataset: (datasetId: string) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
}

export function Sidebar({
  datasets, selectedId, onSelect, onNew, onDeleteDataset, mobileOpen, onMobileClose,
}: SidebarProps) {
  // Two-step delete: first click arms, second click confirms.
  // Auto-disarms after 3 s if the user doesn't follow through.
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setPendingDeleteId(id);
    timerRef.current = setTimeout(() => setPendingDeleteId(null), 3000);
  };

  const confirmDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setPendingDeleteId(null);
    onDeleteDataset(id);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (timerRef.current) clearTimeout(timerRef.current);
    setPendingDeleteId(null);
  };

  // Disarm if the dataset disappears from the list
  useEffect(() => {
    if (pendingDeleteId && !datasets.find(d => d.id === pendingDeleteId)) {
      setPendingDeleteId(null);
    }
  }, [datasets, pendingDeleteId]);

  const handleSelect = (id: string) => {
    setPendingDeleteId(null);
    onSelect(id);
    onMobileClose();
  };

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={onMobileClose} />
      )}

      <aside className={cn(
        'flex flex-col border-r bg-sidebar z-40 transition-transform duration-200',
        'fixed inset-y-0 left-0 w-60 md:relative md:w-48',
        mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
      )}>
        {/* Mobile header */}
        <div className="flex items-center justify-between h-11 px-3 border-b md:hidden">
          <span className="text-sm font-semibold">Datasets</span>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onMobileClose}>
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-2 border-b">
          <Button onClick={onNew} variant="outline" className="w-full gap-2 text-sm justify-start">
            <Plus className="w-4 h-4" />
            New Dataset
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 flex flex-col gap-1">
            {datasets.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-6 px-2 leading-relaxed">
                No datasets yet. Click &quot;New Dataset&quot; to get started.
              </p>
            )}

            {datasets.map((ds) => {
              const isSelected    = selectedId === ds.id;
              const isPending     = pendingDeleteId === ds.id;
              const validated     = ds.files.filter(f => f.validation?.status === 'validated');
              const validating    = ds.files.some(f => !f.validation) && ds.files.length > 0;
              const hasErrors     = ds.issues.some(i => i.severity === 'error');
              const invalidCount  = validated.filter(f => !f.validation!.isValid).length;
              const allValid      = validated.length > 0 && invalidCount === 0 && validated.length === ds.files.length;

              return (
                <div key={ds.id} className="relative group">
                  <button
                    onClick={() => !isPending && handleSelect(ds.id)}
                    className={cn(
                      'w-full text-left rounded-md px-2.5 py-2 text-sm transition-colors pr-7',
                      'flex items-start justify-between gap-1.5',
                      isPending
                        ? 'bg-destructive/10 border border-destructive/40'
                        : isSelected
                          ? 'bg-primary text-primary-foreground'
                          : 'hover:bg-accent hover:text-accent-foreground text-sidebar-foreground',
                    )}
                  >
                    <div className="flex flex-col min-w-0">
                      <span className={cn(
                        'truncate font-medium text-xs leading-4',
                        isPending && 'text-destructive',
                      )}>
                        {ds.name}
                      </span>
                      <span className={cn(
                        'text-[10px]',
                        isPending ? 'text-destructive/70'
                          : isSelected ? 'text-primary-foreground/70'
                          : 'text-muted-foreground',
                      )}>
                        {ds.files.length} files · {ds.targetModel}
                      </span>
                    </div>

                    {/* Status icon — hidden when delete is pending */}
                    {!isPending && (
                      <div className="shrink-0 mt-0.5">
                        {validating
                          ? <Loader2 className={cn('w-3 h-3 animate-spin', isSelected ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
                          : hasErrors || invalidCount > 0
                            ? <AlertCircle className={cn('w-3 h-3', isSelected ? 'text-primary-foreground/70' : 'text-destructive')} />
                            : allValid
                              ? <CheckCircle2 className={cn('w-3 h-3', isSelected ? 'text-primary-foreground/70' : 'text-emerald-500')} />
                              : null}
                      </div>
                    )}
                  </button>

                  {/* ── Delete control ────────────────────────────── */}
                  {isPending ? (
                    /* Confirmation row */
                    <div className="absolute inset-y-0 right-1 flex items-center gap-0.5">
                      {/* Cancel */}
                      <button
                        onClick={cancelDelete}
                        title="Cancel"
                        className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <X className="w-3 h-3" />
                      </button>
                      {/* Confirm */}
                      <button
                        onClick={e => confirmDelete(e, ds.id)}
                        title="Confirm delete"
                        className="h-5 w-5 flex items-center justify-center rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    /* Trash icon — appears on hover */
                    <button
                      onClick={e => armDelete(e, ds.id)}
                      title="Delete dataset"
                      className={cn(
                        'absolute right-1 top-1/2 -translate-y-1/2',
                        'h-5 w-5 flex items-center justify-center rounded',
                        'opacity-0 group-hover:opacity-100 transition-opacity',
                        'text-muted-foreground hover:text-destructive hover:bg-destructive/10',
                      )}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}

                  {/* "Confirm?" label shown below when armed */}
                  {isPending && (
                    <div className="px-2.5 pb-1.5 -mt-0.5">
                      <p className="text-[10px] text-destructive font-medium">Delete permanently?</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </aside>
    </>
  );
}
