import { useEffect, useState } from 'react';
import { SessionList } from './SessionList';
import { ChatView } from './ChatView';
import { api } from './api';
import { useTheme } from './theme';
import type { RoostConfigResponse } from './types';

export function App() {
  const [config, setConfig] = useState<RoostConfigResponse | null>(null);
  // The open session lives in the URL (`?s=<id>`), not only in memory: a push
  // notification about a session can then open THAT session, the back button
  // works, and a reload does not dump you on the home screen mid-conversation.
  const [activeSession, setActiveSessionState] = useState<string | null>(() => readSessionParam());
  const setActiveSession = (id: string | null) => {
    setActiveSessionState(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('s', id);
    else url.searchParams.delete('s');
    window.history.pushState({ s: id }, '', url);
  };
  useEffect(() => {
    const onPop = () => setActiveSessionState(readSessionParam());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const [error, setError] = useState<string | null>(null);
  const [theme, setTheme] = useTheme();

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setError(String(e.message ?? e)));
  }, []);

  if (error) return <div className="center-note">Cannot reach the Roost server: {error}</div>;
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

function readSessionParam(): string | null {
  try {
    const s = new URL(window.location.href).searchParams.get('s');
    return s && /^[0-9a-f-]{8,64}$/i.test(s) ? s : null;
  } catch {
    return null;
  }
}
