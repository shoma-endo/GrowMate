import { Button, Label, Sheet, SheetContent, SheetTitle, Textarea } from 'growmate-ui';

export const Right = () => (
  <Sheet open modal={false}>
    <SheetContent>
      <div className="grid gap-4 p-4">
        <SheetTitle>メモを編集</SheetTitle>
        <div className="grid gap-2">
          <Label htmlFor="memo">この記事のメモ</Label>
          <Textarea id="memo" rows={6} defaultValue="10月に見出しを見直した。次は事例を足す。" />
        </div>
        <Button>保存する</Button>
      </div>
    </SheetContent>
  </Sheet>
);
