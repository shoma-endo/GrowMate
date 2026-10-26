import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from 'growmate-ui';

const rows = [
  { name: '春の新生活キャンペーン', status: '有効', clicks: '1,284', imp: '42,310', ctr: '3.03%', cost: '¥58,420' },
  { name: 'ブランド指名検索', status: '有効', clicks: '962', imp: '8,105', ctr: '11.87%', cost: '¥12,880' },
  { name: '比較検討ユーザー向け', status: '一時停止', clicks: '214', imp: '15,920', ctr: '1.34%', cost: '¥9,760' },
];

export const Campaigns = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>キャンペーン名</TableHead>
        <TableHead>ステータス</TableHead>
        <TableHead className="text-right">クリック数</TableHead>
        <TableHead className="text-right">表示回数</TableHead>
        <TableHead className="text-right">CTR</TableHead>
        <TableHead className="text-right">費用</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {rows.map((r) => (
        <TableRow key={r.name}>
          <TableCell className="font-medium">{r.name}</TableCell>
          <TableCell>
            <Badge variant={r.status === '有効' ? 'default' : 'outline'}>{r.status}</Badge>
          </TableCell>
          <TableCell className="text-right">{r.clicks}</TableCell>
          <TableCell className="text-right">{r.imp}</TableCell>
          <TableCell className="text-right">{r.ctr}</TableCell>
          <TableCell className="text-right">{r.cost}</TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

export const Empty = () => (
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead>記事タイトル</TableHead>
        <TableHead className="text-right">表示回数</TableHead>
        <TableHead className="text-right">クリック数</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      <TableRow>
        <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
          表示できる記事がありません
        </TableCell>
      </TableRow>
    </TableBody>
  </Table>
);
