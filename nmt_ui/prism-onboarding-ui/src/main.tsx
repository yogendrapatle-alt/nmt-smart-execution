import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './layout.css'
import App from './App.tsx'
import { OnboardingProvider } from './context/OnboardingContext';
import ErrorBoundary from './components/ErrorBoundary';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <OnboardingProvider>
        <App />
      </OnboardingProvider>
    </ErrorBoundary>
  </StrictMode>,
)
