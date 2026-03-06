import React from 'react';
import { AlertCircle, AlertTriangle } from 'lucide-react';

export const DismissibleErrorAlert: React.FC<{ error: string; onClose?: () => void }> = ({
  error,
  onClose,
}) => (
  <div className="bg-red-50 border-l-4 border-red-400 p-4 m-3" role="alert" aria-live="polite">
    <div className="flex">
      <div className="flex-shrink-0">
        <AlertCircle className="h-5 w-5 text-red-400" />
      </div>
      <div className="ml-3 flex-1 break-words">
        <p className="text-sm text-red-700 break-words">{error}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="text-sm text-red-600 ml-4 hover:text-red-800 focus-visible:ring-2 focus-visible:ring-red-300 rounded"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  </div>
);

export const DismissibleWarningAlert: React.FC<{ message: string; onClose?: () => void }> = ({
  message,
  onClose,
}) => (
  <div
    className="bg-yellow-50 border-l-4 border-yellow-400 p-4 m-3"
    role="status"
    aria-live="polite"
  >
    <div className="flex">
      <div className="flex-shrink-0">
        <AlertTriangle className="h-5 w-5 text-yellow-500" />
      </div>
      <div className="ml-3 flex-1 break-words">
        <p className="text-sm text-yellow-800 break-words">{message}</p>
      </div>
      {onClose && (
        <button
          type="button"
          className="text-sm text-yellow-700 ml-4 hover:text-yellow-900 focus-visible:ring-2 focus-visible:ring-yellow-300 rounded"
          onClick={onClose}
          aria-label="閉じる"
        >
          ×
        </button>
      )}
    </div>
  </div>
);
