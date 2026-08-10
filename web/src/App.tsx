import { useEffect, useState } from 'react';
import { SessionList } from './SessionList';
import { ChatView } from './ChatView';
import { api } from './api';
import { useTheme } from './theme';
import type { PocketConfigResponse } from './types';

export function App() {
  const [config, setConfig] = useState<PocketConfigResponse | null>(null);
  const [activeSession, setActiveSession] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="center-note">Cannot reach the Pocket server: {error}</div>;
  if (!config) return <div className="center-note">Connecting…</div>;

  return activeSession ? (
    <ChatView
      sessionId={activeSession}
      config={config}
      onBack={() => setActiveSession(null)}
      onSwitch={setActiveSession}
    />
  ) : (
    <SessionList config={config} onOpen={setActiveSession} theme={theme} onThemeChange={setTheme} />
  );
}
