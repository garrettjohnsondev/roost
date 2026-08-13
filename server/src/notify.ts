import type { PocketConfig } from './config.js';

/** Push notifications via ntfy (https://ntfy.sh, self-hostable). Chosen over Web Push
 *  because Pocket serves plain HTTP over the tailnet, and service workers / Push API
 *  require a secure context — ntfy only needs an outbound POST from this server plus
 *  the ntfy app subscribed to the topic on the phone. The topic name is the only
 *  secret: anyone who knows it can see notification titles, so they contain session
 *  titles but never conversation content. */

let config: PocketConfig | null = null;

export function initNotify(c: PocketConfig): void {
  config = c;
}

export function notifyEnabled(): boolean {
  return Boolean(config?.notifications?.topic);
}

const lastSentPerKey = new Map<string, number>();

export function sendNotification(key: string, title: string, body: string, opts: { minIntervalMs?: number } = {}): void {
  const notifications = config?.notifications;
  if (!notifications?.topic) return;
  const minInterval = opts.minIntervalMs ?? 0;
  const last = lastSentPerKey.get(key) ?? 0;
  if (minInterval > 0 && Date.now() - last < minInterval) return;
  lastSentPerKey.set(key, Date.now());

  const url = `${(notifications.url || 'https://ntfy.sh').replace(/\/$/, '')}/${notifications.topic}`;
  void fetch(url, {
    method: 'POST',
    headers: { Title: title.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200), Priority: 'high', Tags: 'iphone' },
    body,
  }).catch((err) => {
    console.warn('[pocket] notification failed:', String(err?.message ?? err));
  });
}
