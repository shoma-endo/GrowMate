'use client';

import React, { useMemo, useState, useCallback, useEffect, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Settings, GripVertical } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useDragReorder } from '@/hooks/useDragReorder';

interface ColumnOption {
  id: string;
  label: string;
  defaultVisible?: boolean;
}

interface FieldConfigRenderProps {
  visibleSet: Set<string>;
  orderedIds: string[];
}

type StoredConfig =
  | string[]
  | {
      visible?: string[];
      order?: string[];
    };

interface FieldConfiguratorProps {
  columns: ColumnOption[];
  storageKey: string;
  onChange?: (visibleIds: string[], orderedIds: string[]) => void;
  children: (config: FieldConfigRenderProps) => ReactNode;
  hideTrigger?: boolean;
  triggerId?: string;
  dialogExtraContent?: ReactNode;
}

export default function FieldConfigurator({
  columns,
  storageKey,
  onChange,
  children,
  hideTrigger,
  triggerId,
  dialogExtraContent,
}: FieldConfiguratorProps) {
  const defaultVisibleIds = useMemo(
    () => columns.filter(c => c.defaultVisible !== false).map(c => c.id),
    [columns]
  );
  const defaultOrder = useMemo(() => columns.map(c => c.id), [columns]);

  const [open, setOpen] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>(defaultVisibleIds);
  const [orderedIds, setOrderedIds] = useState<string[]>(defaultOrder);

  const normalizeOrder = useCallback(
    (order: string[]) => {
      const knownIds = columns.map(c => c.id);
      const filtered = order.filter(id => knownIds.includes(id));
      const missing = knownIds.filter(id => !filtered.includes(id));
      return [...filtered, ...missing];
    },
    [columns]
  );

  const persistConfig = useCallback(
    (nextVisible: string[], nextOrder: string[]) => {
      localStorage.setItem(storageKey, JSON.stringify({ visible: nextVisible, order: nextOrder }));
    },
    [storageKey]
  );

  const applyConfig = useCallback(
    (nextVisible: string[], nextOrder: string[], shouldPersist = false) => {
      const normalizedVisible = nextVisible.filter(id => columns.some(c => c.id === id));
      const normalizedOrder = normalizeOrder(nextOrder);
      setVisibleIds(normalizedVisible);
      setOrderedIds(normalizedOrder);
      onChange?.(normalizedVisible, normalizedOrder);
      if (shouldPersist) {
        persistConfig(normalizedVisible, normalizedOrder);
      }
    },
    [columns, normalizeOrder, onChange, persistConfig]
  );

  const mergeNewDefaultVisibleColumns = useCallback(
    (visible: string[], order: string[]) => {
      const visibleSet = new Set(visible);
      const orderSet = new Set(order);
      const newlyAddedDefaultVisibleIds = defaultVisibleIds.filter(
        id => !visibleSet.has(id) && !orderSet.has(id)
      );
      if (newlyAddedDefaultVisibleIds.length === 0) {
        return visible;
      }
      return [...visible, ...newlyAddedDefaultVisibleIds];
    },
    [defaultVisibleIds]
  );

  useEffect(() => {
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as StoredConfig;

        // 旧フォーマット（string配列）との互換性維持
        if (Array.isArray(parsed)) {
          const normalizedVisible = parsed.filter(id => columns.some(c => c.id === id));
          if (normalizedVisible.length > 0) {
            const mergedVisible = mergeNewDefaultVisibleColumns(normalizedVisible, defaultOrder);
            applyConfig(mergedVisible, defaultOrder, true);
            return;
          }
        }

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const visible = Array.isArray(parsed.visible) ? parsed.visible : defaultVisibleIds;
          const order = Array.isArray(parsed.order) ? parsed.order : defaultOrder;
          const mergedVisible = mergeNewDefaultVisibleColumns(visible, order);
          applyConfig(mergedVisible, order, true);
          return;
        }
      }
      applyConfig(defaultVisibleIds, defaultOrder, true);
    } catch {
      applyConfig(defaultVisibleIds, defaultOrder, true);
    }
  }, [
    applyConfig,
    columns,
    defaultOrder,
    defaultVisibleIds,
    mergeNewDefaultVisibleColumns,
    storageKey,
  ]);

  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  // 外部ボタン（triggerId）から開くためのリスナー
  useEffect(() => {
    if (!triggerId) return;
    if (typeof window === 'undefined') return;
    const el = document.getElementById(triggerId);
    if (!el) return;
    const onClick = (e: Event) => {
      e.preventDefault();
      setOpen(true);
    };
    el.addEventListener('click', onClick);
    return () => {
      el.removeEventListener('click', onClick);
    };
  }, [triggerId]);

  const toggle = (id: string) => {
    setVisibleIds(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      persistConfig(next, orderedIds);
      onChange?.(next, orderedIds);
      return next;
    });
  };

  // ドラッグ＆ドロップによる並び替え
  const { draggedId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder({
    items: orderedIds,
    getId: id => id,
    onReorder: nextOrder => {
      setOrderedIds(nextOrder);
      persistConfig(visibleIds, nextOrder);
      onChange?.(visibleIds, nextOrder);
    },
  });

  return (
    <div className="w-full">
      <div className={hideTrigger ? 'sr-only' : 'flex items-center justify-start mb-2'}>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button
              id={triggerId || 'field-configurator-trigger'}
              variant="outline"
              className="bg-black text-white hover:bg-black/90 border-transparent flex items-center gap-2"
            >
              <Settings className="h-4 w-4" />
              フィールド構成
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[900px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>フィールド構成</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* 左側: フィールドリスト */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-700">表示フィールド</span>
                    <p className="text-xs text-gray-500">
                      チェックを付けたフィールドのみ表示されます。ドラッグ＆ドロップで並び替えできます。
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        persistConfig(defaultVisibleIds, orderedIds);
                        setVisibleIds(defaultVisibleIds);
                        onChange?.(defaultVisibleIds, orderedIds);
                      }}
                      className="h-7 px-3 text-xs"
                    >
                      全選択
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        persistConfig([], orderedIds);
                        setVisibleIds([]);
                        onChange?.([], orderedIds);
                      }}
                      className="h-7 px-3 text-xs"
                    >
                      全解除
                    </Button>
                  </div>
                </div>
                <div className="max-h-[50vh] overflow-auto space-y-2 pr-1">
                  {orderedIds.map(id => {
                    const col = columns.find(c => c.id === id);
                    if (!col) return null;
                    return (
                      <div
                        key={col.id}
                        draggable
                        onDragStart={e => handleDragStart(e, col.id)}
                        onDragOver={handleDragOver}
                        onDrop={e => handleDrop(e, col.id)}
                        onDragEnd={handleDragEnd}
                        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 transition-colors ${
                          draggedId === col.id
                            ? 'opacity-50 border-dashed border-primary bg-primary/5'
                            : 'border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <GripVertical className="h-4 w-4 text-gray-400 cursor-grab active:cursor-grabbing flex-shrink-0" />
                          <label className="flex items-center gap-2 text-sm flex-1 min-w-0 cursor-pointer">
                            <Checkbox
                              checked={visibleSet.has(col.id)}
                              onCheckedChange={() => toggle(col.id)}
                              aria-label={col.label}
                            />
                            <span className="truncate">{col.label}</span>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* 右側: カテゴリフィルター */}
              {dialogExtraContent && (
                <div className="border-l-0 lg:border-l border-gray-200 pl-0 lg:pl-6">
                  {dialogExtraContent}
                </div>
              )}
            </div>
            <div className="mt-3 flex justify-end">
              <Button onClick={() => setOpen(false)}>閉じる</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div>{children({ visibleSet, orderedIds })}</div>
    </div>
  );
}
