import type { RoostConfig } from './config.js';

/** Push notifications via ntfy (https://ntfy.sh, self-hostable). Chosen over Web Push
 *  because Roost serves plain HTTP over the tailnet, and service workers / Push API
 *  require a secure context — ntfy only needs an outbound POST from this server plus
 *  the ntfy app subscribed to the topic on the phone. The topic name is the only
 *  secret: anyone who knows it can see notification titles, so they contain session
 *  titles but never conversation content. */

let config: RoostConfig | null = null;

export function initNotify(c: RoostConfig): void {
  config = c;
}

export function notifyEnabled(): boolean {
  return Boolean(config?.notifications?.topic);
}

const lastSentPerKey = new Map<string, number>();

export interface NotifyResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Deliver and report the outcome. Callers that need the truth (the settings
 *  "test" button) await this; chat paths use the fire-and-forget wrapper. */
export async function sendNotificationAsync(key: string, title: string, body: string, opts: { minIntervalMs?: number } = {}): Promise<NotifyResult> {
  const notifications = config?.notifications;
  if (!notifications?.topic) return { ok: false, error: 'notifications are not enabled' };
  const minInterval = opts.minIntervalMs ?? 0;
  const last = lastSentPerKey.get(key) ?? 0;
  if (minInterval > 0 && Date.now() - last < minInterval) return { ok: false, error: 'rate-limited' };
  lastSentPerKey.set(key, Date.now());

  const url = `${(notifications.url || 'https://ntfy.sh').replace(/\/$/, '')}/${notifications.topic}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Title: title.replace(/[^\x20-\x7e]/g, ' ').slice(0, 200), Priority: 'high', Tags: 'iphone' },
      body,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `ntfy answered ${res.status}` };
    return { ok: true, status: res.status };
  } catch (err: any) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

/** Fire-and-forget. Failures are logged, never thrown into a chat path. */
export function sendNotification(key: string, title: string, body: string, opts: { minIntervalMs?: number } = {}): void {
  void sendNotificationAsync(key, title, body, opts).then((r) => {
    if (!r.ok && r.error !== 'rate-limited' && r.error !== 'notifications are not enabled') {
      console.warn('[roost] notification failed:', r.error);
    }
  });
}
