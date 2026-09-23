import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { GlobalErrorBanner } from './GlobalErrorBanner';
import './fonts.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <GlobalErrorBanner />
    <App />
  </ErrorBoundary>,
);
