'use client';

import React, { useMemo, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { toast } from 'sonner';
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
import {
  isSameFieldConfig,
  normalizeFieldConfig,
  parseLegacyStoredFieldConfig,
} from '@/lib/field-config';
import { saveFieldConfig } from '@/server/actions/fieldConfig.actions';
import type {
  FieldColumnOption,
  FieldConfigState,
  FieldConfigTableKey,
  StoredFieldConfig,
} from '@/types/field-config';

/** 保存はDBへの往復になるため、チェック連打・ドラッグ中の書き込み嵐を抑える */
const SAVE_DEBOUNCE_MS = 600;

interface FieldConfigRenderProps {
  visibleSet: Set<string>;
  orderedIds: string[];
}

interface FieldConfiguratorProps {
  columns: FieldColumnOption[];
  /** 保存先を識別する一覧キー（DB の `user_table_field_configs.table_key`） */
  tableKey: FieldConfigTableKey;
  /** サーバーコンポーネントが読み出した保存済み構成。未保存なら `null` */
  initialConfig: StoredFieldConfig | null;
  /** DB 移行前に localStorage へ保存していたキー。初回の移し替えにだけ使う */
  legacyStorageKey: string;
  onChange?: (visibleIds: string[], orderedIds: string[]) => void;
  children: (config: FieldConfigRenderProps) => ReactNode;
  hideTrigger?: boolean;
  triggerId?: string;
  dialogExtraContent?: ReactNode;
}

export default function FieldConfigurator({
  columns,
  tableKey,
  initialConfig,
  legacyStorageKey,
  onChange,
  children,
  hideTrigger,
  triggerId,
  dialogExtraContent,
}: FieldConfiguratorProps) {
  // **初期値はサーバーが読んだ構成から作る。** サーバーとクライアントで同じ入力から
  // 同じ結果になるので hydration mismatch にならず、既定列が一瞬見えるチラつきも出ない。
  const [config, setConfig] = useState<FieldConfigState>(() =>
    normalizeFieldConfig(columns, initialConfig)
  );
  const [open, setOpen] = useState(false);

  const { visibleIds, orderedIds } = config;
  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  // **状態の最新値を同期的に保持する。** ハンドラがレンダリング時のクロージャ値を読むと、
  // 再レンダリング前に続けて操作されたときに1つ前の構成を元に上書きしてしまう。
  const configRef = useRef<FieldConfigState>(config);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConfigRef = useRef<FieldConfigState | null>(null);
  const savedConfigRef = useRef<FieldConfigState>(config);

  const persist = useCallback(
    async (next: FieldConfigState) => {
      if (isSameFieldConfig(next, savedConfigRef.current)) {
        return;
      }
      savedConfigRef.current = next;
      const result = await saveFieldConfig({
        tableKey,
        visibleIds: next.visibleIds,
        orderedIds: next.orderedIds,
      });
      if (!result.success && result.error) {
        toast.error(result.error);
      }
    },
    [tableKey]
  );

  /** 溜めている変更を即座に書き出す（ダイアログを閉じたとき・アンマウント時） */
  const flush = useCallback(() => {
    if (saveTimerRef.current === null) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingConfigRef.current;
    pendingConfigRef.current = null;
    if (pending) {
      void persist(pending);
    }
  }, [persist]);

  /** 楽観更新（UI は即時反映）＋ 保存は debounce する */
  const applyConfig = useCallback(
    (next: FieldConfigState) => {
      configRef.current = next;
      setConfig(next);
      onChange?.(next.visibleIds, next.orderedIds);

      pendingConfigRef.current = next;
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
      }
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        const pending = pendingConfigRef.current;
        pendingConfigRef.current = null;
        if (pending) {
          void persist(pending);
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [onChange, persist]
  );

  // onChange は毎レンダリングで参照が変わりうるため ref 経由で読む
  // （依存配列に入れると初回通知の useEffect が毎レンダリング後に再実行される）
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // マウント時に1回だけ:
  //   1. 解決済みの構成を親へ通知する（Instagram 側はソート列が隠れたかの判定に使う）
  //   2. DB 未保存かつ localStorage に旧データがあれば、それを引き継いでDBへ移す
  // 旧キーはどちらの経路でも消す。**DB を唯一の正本にし、二重管理にしない。**
  useEffect(() => {
    const legacy = (() => {
      try {
        return parseLegacyStoredFieldConfig(localStorage.getItem(legacyStorageKey));
      } catch {
        return null;
      }
    })();

    const migrated = initialConfig === null && legacy !== null;
    const resolved = migrated ? normalizeFieldConfig(columns, legacy) : config;

    if (migrated) {
      configRef.current = resolved;
      setConfig(resolved);
      void persist(resolved);
    }

    try {
      localStorage.removeItem(legacyStorageKey);
    } catch {
      // ストレージが使えない環境でも動作を止めない
    }

    onChangeRef.current?.(resolved.visibleIds, resolved.orderedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // アンマウント時に未保存の変更を取りこぼさない
  useEffect(() => flush, [flush]);

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

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      flush();
    }
  };

  const toggle = (id: string) => {
    const current = configRef.current;
    const nextVisible = current.visibleIds.includes(id)
      ? current.visibleIds.filter(x => x !== id)
      : [...current.visibleIds, id];
    applyConfig({ visibleIds: nextVisible, orderedIds: current.orderedIds });
  };

  // ドラッグ＆ドロップによる並び替え
  const { draggedId, handleDragStart, handleDragOver, handleDrop, handleDragEnd } = useDragReorder({
    items: orderedIds,
    getId: id => id,
    onReorder: nextOrder => {
      applyConfig({ visibleIds: configRef.current.visibleIds, orderedIds: nextOrder });
    },
  });

  return (
    <div className="w-full">
      <div className={hideTrigger ? 'sr-only' : 'flex items-center justify-start mb-2'}>
        <Dialog open={open} onOpenChange={handleOpenChange}>
          <DialogTrigger asChild>
            <Button
              // hideTrigger 時はこのボタンは sr-only で隠され、開閉は外部の triggerId 要素の
              // クリックリスナー（下の useEffect）が担う。ここにも同じ id を付けると
              // 外部ボタンと DOM 上で id が重複するため、hideTrigger 時は id を持たせない。
              id={hideTrigger ? undefined : triggerId || 'field-configurator-trigger'}
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
                      onClick={() =>
                        applyConfig({
                          visibleIds: columns.map(c => c.id),
                          orderedIds: configRef.current.orderedIds,
                        })
                      }
                      className="h-7 px-3 text-xs"
                    >
                      全選択
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        applyConfig({ visibleIds: [], orderedIds: configRef.current.orderedIds })
                      }
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
              <Button onClick={() => handleOpenChange(false)}>閉じる</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div>{children({ visibleSet, orderedIds })}</div>
    </div>
  );
}
