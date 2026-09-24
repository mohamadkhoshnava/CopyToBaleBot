// lib/linking — identifying channels, verifying admin rights and pairing a
// Telegram channel with a Bale channel through a one-time code.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { BOT_ID, CODE_TTL, OTHER, PNAME } from 'lib/config';
import { getChat, getMember } from 'lib/platform';
import { now, randCode, esc } from 'lib/util';
import { statInc } from 'lib/store';
import { linkByChat } from 'lib/links';

// Channel reference from a DM message: chat_shared, a forward, @username, link or numeric id.
export function channelRef(m) {
  if (m.chat_shared) return m.chat_shared.chat_id;
  const fo = m.forward_origin;
  if (fo?.type === 'channel' && fo.chat) return fo.chat.id;
  if (m.forward_from_chat?.type === 'channel') return m.forward_from_chat.id;
  const t = (m.text || '').trim();
  let x = t.match(/(?:t\.me|telegram\.me|ble\.ir)\/([A-Za-z][A-Za-z0-9_]{3,})/i);
  if (x) return '@' + x[1];
  x = t.match(/^@?([A-Za-z][A-Za-z0-9_]{3,})$/);
  if (x) return '@' + x[1];
  if (/^-?\d{5,}$/.test(t)) return Number(t);
  return null;
}

// Where a forwarded channel post came from: { chatId, msgId } or null.
export function forwardSource(m) {
  const fo = m.forward_origin;
  if (fo?.type === 'channel' && fo.chat) return { chatId: fo.chat.id, msgId: fo.message_id };
  if (m.forward_from_chat?.type === 'channel' && m.forward_from_message_id) {
    return { chatId: m.forward_from_chat.id, msgId: m.forward_from_message_id };
  }
  return null;
}

const ADMIN = new Set(['creator', 'administrator']);

// Checks the chat is a channel where the bot (and optionally the user) is admin.
// -> { ok, chat, problems: [html] }
export async function verifyChannel(p, ref, uid) {
  let chat;
  try {
    chat = await getChat(p, ref);
  } catch {
    return { ok: false, problems: [`کانال پیدا نشد. مطمئن شو ربات عضو/ادمین کانال ${PNAME[p]} است و آدرس درست است.`] };
  }
  const problems = [];
  if (chat.type !== 'channel') problems.push('این چت کانال نیست؛ فقط کانال‌ها قابل اتصال هستند.');
  try {
    const me = await getMember(p, chat.id, BOT_ID[p]);
    if (!ADMIN.has(me.status)) problems.push(`ربات در کانال «${esc(chat.title)}» ادمین نیست.`);
    else if (p === 'tg' && me.can_post_messages === false) problems.push('ربات دسترسی «ارسال پیام» در کانال ندارد.');
  } catch {
    problems.push(`ربات در کانال «${esc(chat.title)}» ادمین نیست.`);
  }
  if (uid) {
    try {
      const u = await getMember(p, chat.id, uid);
      if (!ADMIN.has(u.status)) problems.push('شما ادمین این کانال نیستید.');
    } catch {
      problems.push('نتوانستم ادمین بودن شما در این کانال را بررسی کنم.');
    }
  }
  return { ok: problems.length === 0, chat, problems };
}

export async function createCode(p, chat, uid) {
  await db.run(sql`DELETE FROM codes WHERE platform = ${p} AND chat_id = ${chat.id}`);
  let code;
  for (let i = 0; i < 5; i++) {
    code = 'CTB-' + randCode(6);
    const r = await db.run(sql`INSERT INTO codes (code, platform, chat_id, title, username, owner_uid, created_at)
      VALUES (${code}, ${p}, ${chat.id}, ${chat.title ?? null}, ${chat.username ?? null}, ${uid}, ${now()})
      ON CONFLICT(code) DO NOTHING`);
    if (r.rowsAffected) return code;
  }
  throw new Error('could not allocate code');
}

export async function getCode(code) {
  const r = await db.get(sql`SELECT * FROM codes WHERE code = ${code}`);
  if (!r || r.created_at < now() - CODE_TTL) return null;
  return r;
}

// Pair the code's channel with `chat` on platform `p`.
// -> { ok, link } | { ok: false, error }
export async function linkWithCode(codeRow, p, chat, ownerUid) {
  if (codeRow.platform === p) {
    return { ok: false, error: `این کد برای کانال ${PNAME[p]} ساخته شده؛ باید آن را در ${PNAME[OTHER[p]]} استفاده کنی.` };
  }
  if (await linkByChat(p, chat.id)) return { ok: false, error: `کانال «${esc(chat.title)}» قبلاً به کانال دیگری متصل شده است.` };
  if (await linkByChat(codeRow.platform, codeRow.chat_id)) {
    return { ok: false, error: `کانال «${esc(codeRow.title)}» در این فاصله به کانال دیگری متصل شده است.` };
  }
  const tg = p === 'tg' ? { id: chat.id, title: chat.title, user: chat.username, owner: ownerUid } : { id: codeRow.chat_id, title: codeRow.title, user: codeRow.username, owner: codeRow.owner_uid };
  const bl = p === 'bale' ? { id: chat.id, title: chat.title, user: chat.username, owner: ownerUid } : { id: codeRow.chat_id, title: codeRow.title, user: codeRow.username, owner: codeRow.owner_uid };
  const r = await db.run(sql`INSERT INTO links (tg_chat, bale_chat, tg_title, tg_user, bale_title, bale_user, owner_tg, owner_bale, settings, created_at)
    VALUES (${tg.id}, ${bl.id}, ${tg.title ?? null}, ${tg.user ?? null}, ${bl.title ?? null}, ${bl.user ?? null}, ${tg.owner ?? null}, ${bl.owner ?? null}, '{}', ${now()})
    ON CONFLICT DO NOTHING RETURNING *`);
  const link = r.rows[0];
  if (!link) return { ok: false, error: 'یکی از کانال‌ها همین الان متصل شد؛ دوباره امتحان کن.' };
  await db.run(sql`DELETE FROM codes WHERE code = ${codeRow.code}`);
  await statInc('links_new');
  return { ok: true, link };
}

export async function setOwner(link, p, uid) {
  if (p === 'tg') await db.run(sql`UPDATE links SET owner_tg = ${uid} WHERE id = ${link.id}`);
  else await db.run(sql`UPDATE links SET owner_bale = ${uid} WHERE id = ${link.id}`);
}

export async function refreshTitles(link) {
  for (const p of ['tg', 'bale']) {
    try {
      const c = await getChat(p, p === 'tg' ? link.tg_chat : link.bale_chat);
      if (p === 'tg') await db.run(sql`UPDATE links SET tg_title = ${c.title ?? null}, tg_user = ${c.username ?? null} WHERE id = ${link.id}`);
      else await db.run(sql`UPDATE links SET bale_title = ${c.title ?? null}, bale_user = ${c.username ?? null} WHERE id = ${link.id}`);
    } catch { /* keep cached values */ }
  }
}
