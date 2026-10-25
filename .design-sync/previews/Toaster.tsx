import { useEffect } from 'react';
import { Toaster, toast } from 'growmate-ui';

export const Notifications = () => {
  useEffect(() => {
    toast.success('保存しました');
    toast.error('取り込みに失敗しました。時間をおいてもう一度お試しください。');
    toast.loading('生成中...');
  }, []);
  return (
    <div className="relative h-64">
      <Toaster position="top-center" expand />
    </div>
  );
};
