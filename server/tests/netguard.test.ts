import { describe, expect, it } from 'vitest';
import { allowedPeer } from '../src/netguard.js';

describe('only this computer and your tailnet can connect', () => {
  it('lets in loopback and Tailscale addresses', () => {
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '100.101.102.103', '100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0:ab12::1', '::ffff:100.90.1.2']) expect(allowedPeer(a, {}), a).toBe(true);
  });
  it('turns away the café Wi-Fi and everything else', () => {
    for (const a of ['192.168.1.20', '10.0.0.5', '172.16.3.4', '100.63.255.255', '100.128.0.1', '8.8.8.8', 'fe80::1', '2001:db8::1', undefined]) expect(allowedPeer(a as any, {}), String(a)).toBe(false);
  });
  it('ROOST_ALLOW_LAN=1 opts back in', () => {
    expect(allowedPeer('192.168.1.20', { ROOST_ALLOW_LAN: '1' })).toBe(true);
  });
});
