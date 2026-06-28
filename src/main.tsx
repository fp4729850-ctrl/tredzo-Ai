import * as Sentry from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { AppWrapper } from "./components/common/PageMeta.tsx";
import "./index.css";

// Global fallback for unhandled errors that bypass ErrorBoundary
const renderRedScreen = (errorMsg: string, stack?: string) => {
  document.body.innerHTML = `
    <div style="background-color: #ff0000; color: #ffffff; height: 100vh; padding: 20px; font-family: monospace; overflow: auto; z-index: 99999; position: fixed; top: 0; left: 0; right: 0; bottom: 0;">
      <h2>FATAL GLOBAL ERROR</h2>
      <pre style="font-size: 16px; font-weight: bold;">${errorMsg}</pre>
      <pre style="margin-top: 20px; font-size: 12px; white-space: pre-wrap;">${stack || ''}</pre>
      <p style="margin-top: 20px;">Please take a screenshot of this and send it to the AI.</p>
    </div>
  `;
};

window.addEventListener('error', (event) => {
  renderRedScreen(event.message, event.error?.stack);
});

window.addEventListener('unhandledrejection', (event) => {
  renderRedScreen(String(event.reason), event.reason?.stack);
});

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
