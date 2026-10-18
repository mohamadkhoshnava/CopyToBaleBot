// scripts/ipcheck — network diagnostics run inside Telegram Serverless.
// Not deployed: scripts/ipcheck.sh copies it to handlers/inline_query for one
// `tgcloud run` and removes it again. Reports the egress IPs the runtime uses
// (echo services, several rounds, since the pool may rotate), whether Bale is
// reachable from there, and the recent Bale/pump errors.
import { fetch, db } from 'sdk';
import { sql } from 'sdk/db';
import { BALE_API } from 'lib/config';

const TIMEOUT_MS = 6000;

const ECHO = [
  { name: 'ipify', url: 'https://api.ipify.org?format=json', parse: (t) => ({ ip: JSON.parse(t).ip }) },
  { name: 'icanhazip', url: 'https://icanhazip.com', parse: (t) => ({ ip: t.trim() }) },
  {
    name: 'cloudflare',
    url: 'https://1.1.1.1/cdn-cgi/trace',
    parse: (t) => {
      const kv = Object.fromEntries(t.trim().split('\n').map((l) => l.split('=')));
      return { ip: kv.ip, loc: kv.loc, colo: kv.colo };
    },
  },
  {
    name: 'ipinfo',
    url: 'https://ipinfo.io/json',
    parse: (t) => {
      const j = JSON.parse(t);
      return { ip: j.ip, org: j.org, loc: [j.city, j.country].filter(Boolean).join(', ') };
    },
  },
];

const redact = (s) => String(s ?? '').replace(/bot\d+:[\w-]+/g, 'bot<token>');

async function timed(url, opts = {}) {
  const t0 = Date.now();
  try {
    // The runtime may have no timers; then rely on the platform's own timeout.
    const res = typeof setTimeout === 'function'
      ? await Promise.race([
        fetch(url, opts),
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${TIMEOUT_MS}ms`)), TIMEOUT_MS)),
      ])
      : await fetch(url, opts);
    const text = await res.text();
    return { ok: true, status: res.status, text, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: redact(e.message || e), ms: Date.now() - t0 };
  }
}

async function echoRound() {
  return Promise.all(ECHO.map(async (s) => {
    const r = await timed(s.url);
    if (!r.ok) return { svc: s.name, error: r.error, ms: r.ms };
    try {
      return { svc: s.name, ...s.parse(r.text), ms: r.ms };
    } catch {
      return { svc: s.name, error: `unparsable (${r.status})`, ms: r.ms };
    }
  }));
}

async function baleProbe() {
  const out = {};
  const me = await timed(BALE_API + 'getMe', { method: 'POST', body: fetch.body.json({}) });
  out.getMe = me.ok
    ? { status: me.status, ms: me.ms, body: redact(me.text).slice(0, 200) }
    : { error: me.error, ms: me.ms };
  for (const url of ['https://tapi.bale.ai/', 'https://ble.ir/']) {
    const r = await timed(url);
    out[url] = r.ok ? { status: r.status, ms: r.ms } : { error: r.error, ms: r.ms };
  }
  return out;
}

export default async function (args) {
  const rounds = Math.min(Number(args?.rounds) || 3, 5);
  const samples = [];
  for (let i = 0; i < rounds; i++) samples.push(...await echoRound());

  const ips = {};
  for (const s of samples) {
    if (!s.ip) continue;
    const e = (ips[s.ip] ||= { hits: 0, via: [] });
    e.hits++;
    if (!e.via.includes(s.svc)) e.via.push(s.svc);
    if (s.org) e.org = s.org;
    if (s.loc && !e.loc) e.loc = s.loc;
    if (s.colo) e.colo = s.colo;
  }

  let errors = [];
  try {
    const rows = await db.all(sql`SELECT at, src, msg FROM errors
      WHERE src LIKE 'pump%' OR src LIKE 'bale%' OR msg LIKE '%Bale%' ORDER BY id DESC LIMIT 10`);
    errors = rows.map((r) => ({ at: new Date(r.at * 1000).toISOString(), src: r.src, msg: redact(r.msg).slice(0, 200) }));
  } catch (e) {
    errors = [{ error: redact(e.message) }];
  }

  return {
    egress_ips: ips,
    echo_failures: samples.filter((s) => s.error),
    bale: await baleProbe(),
    recent_bale_errors: errors,
    checked_at: new Date().toISOString(),
  };
}
