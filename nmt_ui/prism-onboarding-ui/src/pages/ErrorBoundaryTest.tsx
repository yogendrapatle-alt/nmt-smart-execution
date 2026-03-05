import React, { useState } from 'react';

/**
 * ErrorBoundaryTest Component
 * 
 * Test page for verifying ErrorBoundary functionality.
 * Provides buttons to trigger different types of React errors.
 * 
 * Usage:
 *   Navigate to /error-boundary-test
 *   Click buttons to trigger errors and verify ErrorBoundary catches them
 * 
 * Note: This is a development/testing tool. Remove or hide in production.
 */
const ErrorBoundaryTest: React.FC = () => {
  const [shouldThrow, setShouldThrow] = useState(false);

  if (shouldThrow) {
    // This will be caught by ErrorBoundary
    throw new Error('🧪 Test Error: This is an intentional error to test ErrorBoundary!');
  }

  const triggerRenderError = () => {
    // Trigger error during render
    setShouldThrow(true);
  };

  const triggerTypeError = () => {
    // Trigger TypeError
    const obj: any = null;
    obj.property.nested.value = 'This will throw TypeError';
  };

  const triggerReferenceError = () => {
    // Trigger ReferenceError
    // @ts-ignore
    nonExistentFunction();
  };

  return (
    <div style={{
      padding: '2rem',
      maxWidth: '800px',
      margin: '0 auto'
    }}>
      {/* Header */}
      <div style={{
        marginBottom: '2rem',
        paddingBottom: '1rem',
        borderBottom: '2px solid #dee2e6'
      }}>
        <h1 style={{
          fontSize: '32px',
          fontWeight: 600,
          color: '#212529',
          marginBottom: '0.5rem'
        }}>
          🧪 Error Boundary Test
        </h1>
        <p style={{
          fontSize: '16px',
          color: '#6c757d'
        }}>
          Use these buttons to test that the ErrorBoundary properly catches and displays errors
        </p>
      </div>

      {/* Warning Box */}
      <div style={{
        padding: '1rem',
        backgroundColor: '#fff3cd',
        border: '1px solid #ffc107',
        borderRadius: '6px',
        marginBottom: '2rem'
      }}>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'start'
        }}>
          <span style={{ fontSize: '24px' }}>⚠️</span>
          <div>
            <strong style={{ color: '#856404' }}>Warning:</strong>
            <p style={{
              margin: '0.5rem 0 0',
              color: '#856404',
              fontSize: '14px'
            }}>
              Clicking these buttons will intentionally crash the React component tree.
              The ErrorBoundary should catch the error and display a fallback UI.
              You can reload the page to recover.
            </p>
          </div>
        </div>
      </div>

      {/* Test Buttons */}
      <div style={{
        display: 'grid',
        gap: '1rem'
      }}>
        <div style={{
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#212529',
            marginBottom: '0.75rem'
          }}>
            Test 1: Render Error
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#6c757d',
            marginBottom: '1rem'
          }}>
            Throws an error during component render phase
          </p>
          <button
            onClick={triggerRenderError}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#dc3545',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#bb2d3b'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#dc3545'}
          >
            💥 Trigger Render Error
          </button>
        </div>

        <div style={{
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#212529',
            marginBottom: '0.75rem'
          }}>
            Test 2: TypeError (Null Reference)
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#6c757d',
            marginBottom: '1rem'
          }}>
            Attempts to access property of null object
          </p>
          <button
            onClick={triggerTypeError}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#fd7e14',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#e56b0f'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#fd7e14'}
          >
            💥 Trigger TypeError
          </button>
        </div>

        <div style={{
          backgroundColor: 'white',
          border: '1px solid #dee2e6',
          borderRadius: '8px',
          padding: '1.5rem'
        }}>
          <h3 style={{
            fontSize: '18px',
            fontWeight: 600,
            color: '#212529',
            marginBottom: '0.75rem'
          }}>
            Test 3: ReferenceError
          </h3>
          <p style={{
            fontSize: '14px',
            color: '#6c757d',
            marginBottom: '1rem'
          }}>
            Calls a function that doesn't exist
          </p>
          <button
            onClick={triggerReferenceError}
            style={{
              padding: '12px 24px',
              fontSize: '16px',
              fontWeight: 600,
              color: 'white',
              backgroundColor: '#ffc107',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              transition: 'background-color 0.2s'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#ffb300'}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#ffc107'}
          >
            💥 Trigger ReferenceError
          </button>
        </div>
      </div>

      {/* Info Box */}
      <div style={{
        marginTop: '2rem',
        padding: '1rem',
        backgroundColor: '#d1ecf1',
        border: '1px solid #0dcaf0',
        borderRadius: '6px'
      }}>
        <div style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'start'
        }}>
          <span style={{ fontSize: '24px' }}>ℹ️</span>
          <div>
            <strong style={{ color: '#055160' }}>Expected Behavior:</strong>
            <ul style={{
              margin: '0.5rem 0 0',
              paddingLeft: '1.5rem',
              color: '#055160',
              fontSize: '14px'
            }}>
              <li>Error should be caught by ErrorBoundary</li>
              <li>User-friendly error message displayed</li>
              <li>Component stack trace available for developers</li>
              <li>"Reload Page" and "Go to Home" buttons appear</li>
              <li>No blank white page</li>
            </ul>
          </div>
        </div>
      </div>

      {/* Back Button */}
      <div style={{
        marginTop: '2rem',
        textAlign: 'center'
      }}>
        <a
          href="/"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            fontSize: '14px',
            color: '#0d6efd',
            textDecoration: 'none',
            border: '2px solid #0d6efd',
            borderRadius: '6px',
            transition: 'all 0.2s'
          }}
        >
          ← Back to Home
        </a>
      </div>
    </div>
  );
};

export default ErrorBoundaryTest;
