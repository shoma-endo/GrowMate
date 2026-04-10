'use client';

import React, { useState, useRef } from 'react';
import { ChatSession, ChatSessionSearchResult } from '@/domain/interfaces/IChatService';
import { ChatSessionActions } from '@/hooks/useChatSession';
import { Button } from '@/components/ui/button';
import { ChevronRight, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import SessionListContent from '@/components/SessionListContent';
import { DeleteChatDialog } from '@/components/DeleteChatDialog';
import { useAuth } from '@/components/AuthProvider';

interface SessionSidebarProps {
  sessions: ChatSession[];
  currentSessionId: string;
  actions: ChatSessionActions;
  isLoading?: boolean; // ✅ 読み込み状態を受け取る
  isMobile: boolean;
  searchQuery: string;
  searchResults: ChatSessionSearchResult[];
  searchError: string | null;
  isSearching: boolean;
  disableActions?: boolean;
}

const SessionSidebar: React.FC<SessionSidebarProps> = ({
  sessions,
  currentSessionId,
  actions,
  isLoading = false,
  isMobile,
  searchQuery,
  searchResults,
  searchError,
  isSearching,
  disableActions,
}) => {
  const { isOwnerViewMode } = useAuth();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sessionToDelete, setSessionToDelete] = useState<ChatSession | null>(null);
  const [isDeletingSession, setIsDeletingSession] = useState(false);
  const [hoveredSessionId, setHoveredSessionId] = useState<string | null>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const isReadOnly = Boolean(isOwnerViewMode || disableActions);

  const handleSessionClick = async (sessionId: string) => {
    // ✅ 親コンポーネント（ChatLayout）が初期化を担当
    actions.loadSession(sessionId);
  };

  const handleSearchResultClick = (sessionId: string) => {
    actions.loadSession(sessionId);
  };

  const handleStartNewChat = () => {
    if (isReadOnly) return;
    actions.startNewSession();
  };

  const handleDeleteClick = (session: ChatSession, e: React.MouseEvent) => {
    if (isReadOnly) return;
    e.stopPropagation();
    setSessionToDelete(session);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (isReadOnly) return;
    if (!sessionToDelete) return;

    setIsDeletingSession(true);
    const toastId = toast.loading('削除中です...');
    try {
      await actions.deleteSession(sessionToDelete.id);
      toast.success('削除しました', { id: toastId });
    } catch (error) {
      const message = error instanceof Error ? error.message : '削除に失敗しました';
      toast.error(message, { id: toastId });
    } finally {
      setIsDeletingSession(false);
      setSessionToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  const CenteredStatus: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex h-full min-h-full items-center justify-center px-4 py-12">
      <div className="flex flex-col items-center gap-3 text-sm text-gray-500 text-center">
        {children}
      </div>
    </div>
  );

  // ✅ 読み込み中のアニメーション表示
  const LoadingIndicator = () => (
    <CenteredStatus>
      <div className="flex gap-2 items-center">
        <div
          className="w-2 h-2 bg-[#06c755] rounded-full animate-bounce"
          style={{ animationDelay: '0ms' }}
        />
        <div
          className="w-2 h-2 bg-[#06c755] rounded-full animate-bounce"
          style={{ animationDelay: '150ms' }}
        />
        <div
          className="w-2 h-2 bg-[#06c755] rounded-full animate-bounce"
          style={{ animationDelay: '300ms' }}
        />
      </div>
      <span>履歴を読み込み中...</span>
    </CenteredStatus>
  );

  // ✅ 読み込み状態の判定
  const shouldShowLoading = isLoading && sessions.length === 0;
  const showSearchResults = searchQuery.trim().length > 0;

  // SessionListContentコンポーネント用に型変換
  const adaptedSessions = sessions.map(session => ({
    id: session.id,
    title: session.title,
    updatedAt: session.updatedAt,
  }));

  const sessionListProps = {
    sessions: adaptedSessions,
    sessionId: currentSessionId,
    hoveredSessionId,
    onLoadSession: handleSessionClick,
    onDeleteClick: (
      session: { id: string; title: string; updatedAt: Date },
      e: React.MouseEvent
    ) => {
      // 元のChatSession型に戻して呼び出し
      const originalSession = sessions.find(s => s.id === session.id);
      if (originalSession) {
        handleDeleteClick(originalSession, e);
      }
    },
    onStartNewChat: handleStartNewChat,
    onHoverSession: setHoveredSessionId,
    sessionListRef,
    onToggleSidebar: () => setSidebarCollapsed(!sidebarCollapsed),
    showToggleButton: !isMobile,
    disableActions: isReadOnly,
  };

  const renderSearchResultList = () => {
    if (isSearching) {
      return (
        <CenteredStatus>
          <Loader2 className="h-4 w-4 animate-spin text-[#06c755]" />
          <span>検索中です...</span>
        </CenteredStatus>
      );
    }

    if (searchError) {
      return (
        <CenteredStatus>
          <span className="text-red-500">{searchError}</span>
        </CenteredStatus>
      );
    }

    if (searchResults.length === 0) {
      return (
        <CenteredStatus>
          <span className="text-gray-400">チャットが見つかりません</span>
        </CenteredStatus>
      );
    }

    const adaptedSearchSessions = searchResults.map(result => ({
      id: result.sessionId,
      title: result.title,
      updatedAt: result.lastMessageAt,
    }));

    return (
      <SessionListContent
        {...sessionListProps}
        sessions={adaptedSearchSessions}
        onLoadSession={handleSearchResultClick}
      />
    );
  };

  const renderListArea = () => {
    if (showSearchResults) {
      return renderSearchResultList();
    }
    if (shouldShowLoading) {
      return <LoadingIndicator />;
    }
    return <SessionListContent {...sessionListProps} />;
  };

  let sidebarContent: React.ReactNode;

  if (!isMobile) {
    sidebarContent = (
      <div
        className={`bg-slate-50 border-r flex-shrink-0 flex flex-col relative h-full transition-all duration-300 ${
          sidebarCollapsed ? 'w-12' : 'w-80'
        }`}
      >
        {sidebarCollapsed ? (
          <div className="flex flex-col items-center pt-20">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="h-8 w-8 hover:bg-gray-200"
              title="サイドバーを開く"
            >
              <ChevronRight size={16} />
            </Button>
          </div>
        ) : (
          <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto">{renderListArea()}</div>
          </div>
        )}
      </div>
    );
  } else {
    sidebarContent = (
      <div className="flex flex-col h-full bg-slate-50">
        <div className="flex-1 overflow-y-auto">{renderListArea()}</div>
      </div>
    );
  }

  if (!isMobile) {
    sidebarContent = <div className="h-full pt-16">{sidebarContent}</div>;
  }

  return (
    <>
      {sidebarContent}
      <DeleteChatDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteConfirm}
        chatTitle={sessionToDelete?.title || ''}
        isDeleting={isDeletingSession}
      />
    </>
  );
};

export default SessionSidebar;
