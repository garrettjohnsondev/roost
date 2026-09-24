import type express from 'express';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './config.js';

/** The rescue page — the way out that does not depend on the thing that broke.
 *
 *  2026-09-24: a bad build crashed every session in the app, all day. The app's
 *  own crash screen lived inside the app that crashed, the log was on a Mac
 *  nobody was sitting at, and the fix needed a terminal. This page is served by
 *  the server as one self-contained string — no bundle, no fonts, no shared
 *  stylesheet, nothing from web/dist — so a broken front end cannot take it
 *  down. From the phone it can: roll back to the previous release, restart the
 *  server, sign in to Claude, start a fresh session, and show what went wrong.
 *
 *  Its actions go through /api/rescue/*, behind the same token and cross-origin
 *  checks as the rest of the API. */

// ---- recent problems ---------------------------------------------------------

const ring: string[] = [];
const RING_MAX = 200;
/** Called for every warn/error line the server writes. */
export function noteLogLine(line: string): void {
  ring.push(line.slice(0, 600));
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
}

function releaseMeta(which: 'current' | 'previous'): { commit: string; subject: string; at: string } | null {
  try {
    return JSON.parse(readFileSync(join(repoRoot, '.roost-data', 'releases', which, 'meta.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Where the front end is served from: the current RELEASE when there is one,
 *  so a build that has not passed the smoke check never reaches the phone. */
export function webRoot(): string {
  const released = join(repoRoot, '.roost-data', 'releases', 'current', 'web');
  return existsSync(join(released, 'index.html')) ? released : join(repoRoot, 'web', 'dist');
}

const startedAt = Date.now();

function runService(command: 'rollback' | 'restart'): void {
  // Detached, in its own process group: it restarts the very server that
  // started it, and must outlive it.
  const child = spawn(process.execPath, [join(repoRoot, 'scripts', 'service.mjs'), command], {
    cwd: repoRoot, detached: true, stdio: 'ignore',
  });
  child.unref();
}

export function registerRescue(app: express.Express, deps: {
  sessions: () => Array<{ id: string; title: string; agent: string; cwd: string; state: string }>;
}): void {
  app.get('/rescue', (_req, res) => {
    res.set('cache-control', 'no-store');
    res.type('html').send(RESCUE_HTML);
  });

  app.get('/api/rescue/status', (_req, res) => {
    res.json({
      pid: process.pid,
      upSince: startedAt,
      release: { current: releaseMeta('current'), previous: releaseMeta('previous') },
      serving: webRoot().includes('releases') ? 'release' : 'build',
      sessions: deps.sessions(),
      recent: ring.slice(-40),
    });
  });

  app.post('/api/rescue/rollback', (_req, res) => {
    if (!releaseMeta('previous')) return res.status(409).json({ error: 'there is no previous release to go back to' });
    console.warn('[roost] rescue: rollback requested from the rescue page');
    res.json({ ok: true, to: releaseMeta('previous') });
    setTimeout(() => runService('rollback'), 200);
  });

  app.post('/api/rescue/restart', (_req, res) => {
    console.warn('[roost] rescue: restart requested from the rescue page');
    res.json({ ok: true });
    setTimeout(() => runService('restart'), 200);
  });
}

// ---- the page ------------------------------------------------------------------
// Everything inline. System fonts. No reference to /assets, /fonts or /crew.

const RESCUE_HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#0f1729">
<title>Roost — rescue</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #0f1729; color: #e9edf6; font: 16px/1.5 system-ui, -apple-system, sans-serif; padding: 18px 16px 40px; max-width: 640px; margin: 0 auto; }
  h1 { font: 700 22px/1.2 ui-monospace, Menlo, monospace; letter-spacing: .06em; margin: 4px 0 2px; }
  .sub { color: #93a3c6; font-size: 14px; margin: 0 0 18px; }
  section { background: #131c33; border: 1px solid #2b3a63; box-shadow: 3px 3px 0 #0a1020; border-radius: 2px; padding: 14px; margin: 0 0 14px; }
  h2 { font: 700 13px/1 ui-monospace, Menlo, monospace; letter-spacing: .08em; text-transform: uppercase; color: #f4b63f; margin: 0 0 10px; }
  p { margin: 6px 0; }
  .dim { color: #93a3c6; font-size: 14px; }
  button, a.btn { display: inline-block; font: inherit; font-weight: 700; border: 1px solid #38477a; background: #1c2740; color: #e9edf6; padding: 11px 14px; border-radius: 2px; margin: 6px 6px 0 0; text-decoration: none; min-height: 44px; }
  button.primary { background: #f4b63f; color: #0f1729; border-color: #f4b63f; }
  button.danger { border-color: #e5534b; color: #ffb3ae; }
  button:disabled { opacity: .5; }
  input { width: 100%; font: 15px ui-monospace, Menlo, monospace; background: #1c2740; color: #e9edf6; border: 1px solid #38477a; border-radius: 2px; padding: 11px; margin-top: 6px; }
  .row { display: flex; justify-content: space-between; gap: 10px; align-items: center; border-top: 1px solid #2b3a63; padding: 8px 0; }
  .row:first-child { border-top: 0; }
  .row b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log { font: 12px/1.45 ui-monospace, Menlo, monospace; color: #c8d4ea; white-space: pre-wrap; word-break: break-word; max-height: 320px; overflow: auto; background: #0b1224; padding: 10px; border: 1px solid #2b3a63; }
  .ok { color: #6ee7b7; } .bad { color: #ffb3ae; }
  #msg { position: sticky; top: 0; background: #f4b63f; color: #0f1729; font-weight: 700; padding: 10px 12px; margin: -4px 0 14px; display: none; }
</style>
</head><body>
<h1>ROOST · RESCUE</h1>
<p class="sub">This page works even when the app does not. <a href="/" style="color:#f4b63f">Back to Roost</a></p>
<div id="msg"></div>

<section><h2>Server</h2><div id="server">Checking…</div></section>

<section><h2>Version</h2><div id="release"></div></section>

<section><h2>Claude</h2><div id="claude">Checking…</div></section>

<section><h2>Sessions</h2><div id="sessions"></div></section>

<section><h2>Recent problems</h2><div id="recent" class="log">—</div></section>

<script>
(function () {
  var token = new URLSearchParams(location.search).get('token');
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ 'content-type': 'application/json' }, opts.headers || {}, token ? { authorization: 'Bearer ' + token } : {});
    return fetch(path, opts).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status)); return d; }); });
  }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function say(t) { var m = $('msg'); m.textContent = t; m.style.display = t ? 'block' : 'none'; }
  function ago(ms) { var s = Math.round((Date.now() - ms) / 1000); return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + 'm' : Math.round(s / 3600) + 'h'; }

  function load() {
    return api('/api/rescue/status').then(function (s) {
      $('server').innerHTML = '<p class="ok">Up — running for ' + ago(s.upSince) + ' (pid ' + s.pid + ').</p>' +
        '<button class="danger" id="restart">Restart the server</button>';
      $('restart').onclick = function () { if (confirm('Restart the Roost server? Open sessions are restored after.')) act('/api/rescue/restart', 'Restarting… this page reconnects by itself.'); };
      var c = s.release.current, p = s.release.previous;
      $('release').innerHTML =
        (c ? '<p>Live: <b>' + esc(c.commit) + '</b> — ' + esc(c.subject) + '<br><span class="dim">released ' + esc(new Date(c.at).toLocaleString()) + '</span></p>'
           : '<p class="dim">No release recorded yet — serving the latest build directly.</p>') +
        (p ? '<p class="dim">Previous: ' + esc(p.commit) + ' — ' + esc(p.subject) + '</p><button class="primary" id="rollback">Roll back to the previous version</button>'
           : '<p class="dim">No previous version kept yet — the next deploy creates one.</p>');
      if (p) $('rollback').onclick = function () { if (confirm('Roll back to ' + p.commit + '? The server restarts; the current version is kept so you can come back to it.')) act('/api/rescue/rollback', 'Rolling back… the server restarts, then this page reloads.'); };
      $('sessions').innerHTML = s.sessions.length ? s.sessions.map(function (x) {
        return '<div class="row"><div style="min-width:0"><b>' + esc(x.title) + '</b><span class="dim">' + esc(x.agent) + ' · ' + esc(x.cwd.split('/').pop()) + ' · ' + esc(x.state) + '</span></div>' +
          '<div style="flex-shrink:0"><a class="btn" href="/?s=' + encodeURIComponent(x.id) + '">Open</a><button data-fresh="' + esc(x.id) + '">Start fresh</button></div></div>';
      }).join('') : '<p class="dim">No open sessions.</p>';
      Array.prototype.forEach.call(document.querySelectorAll('[data-fresh]'), function (b) {
        var x = s.sessions.filter(function (y) { return y.id === b.getAttribute('data-fresh'); })[0];
        b.onclick = function () {
          b.disabled = true;
          api('/api/sessions', { method: 'POST', body: JSON.stringify({ agent: x.agent, cwd: x.cwd, title: ('Fresh start — ' + x.title).slice(0, 80) }) })
            .then(function (d) { location.href = '/?s=' + encodeURIComponent(d.id || (d.session && d.session.id)); })
            .catch(function (e) { b.disabled = false; say('Could not start a session: ' + e.message); });
        };
      });
      $('recent').textContent = s.recent.length ? s.recent.slice().reverse().join('\\n') : 'Nothing logged since the server started.';
    }).catch(function (e) {
      $('server').innerHTML = '<p class="bad">The server is not answering (' + esc(e.message) + ').</p><p class="dim">If it was just restarted, give it ten seconds. If it stays down, the Mac may be asleep or offline — this page cannot reach it either.</p>';
    });
  }

  function act(path, message) {
    say(message);
    api(path, { method: 'POST' }).catch(function (e) { say('Failed: ' + e.message); });
    // The server goes away and comes back; poll until it answers again.
    var tries = 0, wentDown = false;
    var t = setInterval(function () {
      tries++;
      fetch('/api/rescue/status', { cache: 'no-store', headers: token ? { authorization: 'Bearer ' + token } : {} })
        .then(function (r) { if (r.ok && (wentDown || tries > 8)) { clearInterval(t); say(''); load(); } })
        .catch(function () { wentDown = true; });
      if (tries > 60) { clearInterval(t); say('The server did not come back within a minute. Try again, or check the Mac.'); }
    }, 1000);
  }

  function claude() {
    api('/api/auth/claude').then(function (a) {
      var who = a.using === 'roost-token' ? 'Using Roost’s own sign-in.' : a.using === 'mac-login' ? 'Using this Mac’s login.' : '<span class="bad">Not signed in — Claude sessions will fail.</span>';
      $('claude').innerHTML = '<p>' + who + (a.lastFailure ? ' <span class="bad">A recent turn failed to sign in.</span>' : '') + '</p><button id="signin">Sign in to Claude</button><div id="flow"></div>';
      $('signin').onclick = function () {
        $('flow').innerHTML = '<p class="dim">Starting the sign-in on your Mac…</p>';
        api('/api/auth/claude/start', { method: 'POST' }).then(function (f) {
          $('flow').innerHTML = '<p>1. <a class="btn" target="_blank" rel="noopener" href="' + esc(f.url) + '">Open the sign-in page</a></p>' +
            '<p>2. Sign in and approve, then paste the code it shows:</p><input id="code" autocomplete="one-time-code" autocapitalize="off" spellcheck="false" placeholder="Paste the code"><button class="primary" id="finish">Finish</button>';
          $('finish').onclick = function () {
            $('finish').disabled = true;
            api('/api/auth/claude/finish', { method: 'POST', body: JSON.stringify({ flowId: f.flowId, code: $('code').value.trim() }) })
              .then(function () { $('flow').innerHTML = '<p class="ok">Signed in.</p>'; claude(); })
              .catch(function (e) { $('flow').innerHTML = '<p class="bad">' + esc(e.message) + '</p>'; });
          };
        }).catch(function (e) { $('flow').innerHTML = '<p class="bad">' + esc(e.message) + '</p>'; });
      };
    }).catch(function () { $('claude').innerHTML = '<p class="dim">Unavailable while the server is down.</p>'; });
  }

  load(); claude();
})();
</script>
</body></html>`;
