// lib/fj — forced join: users must be members of the admin-chosen channel(s)
// on their own platform before they can use the bot.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { isAdmin, BOT_ID, channelUrl, PNAME } from 'lib/config';
import { kvJSON, kvSetJSON, logError } from 'lib/store';
import { getMember, getChat, call } from 'lib/platform';
import { now, esc } from 'lib/util';

const CACHE_SEC = 300;
const MEMBER = new Set(['creator', 'administrator', 'member']);

export async function fjConfig() {
  const c = await kvJSON('fj', {});
  return { on: c.on !== false, tg: c.tg || [], bale: c.bale || [] };
}

export async function saveFj(c) {
  await kvSetJSON('fj', c);
}

// Channels (on platform p) the user hasn't joined yet.
export async function missingChannels(p, uid) {
  const c = await fjConfig();
  if (!c.on || !c[p].length) return [];
  const out = [];
  for (const ch of c[p]) {
    try {
      const m = await getMember(p, ch.id, uid);
      const joined = MEMBER.has(m.status) || (m.status === 'restricted' && m.is_member !== false);
      if (!joined) out.push(ch);
    } catch (e) {
      // Bale answers getChatMember for non-members with this error instead of `left`.
      if (p === 'bale' && e?.code === 400 && /no such (group or )?user|user not found/i.test(e.description || '')) {
        out.push(ch);
        continue;
      }
      // Can't check (bot lost admin?) — don't lock users out; the admin sees the error log.
      await logError('fj:' + p + ':' + ch.id, e);
    }
  }
  return out;
}

// True if the user may proceed. Uses a short cache so every tap isn't an API call.
export async function fjOk(p, user) {
  if (isAdmin(p, user.uid)) return true;
  if (user.fj_at && now() - user.fj_at < CACHE_SEC) return true;
  const miss = await missingChannels(p, user.uid);
  if (miss.length) return false;
  await db.run(sql`UPDATE users SET fj_at = ${now()} WHERE platform = ${p} AND uid = ${user.uid}`);
  return true;
}

export async function resetFjCache(p, uid) {
  await db.run(sql`UPDATE users SET fj_at = 0 WHERE platform = ${p} AND uid = ${uid}`);
}

export async function fjPrompt(p, uid) {
  const miss = await missingChannels(p, uid);
  const list = miss.length ? miss : (await fjConfig())[p];
  const html = `🔒 <b>عضویت اجباری</b>\n\nبرای استفاده از ربات، اول عضو ${list.length > 1 ? 'کانال‌های' : 'کانال'} زیر شو و بعد روی «✅ عضو شدم» بزن:\n\n${list.map((c) => '• ' + esc(c.title)).join('\n')}`;
  const kb = [...list.map((c) => [{ text: '📢 ' + c.title, url: c.url }]), [{ text: '✅ عضو شدم', cb: 'fj' }]];
  return { html, kb };
}

// Resolve and validate a forced-join channel on platform p.
export async function resolveFjChannel(p, ref) {
  let chat;
  try {
    chat = await getChat(p, ref);
  } catch {
    return { error: `کانال در ${PNAME[p]} پیدا نشد. ربات باید ادمین آن کانال باشد.` };
  }
  try {
    const me = await getMember(p, chat.id, BOT_ID[p]);
    if (me.status !== 'administrator' && me.status !== 'creator') return { error: `ربات در «${esc(chat.title)}» ادمین نیست؛ برای بررسی عضویت کاربران باید ادمین باشد.` };
  } catch {
    return { error: `ربات در «${esc(chat.title)}» ادمین نیست.` };
  }
  let url = chat.username ? channelUrl(p, chat.username) : chat.invite_link;
  if (!url) {
    try { url = await call(p, 'exportChatInviteLink', { chat_id: chat.id }); } catch { /* no rights */ }
  }
  if (!url) return { error: 'کانال خصوصی است و ربات اجازه ساخت لینک دعوت ندارد. دسترسی «دعوت کاربران» را به ربات بده یا یوزرنیم بگذار.' };
  return { channel: { id: chat.id, title: chat.title || String(chat.id), url } };
}
