import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EditorialDashboard } from '@/components/editorial-dashboard';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <EditorialDashboard />
  </StrictMode>,
);
