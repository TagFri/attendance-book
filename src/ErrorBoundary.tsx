import React from "react";

type ErrorBoundaryProps = {
    children: React.ReactNode;
    onError?: (error: Error, info: React.ErrorInfo) => void;
    fallback?: React.ReactNode | ((error: Error) => React.ReactNode);
    /**
     * When this value changes, the boundary resets its error state.
     */
    resetKey?: unknown;
};

type ErrorBoundaryState = {
    hasError: boolean;
    error?: Error;
};

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { hasError: false };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo) {
        if (this.props.onError) {
            try {
                this.props.onError(error, info);
            } catch {
                // ignore onError failures
            }
        }
    }

    componentDidUpdate(prevProps: ErrorBoundaryProps) {
        if (prevProps.resetKey !== this.props.resetKey) {
            // reset error state when resetKey changes
            // eslint-disable-next-line react/no-did-update-set-state
            this.setState({ hasError: false, error: undefined });
        }
    }

    render() {
        if (this.state.hasError) {
            const { fallback } = this.props;
            if (fallback) {
                if (typeof fallback === "function") {
                    return (fallback as (e: Error) => React.ReactNode)(this.state.error as Error);
                }
                return fallback;
            }
            return null;
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
