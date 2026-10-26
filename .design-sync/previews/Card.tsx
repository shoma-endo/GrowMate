import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from 'growmate-ui';

export const Summary = () => (
  <Card className="max-w-sm">
    <CardHeader>
      <CardTitle>今月のクリック数</CardTitle>
      <CardDescription>2026年10月1日〜10月24日</CardDescription>
    </CardHeader>
    <CardContent>
      <p className="text-3xl font-bold">12,480</p>
      <p className="text-sm text-muted-foreground">前月の同じ期間より 8.2% 増えています</p>
    </CardContent>
  </Card>
);

export const Setup = () => (
  <Card className="max-w-sm">
    <CardHeader>
      <div className="flex items-center justify-between">
        <CardTitle>Google Analytics 4</CardTitle>
        <Badge variant="outline">未設定</Badge>
      </div>
      <CardDescription>読了率や滞在時間を記事の評価に使います。</CardDescription>
    </CardHeader>
    <CardContent>
      <Button>連携する</Button>
    </CardContent>
  </Card>
);
