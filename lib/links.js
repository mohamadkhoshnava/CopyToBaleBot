// lib/links — link rows, per-link settings, ownership and message mapping.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { now, parseJSON } from 'lib/util';
import { isAdmin } from 'lib/config';

export const TYPES = ['text', 'photo', 'video', 'animation', 'document', 'audio', 'voice', 'sticker', 'poll', 'location', 'contact'];

export const DEFAULTS = {
  dir: 'both', // both | t2b | b2t
  paused: false,
  autoUser: true, // swap @tgchannel <-> @balechannel (and t.me/ble.ir links)
  rules: [], // [{ f, t, d: both|t2b|b2t }]
  header_t2b: '', footer_t2b: '', header_b2t: '', footer_b2t: '',
  block: [], // posts containing any of these words are skipped
  nosync: true, // posts containing #nosync are skipped
  types: Object.fromEntries(TYPES.map((t) => [t, true])),
  edits: true,
  deletes: true,
  pins: true,
  replies: true,
  silent: false,
  stripLinks: false,
  stripMentions: false,
  bigNote: true,
  fmt: true,
};

export function S(link) {
  const s = parseJSON(link.settings, {});
  return { ...DEFAULTS, ...s, types: { ...DEFAULTS.types, ...(s.types || {}) } };
}

export async function saveSettings(id, s) {
  await db.run(sql`UPDATE links SET settings = ${JSON.stringify(s)} WHERE id = ${id}`);
}

export const dirOf = (sp) => (sp === 'tg' ? 't2b' : 'b2t');

export function allowed(link, dir) {
  const s = S(link);
  return !s.paused && (s.dir === 'both' || s.dir === dir);
}

export async function getLink(id) {
  return db.get(sql`SELECT * FROM links WHERE id = ${id}`);
}

export async function linkByChat(p, chatId) {
  return p === 'tg'
    ? db.get(sql`SELECT * FROM links WHERE tg_chat = ${chatId}`)
    : db.get(sql`SELECT * FROM links WHERE bale_chat = ${chatId}`);
}

export function chatOf(link, p) {
  return p === 'tg' ? link.tg_chat : link.bale_chat;
}

export function canManage(p, uid, link) {
  if (!link) return false;
  if (isAdmin(p, uid)) return true;
  return p === 'tg' ? Number(link.owner_tg) === Number(uid) : Number(link.owner_bale) === Number(uid);
}

export async function linksOf(p, uid) {
  return p === 'tg'
    ? db.all(sql`SELECT * FROM links WHERE owner_tg = ${uid} ORDER BY id`)
    : db.all(sql`SELECT * FROM links WHERE owner_bale = ${uid} ORDER BY id`);
}

export function linkTitle(link) {
  return `${link.tg_title || link.tg_chat} ⇄ ${link.bale_title || link.bale_chat}`;
}

// ---- message map -------------------------------------------------------------

// ---- Bale echo detection --------------------------------------------------------

const KIND_KEYS = ['photo', 'video', 'animation', 'audio', 'voice', 'video_note', 'sticker', 'document', 'location', 'contact', 'poll'];

function kindOf(m) {
  return KIND_KEYS.find((k) => m[k]) || 'text';
}

function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

// Content fingerprint of a Bale message, comparable between the sendX
// response and the channel update Bale later delivers for it. `kind` overrides
// the detected type (sendMediaGroup responses carry no media fields).
export function fingerprint(m, kind) {
  const body = String(m.text ?? m.caption ?? '').replace(/\s+/g, ' ').trim();
  return (kind || kindOf(m)) + ':' + hash(body);
}

// Record one destination message as soon as it's sent, so echoes and retries
// can see it even if later parts of the same post fail. `srcKind` is the kind
// of the content that was sent, used when the response lacks media fields.
export async function recordSent(linkId, sp, sc, sm, dp, dc, msg, role, srcKind) {
  let fp = null;
  if (dp === 'bale') {
    const k = kindOf(msg);
    fp = fingerprint(msg, k === 'text' && role === 'main' && srcKind && srcKind !== 'text' ? srcKind : k);
  }
  await db.run(sql`INSERT INTO msgmap (link_id, sp, sc, sm, dp, dc, dm, role, created_at, fp)
    VALUES (${linkId}, ${sp}, ${sc}, ${sm}, ${dp}, ${dc}, ${msg.message_id}, ${role}, ${now()}, ${fp})`);
}

// Is this Bale channel post the echo of a copy we sent? If so, mark it and fix
// the stored message id (Bale's sendX response id can differ from the real one).
export async function claimEcho(chatId, m) {
  const exact = await db.get(sql`SELECT id FROM msgmap WHERE dp = 'bale' AND dc = ${chatId} AND dm = ${m.message_id} LIMIT 1`);
  if (exact) {
    await db.run(sql`UPDATE msgmap SET echo = 1 WHERE id = ${exact.id}`);
    return true;
  }
  const fp = fingerprint(m);
  const id = m.message_id;
  const row = await db.get(sql`SELECT id FROM msgmap
    WHERE dp = 'bale' AND dc = ${chatId} AND echo = 0 AND created_at > ${now() - 600}
      AND (
        (fp = ${fp} AND dm BETWEEN ${id - 3} AND ${id + 3})
        OR (substr(fp, 1, instr(fp, ':')) = ${fp.slice(0, fp.indexOf(':') + 1)} AND dm BETWEEN ${id - 2} AND ${id + 2} AND created_at > ${now() - 90})
      )
    ORDER BY (fp = ${fp}) DESC, abs(dm - ${id}) LIMIT 1`);
  if (!row) return false;
  await db.run(sql`UPDATE msgmap SET dm = ${id}, echo = 1 WHERE id = ${row.id}`);
  return true;
}

// Counterpart of a message in either direction (main copy only).
export async function counterpart(p, chatId, msgId) {
  const a = await db.get(sql`SELECT dp AS p, dc AS c, dm AS m FROM msgmap
    WHERE sp = ${p} AND sc = ${chatId} AND sm = ${msgId} AND role = 'main' LIMIT 1`);
  if (a) return a;
  return db.get(sql`SELECT sp AS p, sc AS c, sm AS m FROM msgmap
    WHERE dp = ${p} AND dc = ${chatId} AND dm = ${msgId} LIMIT 1`);
}

export async function isOurCopy(p, chatId, msgId) {
  return !!(await db.get(sql`SELECT 1 AS x FROM msgmap WHERE dp = ${p} AND dc = ${chatId} AND dm = ${msgId} LIMIT 1`));
}

export async function bump(link, dir) {
  if (dir === 't2b') {
    await db.run(sql`UPDATE links SET t2b = t2b + 1, last_at = ${now()}, err_count = 0 WHERE id = ${link.id}`);
  } else {
    await db.run(sql`UPDATE links SET b2t = b2t + 1, last_at = ${now()}, err_count = 0 WHERE id = ${link.id}`);
  }
}
