// lib/store — kv, counters, error log, sessions, users.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { now, day, errText, parseJSON } from 'lib/util';

export async function kvGet(k, fallback = null) {
  const r = await db.get(sql`SELECT v FROM kv WHERE k = ${k}`);
  return r && r.v != null ? r.v : fallback;
}

export async function kvSet(k, v) {
  await db.run(sql`INSERT INTO kv (k, v) VALUES (${k}, ${v == null ? null : String(v)})
    ON CONFLICT(k) DO UPDATE SET v = excluded.v`);
}

export async function kvDel(k) {
  await db.run(sql`DELETE FROM kv WHERE k = ${k}`);
}

export async function kvJSON(k, fallback) {
  return parseJSON(await kvGet(k), fallback);
}

export async function kvSetJSON(k, v) {
  await kvSet(k, JSON.stringify(v));
}

// Atomic lease: succeeds only if the stored ms-timestamp is in the past.
export async function acquire(k, untilMs) {
  await db.run(sql`INSERT INTO kv (k, v) VALUES (${k}, '0') ON CONFLICT(k) DO NOTHING`);
  const r = await db.run(sql`UPDATE kv SET v = ${String(untilMs)}
    WHERE k = ${k} AND CAST(v AS INTEGER) < ${Date.now()}`);
  return r.rowsAffected > 0;
}

export async function statInc(k, n = 1) {
  await db.run(sql`INSERT INTO stats (day, k, n) VALUES (${day()}, ${k}, ${n})
    ON CONFLICT(day, k) DO UPDATE SET n = n + excluded.n`);
}

export async function logError(src, e) {
  console.error(src, e);
  try {
    await db.run(sql`INSERT INTO errors (at, src, msg) VALUES (${now()}, ${src}, ${errText(e)})`);
    await statInc('errors');
  } catch (e2) {
    console.error('logError failed', e2);
  }
}

// Returns true the first time a key is seen.
export async function claimOnce(k) {
  const r = await db.run(sql`INSERT INTO claims (k, at) VALUES (${k}, ${now()}) ON CONFLICT(k) DO NOTHING`);
  return r.rowsAffected > 0;
}

// ---- sessions --------------------------------------------------------------

const SESSION_TTL = 3600;

export async function getSession(p, uid) {
  const r = await db.get(sql`SELECT state, data, at FROM sessions WHERE k = ${p + ':' + uid}`);
  if (!r || r.at < now() - SESSION_TTL) return null;
  return { state: r.state, data: parseJSON(r.data, {}) };
}

export async function setSession(p, uid, state, data = {}) {
  await db.run(sql`INSERT INTO sessions (k, state, data, at) VALUES (${p + ':' + uid}, ${state}, ${JSON.stringify(data)}, ${now()})
    ON CONFLICT(k) DO UPDATE SET state = excluded.state, data = excluded.data, at = excluded.at`);
}

export async function clearSession(p, uid) {
  await db.run(sql`DELETE FROM sessions WHERE k = ${p + ':' + uid}`);
}

// ---- users -----------------------------------------------------------------

// Upserts the user and returns the row plus `isNew`.
export async function touchUser(p, from) {
  const t = now();
  const existing = await db.get(sql`SELECT id FROM users WHERE platform = ${p} AND uid = ${from.id}`);
  const r = await db.run(sql`INSERT INTO users (platform, uid, first_name, username, joined_at, last_seen)
    VALUES (${p}, ${from.id}, ${from.first_name ?? null}, ${from.username ?? null}, ${t}, ${t})
    ON CONFLICT(platform, uid) DO UPDATE SET first_name = excluded.first_name,
      username = excluded.username, last_seen = excluded.last_seen, blocked = 0
    RETURNING *`);
  const row = r.rows[0];
  if (!existing) await statInc('new_' + p);
  return { ...row, isNew: !existing };
}

export async function markBlocked(p, uid) {
  await db.run(sql`UPDATE users SET blocked = 1 WHERE platform = ${p} AND uid = ${uid}`);
}
