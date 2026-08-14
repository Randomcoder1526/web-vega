import React from 'react';
import { useThemeStore } from '../store/themeStore';

interface ErrorFallbackProps {
  error: Error;
  resetError: () => void;
}

export const ErrorFallback: React.FC<ErrorFallbackProps> = ({ error, resetError }) => {
  const { primary } = useThemeStore((s) => s);
  return (
    <div className="flex-1 justify-center items-center p-6 bg-surface min-h-screen animate-fade-in">
      <div className="rounded-2xl p-8 items-center w-full max-w-sm glass-card text-center">
        <div className="w-16 h-16 rounded-2xl items-center justify-center mb-3 mx-auto flex bg-error/10">
          <svg className="w-9 h-9 text-error/60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <p className="text-white/70 text-lg font-bold mt-2">Something went wrong</p>
        <p className="text-white/30 text-sm mt-2">{error.message || 'An unexpected error occurred'}</p>
        <button
          onClick={resetError}
          className="px-8 py-3 rounded-xl mt-6 text-white font-semibold text-sm transition-all duration-200 hover:scale-105 active:scale-95"
          style={{ backgroundColor: primary, boxShadow: `0 4px 16px ${primary}40` }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
};

interface QueryErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
}

interface QueryErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class QueryErrorBoundary extends React.Component<QueryErrorBoundaryProps, QueryErrorBoundaryState> {
  constructor(props: QueryErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): QueryErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('QueryErrorBoundary caught an error:', error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      const FallbackComponent = this.props.fallback || ErrorFallback;
      return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
    }
    return this.props.children;
  }
}
