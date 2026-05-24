# Async React Patterns

> Reference: uhyo「React 19時代のコンポーネント設計ベストプラクティス」(2026-02-18)

## Philosophy

Async React = 非同期処理を前提にアプリケーションを実装し、最適な UX を目指す考え方。

**核心**: Async React は「宣言的 UI」の拡張である。プログラマーはトランジションの「意味」を宣言し、具体的な挙動（ちらつき防止、楽観的更新、アニメーション等）は React が自動最適化する。

**目標**: API を個別に使うだけではなく、**汎用化して、個別の対応をせずとも最適化された UX を提供できる**状態を作ること。

## 1. 非ブロッキング更新にはトランジションを優先する

Suspense や重い再レンダーを伴うステート更新は `startTransition` で包む。

**❌ Non-transition (Suspense fallback がちらつく):**

```tsx
setPage(2);
```

**✅ Transition-wrapped:**

```tsx
startTransition(() => {
  setPage(2);
});
```

### Transition を使うべきケース / 使ってはいけないケース

| ケース | Transition | 理由 |
|--------|-----------|------|
| ページ遷移・タブ切替・フィルタ変更 | ✅ 使う | Suspense 境界をまたぐ非ブロッキング更新 |
| データ送信・楽観的更新 | ✅ 使う | useOptimistic と連携して UX 向上 |
| **controlled text input** (`<input value={state}>`) | ❌ **使わない** | 更新が遅延し入力がラグる（React 公式 caveat） |
| 即座に視覚フィードバックが必要な更新 | ❌ 使わない | Transition は低優先度のため遅延する |

### async action の注意点

`startTransition(() => action())` でトランジション扱いになるのは**同期的にスケジュールされた更新のみ**。`await` 後の `setState` は自動的にはトランジションに含まれない:

```tsx
startTransition(async () => {
  setOptimistic(newValue);       // ✅ transition 内
  const result = await fetchData();
  startTransition(() => {        // ← await 後は再ラップが必要
    setData(result);
  });
});
```

### useOptimistic / useActionState との関係

- **useOptimistic**: 楽観的更新。トランジションの「いつからいつまで」が楽観値の生存期間を決める
- **useActionState**: `<form action={dispatchAction}>` 経由なら React が自動で Transition 化する。`dispatchAction()` を直接呼ぶ場合のみ手動 `startTransition` が必要

設計時に考えるべき問い: **「このトランジションは何を意味していて、いつからいつまで続くのか」**

## 2. 汎用コンポーネントへの Transition 組み込み

毎回 `startTransition` を書くのではなく、汎用コンポーネントに組み込んで自動化する。

**❌ Caller が毎回 transition を意識:**

```tsx
const MyButton: FC<{ onClick: (e: MouseEvent) => void; children: ReactNode }> = ({
  onClick,
  children,
}) => (
  <button className="..." onClick={onClick}>
    {children}
  </button>
);

// 使用側で毎回 startTransition を書く必要がある
<MyButton onClick={() => startTransition(() => setState(newValue))}>
  Click
</MyButton>
```

**✅ コンポーネント内部で transition を保証（同期更新向け）:**

```tsx
const MyButton: FC<{ action: (e: MouseEvent) => void; children: ReactNode }> = ({
  action,
  children,
}) => (
  <button
    className="..."
    onClick={(event) => {
      startTransition(() => {
        action(event);
      });
    }}
  >
    {children}
  </button>
);

// 使用側は transition を意識しなくてよい
<MyButton action={() => setState(newValue)}>Click</MyButton>
```

### Design Point

- props 名を `onClick` → `action` に変えることで、transition が保証されていることを API レベルで表現
- ボタン経由の**同期的な**ステート更新は自動的にトランジション化される
- **async action の場合**: `await` 後の `setState` はトランジションから外れる。action 内で再度 `startTransition` を呼ぶこと

## 3. isPending による Loading UX

`useTransition` の `isPending` を活用し、トランジション中の視覚フィードバックを提供する。

```tsx
const MyButton: FC<{ action: (e: MouseEvent) => void; children: ReactNode }> = ({
  action,
  children,
}) => {
  const [isPending, startTransition] = useTransition();

  return (
    <button
      className={isPending ? "opacity-50" : ""}
      disabled={isPending}
      onClick={(event) => {
        startTransition(() => {
          action(event);
        });
      }}
    >
      {children}
    </button>
  );
};
```

### Why isPending in the component?

- コンポーネント責務を明確にしながらアプリ全体と調和する UX を実現
- 使用側は loading 状態の管理を意識しなくてよい

## 4. Suspense バウンダリの戦略的配置

Suspense は単なるオプション機能ではなく、Async React 時代の**必須要素**。

### 設計指針

1. **Suspense = React ランタイムが非同期処理を認識する基礎** — 配置しなければ React は最適化できない
2. **バウンダリの配置がアプリ設計を左右する** — 「どこに境界を引くか」が UX に直結
3. **トランジションのオプトアウト** — Suspense バウンダリの配置方法でデフォルト挙動を制御可能

### 考慮すべき問い

- このトランジションは何を意味しているか?
- いつからいつまで続くのか?
- どの範囲のコンテンツが影響を受けるか?

## Summary Rules

1. **非ブロッキング更新には transition を優先** — ただし controlled input は除外（入力ラグの原因になる）
2. **汎用コンポーネントに transition を組み込む** — caller に transition 責務を押し付けない
3. **`await` 後の setState は再ラップが必要** — `startTransition` のスコープは同期的な更新のみ
4. **isPending で loading フィードバックを提供** — コンポーネント内部で完結させる
5. **Suspense バウンダリを戦略的に配置** — 「どこに引くか」がアプリの UX 設計そのもの
6. **useActionState は form action 経由なら自動 Transition** — 手動 `startTransition` が要るのは `dispatchAction()` を直接呼ぶ場合のみ
7. **宣言的に意味を定義し、最適化は React に委ねる** — Async React = 宣言的 UI の拡張
