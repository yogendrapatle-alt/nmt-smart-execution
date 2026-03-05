import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary Component
 * 
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI instead of crashing the entire app.
 * 
 * Usage:
 *   <ErrorBoundary>
 *     <App />
 *   </ErrorBoundary>
 * 
 * Features:
 * - Prevents blank page on React errors
 * - Shows user-friendly error message
 * - Provides component stack trace for debugging
 * - Allows page reload to recover
 * - Reports errors to console
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error details to console for debugging
    console.error('🔴 React Error Boundary caught an error:', error);
    console.error('📊 Component Stack:', errorInfo.componentStack);
    
    // Update state with error details
    this.setState({
      error,
      errorInfo
    });

    // TODO: Send error to logging service (Sentry, LogRocket, etc.)
    // Example: logErrorToService(error, errorInfo);
  }

  handleReload = (): void => {
    // Reload the page to recover
    window.location.reload();
  };

  handleGoHome = (): void => {
    // Clear error state and navigate to home
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.href = '/';
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Fallback UI when error occurs
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8f9fa',
          padding: '2rem'
        }}>
          <div style={{
            maxWidth: '600px',
            width: '100%',
            backgroundColor: 'white',
            borderRadius: '12px',
            boxShadow: '0 4px 6px rgba(0, 0, 0, 0.1)',
            padding: '3rem',
            textAlign: 'center'
          }}>
            {/* Error Icon */}
            <div style={{
              width: '80px',
              height: '80px',
              margin: '0 auto 2rem',
              backgroundColor: '#dc3545',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <span style={{
                fontSize: '48px',
                color: 'white'
              }}>⚠️</span>
            </div>

            {/* Error Message */}
            <h1 style={{
              fontSize: '28px',
              fontWeight: 600,
              color: '#212529',
              marginBottom: '1rem'
            }}>
              Oops! Something went wrong
            </h1>

            <p style={{
              fontSize: '16px',
              color: '#6c757d',
              marginBottom: '2rem',
              lineHeight: '1.6'
            }}>
              We're sorry, but something unexpected happened. The application encountered an error
              and couldn't continue. Don't worry, your data is safe.
            </p>

            {/* Error Details (collapsible for developers) */}
            {this.state.error && (
              <details style={{
                marginBottom: '2rem',
                textAlign: 'left',
                backgroundColor: '#f8f9fa',
                padding: '1rem',
                borderRadius: '6px',
                border: '1px solid #dee2e6'
              }}>
                <summary style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#495057',
                  marginBottom: '0.5rem'
                }}>
                  🔍 Technical Details (for developers)
                </summary>
                <div style={{
                  marginTop: '1rem',
                  fontSize: '13px',
                  fontFamily: 'monospace',
                  color: '#dc3545',
                  overflowX: 'auto'
                }}>
                  <strong>Error:</strong>
                  <pre style={{
                    marginTop: '0.5rem',
                    padding: '0.5rem',
                    backgroundColor: '#fff',
                    border: '1px solid #dee2e6',
                    borderRadius: '4px',
                    overflow: 'auto'
                  }}>
                    {this.state.error.toString()}
                  </pre>

                  {this.state.errorInfo && (
                    <>
                      <strong style={{ marginTop: '1rem', display: 'block' }}>
                        Component Stack:
                      </strong>
                      <pre style={{
                        marginTop: '0.5rem',
                        padding: '0.5rem',
                        backgroundColor: '#fff',
                        border: '1px solid #dee2e6',
                        borderRadius: '4px',
                        overflow: 'auto',
                        maxHeight: '200px'
                      }}>
                        {this.state.errorInfo.componentStack}
                      </pre>
                    </>
                  )}
                </div>
              </details>
            )}

            {/* Action Buttons */}
            <div style={{
              display: 'flex',
              gap: '1rem',
              justifyContent: 'center',
              flexWrap: 'wrap'
            }}>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: 'white',
                  backgroundColor: '#0d6efd',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#0b5ed7'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#0d6efd'}
              >
                🔄 Reload Page
              </button>

              <button
                onClick={this.handleGoHome}
                style={{
                  padding: '12px 24px',
                  fontSize: '16px',
                  fontWeight: 600,
                  color: '#0d6efd',
                  backgroundColor: 'transparent',
                  border: '2px solid #0d6efd',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = '#0d6efd';
                  e.currentTarget.style.color = 'white';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                  e.currentTarget.style.color = '#0d6efd';
                }}
              >
                🏠 Go to Home
              </button>
            </div>

            {/* Help Text */}
            <p style={{
              marginTop: '2rem',
              fontSize: '14px',
              color: '#6c757d'
            }}>
              If this problem persists, please contact the support team.
            </p>
          </div>
        </div>
      );
    }

    // Normally, just render children
    return this.props.children;
  }
}

export default ErrorBoundary;
