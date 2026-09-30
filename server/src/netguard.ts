/** Who may connect at all (pre-launch, 2026-09-29). Roost listens on every
 *  interface so the phone can reach it over Tailscale, but that also opened it
 *  to anyone on the same café Wi-Fi -- and Roost runs commands by design. So a
 *  connection is accepted only from this computer or from the tailnet:
 *    - loopback: 127.0.0.0/8, ::1
 *    - Tailscale: 100.64.0.0/10 (CGNAT) and fd7a:115c:a1e0::/48
 *  ROOST_ALLOW_LAN=1 opts back into the old behaviour for people who know
 *  what they're doing (e.g. a trusted home network without Tailscale). */
export function allowedPeer(addr: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ROOST_ALLOW_LAN === '1') return true;
  if (!addr) return false;
  let a = addr.toLowerCase();
  if (a.startsWith('::ffff:')) a = a.slice(7); // IPv4-mapped IPv6
  if (a === '::1') return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (v4) {
    const [o1, o2] = [Number(v4[1]), Number(v4[2])];
    if (o1 === 127) return true;
    if (o1 === 100 && o2 >= 64 && o2 <= 127) return true;
    return false;
  }
  return a.startsWith('fd7a:115c:a1e0:');
}
