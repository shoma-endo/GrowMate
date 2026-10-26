import { Tabs, TabsContent, TabsList, TabsTrigger } from 'growmate-ui';

export const Analytics = () => (
  <Tabs defaultValue="overview" className="max-w-lg">
    <TabsList>
      <TabsTrigger value="overview">概要</TabsTrigger>
      <TabsTrigger value="queries">検索キーワード</TabsTrigger>
      <TabsTrigger value="history">評価の履歴</TabsTrigger>
    </TabsList>
    <TabsContent value="overview" className="pt-2 text-sm">
      過去30日間で、表示回数は 18,240 回、クリック数は 612 回でした。
    </TabsContent>
  </Tabs>
);
