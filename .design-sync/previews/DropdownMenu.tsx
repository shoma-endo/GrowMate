import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Icons } from 'growmate-ui';

export const RowActions = () => (
  <div className="flex h-56 justify-center pt-2">
    <DropdownMenu open modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="操作">
          <Icons.MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem>詳細を見る</DropdownMenuItem>
        <DropdownMenuItem>評価サイクルを開始</DropdownMenuItem>
        <DropdownMenuItem>メモを編集</DropdownMenuItem>
        <DropdownMenuItem className="text-destructive">削除する</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
);
