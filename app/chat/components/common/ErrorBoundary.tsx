'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { ERROR_MESSAGES } from '@/domain/errors/error-messages';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorId: string | null;
}

const IS_DEVELOPMENT = process.env.NODE_ENV === 'development';

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorId: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    return {
      hasError: true,
      error,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', {
      message: error.message,
      name: error.name,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    if (IS_DEVELOPMENT) {
      console.group('🚨 Error Boundary Details');
      console.error('Error:', error);
      console.error('Error Info:', errorInfo);
      console.error('Component Stack:', errorInfo.componentStack);
      console.groupEnd();
    }
  }

  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorId: null,
    });
  };

  handleRetry = () => {
    this.resetError();
  };

  handleReload = () => {
    window.location.reload();
  };

  private getErrorMessage(error: Error | null): string {
    if (!error) return ERROR_MESSAGES.ERROR_BOUNDARY.FALLBACK;

    if (error.name === 'ChunkLoadError' || error.message.includes('Loading chunk')) {
      return ERROR_MESSAGES.ERROR_BOUNDARY.CHUNK_LOAD;
    }

    if (error.message.includes('Network')) {
      return ERROR_MESSAGES.ERROR_BOUNDARY.NETWORK;
    }

    return ERROR_MESSAGES.ERROR_BOUNDARY.FALLBACK;
  }

  private isCriticalError(error: Error | null): boolean {
    if (!error) return false;
    return error.name === 'ChunkLoadError' || error.message.includes('Loading chunk');
  }

  render() {
    if (this.state.hasError) {
      const { fallback } = this.props;
      const { error, errorId } = this.state;

      if (fallback) {
        return fallback;
      }

      const errorMessage = this.getErrorMessage(error);
      const isCritical = this.isCriticalError(error);

      return (
        <div className="min-h-[400px] flex items-center justify-center p-4">
          <Card className="w-full max-w-lg">
            <CardHeader className="text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-8 h-8 text-red-500" />
              </div>
              <CardTitle className="text-xl font-semibold text-red-700">
                エラーが発生しました
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-4">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>

              <div className="flex gap-2 justify-center">
                <Button onClick={this.handleRetry} variant="outline">
                  <RefreshCw className="w-4 h-4 mr-2" />
                  再試行
                </Button>

                {isCritical && (
                  <Button onClick={this.handleReload} variant="destructive">
                    ページを再読み込み
                  </Button>
                )}
              </div>

              {IS_DEVELOPMENT && error && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm text-gray-600 hover:text-gray-800">
                    開発者情報（デバッグ用）
                  </summary>
                  <div className="mt-2 p-3 bg-gray-50 rounded text-xs">
                    <p>
                      <strong>Error ID:</strong> {errorId}
                    </p>
                    <p>
                      <strong>Error Name:</strong> {error.name}
                    </p>
                    <p>
                      <strong>Error Message:</strong> {error.message}
                    </p>
                    {error.stack && (
                      <details className="mt-2">
                        <summary className="cursor-pointer">Stack Trace</summary>
                        <pre className="mt-1 text-xs overflow-auto">{error.stack}</pre>
                      </details>
                    )}
                  </div>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
