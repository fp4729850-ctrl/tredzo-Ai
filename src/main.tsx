import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

Sentry.init({
  dsn: import.meta.env['VITE_SENTRY_DSN'] as string | undefined,
  environment: import.meta.env.MODE,
});

createRoot(document.getElementById("root")!).render(
  <Sentry.ErrorBoundary 
    fallback={({ error }) => (
      <div style={{ backgroundColor: '#ff0000', color: '#ffffff', height: '100vh', padding: '20px', fontFamily: 'monospace', overflow: 'auto' }}>
        <h2>Application Error</h2>
        <pre>{error?.message || String(error)}</pre>
        <pre style={{ marginTop: '20px', fontSize: '12px' }}>{error?.stack}</pre>
      </div>
    )}
  >
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);
