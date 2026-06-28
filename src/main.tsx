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
  <Sentry.ErrorBoundary fallback={({error}) => (
    <div style={{ color: 'red', padding: '20px', background: '#222', minHeight: '100vh', fontFamily: 'monospace' }}>
      <h2>应用发生错误，请刷新页面重试 (Application Error)</h2>
      <p style={{ marginTop: '20px', whiteSpace: 'pre-wrap' }}>{String(error?.message || error)}</p>
      <pre style={{ marginTop: '10px', fontSize: '12px' }}>{error?.stack}</pre>
    </div>
  )}>
    <AppWrapper>
      <App />
    </AppWrapper>
  </Sentry.ErrorBoundary>
);
