'use client';

import {
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Ga4MediaContentScores } from '@/types/ga4';

export function MediaContentScorePanel({ scores }: { scores: Ga4MediaContentScores | null }) {
  if (!scores) return null;

  return (
    <Card aria-labelledby="media-score-title">
      <CardHeader>
        <CardTitle id="media-score-title" className="text-lg">メディア全体のコンテンツ力</CardTitle>
        <p className="text-sm text-muted-foreground">
          {scores.totalCount}記事中{scores.evaluatedCount}記事が評価済み
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-md border p-4">
            <p className="text-sm text-muted-foreground">資産価値スコア</p>
            <p className="text-2xl font-bold">{scores.assetValueScore ?? '—'}</p>
            <p className="text-xs text-muted-foreground">記事ごとのコンテンツ力スコアの単純平均</p>
          </div>
          <div className="rounded-md border p-4">
            <p className="text-sm text-muted-foreground">実効スコア</p>
            <p className="text-2xl font-bold">{scores.effectiveScore ?? '—'}</p>
            <p className="text-xs text-muted-foreground">訪問数で重み付けした平均</p>
          </div>
        </div>

        <p className="text-sm text-muted-foreground">
          {scores.effectiveScore !== null && scores.assetValueScore !== null && scores.effectiveScore > scores.assetValueScore
            ? '実効スコアが高い状態です。訪問の多い記事は健全です。低スコア記事を整理して資産価値を引き上げます。'
            : scores.effectiveScore !== null && scores.assetValueScore !== null && scores.effectiveScore < scores.assetValueScore
              ? '実効スコアが低い状態です。訪問の多い低スコア記事を最優先で改善します。'
              : '2つのスコアを比較して、訪問の多い記事から改善します。'}
        </p>

        {scores.points.length > 0 ? (
          <div>
            <div className="h-80 w-full" aria-label="読み始めスコアと読了スコアの散布図">
              <ResponsiveContainer>
                <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
                  <XAxis
                    type="number"
                    dataKey="engageScore"
                    domain={[0, 100]}
                    name="読み始めスコア"
                    tick={{ fontSize: 12 }}
                    label={{ value: '読み始めスコア', position: 'bottom', fontSize: 12 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="readScore"
                    domain={[0, 100]}
                    name="読了スコア"
                    tick={{ fontSize: 12 }}
                    label={{ value: '読了スコア', angle: -90, position: 'insideLeft', fontSize: 12 }}
                  />
                  <ZAxis type="number" dataKey="sessions" range={[40, 360]} name="訪問した人" />
                  <ReferenceLine x={60} stroke="var(--border)" strokeDasharray="3 3" />
                  <ReferenceLine y={60} stroke="var(--border)" strokeDasharray="3 3" />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter name="記事" data={scores.points} fill="var(--chart-1)" />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            評価済みの記事がありません。
          </p>
        )}
      </CardContent>
    </Card>
  );
}
