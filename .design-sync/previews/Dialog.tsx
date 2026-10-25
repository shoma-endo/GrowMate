import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from 'growmate-ui';

export const Confirm = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>この記事を削除しますか？</DialogTitle>
        <DialogDescription>削除すると、評価の履歴と改善提案も見られなくなります。</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline">キャンセル</Button>
        <Button variant="destructive">削除する</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

export const Form = () => (
  <Dialog open>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>評価サイクルを開始</DialogTitle>
        <DialogDescription>評価サイクル日数ごとに、検索の成果を見直します。</DialogDescription>
      </DialogHeader>
      <div className="grid gap-2">
        <Label htmlFor="interval">評価サイクル日数</Label>
        <Input id="interval" type="number" defaultValue={30} />
      </div>
      <DialogFooter>
        <Button variant="outline">キャンセル</Button>
        <Button>開始する</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
