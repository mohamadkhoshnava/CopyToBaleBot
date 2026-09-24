// lib/dm — private chat with the bot (same flow on Telegram and Bale).
import { CODE_RE, PNAME, OTHER, isAdmin } from 'lib/config';
import {
  touchUser, getSession, setSession, clearSession, kvSetJSON, claimOnce,
} from 'lib/store';
import { send, trySend } from 'lib/platform';
import { fjOk, fjPrompt } from 'lib/fj';
import {
  mainScreen, helpScreen, newScreen, codeScreen, linkCreatedHtml, listScreen,
  rulesScreen, footerScreen, blockScreen, backMain, linkScreen,
} from 'lib/screens';
import {
  linksOf, linkByChat, getLink, canManage, S, saveSettings, counterpart, linkTitle,
} from 'lib/links';
import {
  channelRef, forwardSource, verifyChannel, createCode, getCode, linkWithCode, setOwner,
} from 'lib/linking';
import { userStatsHtml, adminStatsHtml } from 'lib/stats';
import { adminScreen, adminInput } from 'lib/admin';
import { esc, now } from 'lib/util';

const reply = (p, uid, s) => send(p, uid, s.html, { kb: s.kb });
const cancelKb = (cb) => [[{ text: '❌ انصراف', cb }]];

// Telegram's native channel picker; asks Telegram to add the bot with the rights it needs.
// The user's required rights must be a superset of the bot's, or sendMessage fails
// with USER_RIGHTS_MISSING.
const RIGHTS = {
  is_anonymous: false, can_manage_chat: false, can_delete_messages: true, can_manage_video_chats: false,
  can_restrict_members: false, can_promote_members: false, can_change_info: false, can_invite_users: false,
  can_post_stories: false, can_edit_stories: false, can_delete_stories: false,
  can_post_messages: true, can_edit_messages: true,
};
const PICK_KB = {
  keyboard: [
    [{
      text: '📢 انتخاب کانال',
      request_chat: {
        request_id: 1,
        chat_is_channel: true,
        request_title: true,
        request_username: true,
        user_administrator_rights: RIGHTS,
        bot_administrator_rights: RIGHTS,
      },
    }],
    [{ text: '❌ انصراف' }],
  ],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export async function showMain(p, uid, from) {
  return reply(p, uid, mainScreen(p, uid, from?.first_name));
}

export async function startNew(p, uid, mode = 'new', code = null) {
  await setSession(p, uid, 'pick', { mode, code });
  if (mode === 'new') await reply(p, uid, newScreen(p));
  if (p === 'tg') await send(p, uid, 'یا از دکمهٔ زیر کانال را انتخاب کن 👇', { markup: PICK_KB });
}

export async function onDM(p, m) {
  if (!m.from || m.from.is_bot) return;
  const uid = m.from.id;
  const user = await touchUser(p, m.from);
  if (user.banned) return;
  const text = (m.text || '').trim();
  const cmd = text.startsWith('/') ? text.split(/[\s@]/)[0].toLowerCase() : null;

  if (cmd === '/cancel' || text === '❌ انصراف') {
    await clearSession(p, uid);
    await send(p, uid, '❌ لغو شد.', p === 'tg' ? { markup: { remove_keyboard: true } } : {});
    return showMain(p, uid, m.from);
  }
  if (!(await fjOk(p, user))) {
    const s = await fjPrompt(p, uid);
    return send(p, uid, s.html, { kb: s.kb });
  }
  if (cmd === '/start' || cmd === '/menu') {
    await clearSession(p, uid);
    return showMain(p, uid, m.from);
  }
  if (cmd === '/help') return reply(p, uid, helpScreen(p));
  if (cmd === '/new') return startNew(p, uid);
  if (cmd === '/links') return reply(p, uid, listScreen(await linksOf(p, uid), 0));
  if (cmd === '/stats') {
    const html = isAdmin(p, uid) ? await adminStatsHtml() : await userStatsHtml(p, uid);
    return send(p, uid, html, { kb: backMain });
  }
  if (cmd === '/admin' && isAdmin(p, uid)) return reply(p, uid, adminScreen());

  const up = text.toUpperCase();
  if (CODE_RE.test(up)) return codeInDM(p, uid, up);

  const ses = await getSession(p, uid);
  if (ses) return sessionInput(p, uid, m, ses);

  if (forwardSource(m)) return forwardedPost(p, uid, m);
  return showMain(p, uid, m.from);
}

async function codeInDM(p, uid, code) {
  const row = await getCode(code);
  if (!row) return send(p, uid, '❌ کد نامعتبر است یا منقضی شده. از «➕ اتصال کانال جدید» یک کد تازه بگیر.', { kb: backMain });
  if (row.platform === p) {
    return send(p, uid, `ℹ️ این کد برای کانال ${PNAME[p]} «${esc(row.title)}» ساخته شده؛ باید آن را در <b>${PNAME[OTHER[p]]}</b> استفاده کنی (داخل کانال یا پیوی ربات).`, { kb: backMain });
  }
  await send(p, uid, `🔑 کد معتبر است — کانال ${PNAME[row.platform]}: <b>${esc(row.title)}</b>\n\nحالا کانال <b>${PNAME[p]}</b> را معرفی کن:\n• یک پست از آن فوروارد کن\n• یا یوزرنیم/آیدی عددی آن را بفرست\n\n(ربات و شما باید در آن کانال ادمین باشید.)`, { kb: cancelKb('x') });
  return startNew(p, uid, 'code', code);
}

export async function pickChannel(p, uid, m, ses) {
  const ref = channelRef(m);
  if (ref == null) {
    return send(p, uid, '❗️ یک پست از کانال فوروارد کن یا یوزرنیم/آیدی عددی کانال را بفرست.', { kb: cancelKb('x') });
  }
  if (p === 'tg') await send(p, uid, '⏳ در حال بررسی کانال...', { markup: { remove_keyboard: true } });
  const v = await verifyChannel(p, ref, uid);
  if (!v.ok) {
    return send(p, uid, `❌ ${v.problems.join('\n❌ ')}\n\nبعد از رفع مشکل، دوباره کانال را بفرست.`, { kb: cancelKb('x') });
  }
  const existing = await linkByChat(p, v.chat.id);
  if (existing) {
    await setOwner(existing, p, uid);
    await clearSession(p, uid);
    return send(p, uid, `ℹ️ کانال «${esc(v.chat.title)}» قبلاً در اتصال <b>${esc(linkTitle(existing))}</b> است. چون ادمین آن هستی، دسترسی مدیریت این اتصال برایت فعال شد.`,
      { kb: [[{ text: '⚙️ مدیریت اتصال', cb: 'lk:' + existing.id }], ...backMain] });
  }
  if (ses.data.mode === 'code') {
    const row = await getCode(ses.data.code);
    await clearSession(p, uid);
    if (!row) return send(p, uid, '❌ کد منقضی شده است. دوباره شروع کن.', { kb: backMain });
    const r = await linkWithCode(row, p, v.chat, uid);
    if (!r.ok) return send(p, uid, '❌ ' + r.error, { kb: backMain });
    const s = linkCreatedHtml(r.link);
    await trySend(row.platform, row.owner_uid, s.html, { kb: s.kb });
    return reply(p, uid, s);
  }
  const code = await createCode(p, v.chat, uid);
  await clearSession(p, uid);
  return reply(p, uid, codeScreen(p, v.chat, code));
}

async function sessionInput(p, uid, m, ses) {
  if (ses.state === 'pick') return pickChannel(p, uid, m, ses);
  if (ses.state.startsWith('a')) {
    if (!isAdmin(p, uid)) return clearSession(p, uid);
    const s = await adminInput(p, uid, m, ses);
    if (s) return reply(p, uid, s);
    return;
  }
  const link = await getLink(ses.data.id);
  if (!link || !canManage(p, uid, link)) {
    await clearSession(p, uid);
    return showMain(p, uid, m.from);
  }
  const text = (m.text || m.caption || '').trim();
  if (!text) return send(p, uid, '❗️ لطفاً متن بفرست.', { kb: cancelKb('lk:' + link.id) });
  const s = S(link);

  if (ses.state === 'rule') {
    let added = 0;
    for (const line of text.split('\n')) {
      const mm = line.match(/^(.+?)\s*(?:=>|->|→)\s*(.*)$/);
      if (!mm || !mm[1].trim() || s.rules.length >= 40) continue;
      s.rules.push({ f: mm[1].trim(), t: mm[2].trim(), d: ses.data.d });
      added++;
    }
    if (!added) return send(p, uid, '❗️ فرمت درست نیست. مثال:\n<code>@oldchannel => @newchannel</code>', { kb: cancelKb('lk:' + link.id + ':rl') });
    await saveSettings(link.id, s);
    await clearSession(p, uid);
    const scr = rulesScreen(await getLink(link.id));
    scr.html = `✅ ${added} قانون اضافه شد.\n\n` + scr.html;
    return reply(p, uid, scr);
  }
  if (ses.state === 'foot') {
    const key = ses.data.key;
    if (!/^(header|footer)_(t2b|b2t)$/.test(key)) return clearSession(p, uid);
    s[key] = text === '-' ? '' : text.slice(0, 600);
    await saveSettings(link.id, s);
    await clearSession(p, uid);
    return reply(p, uid, footerScreen(await getLink(link.id)));
  }
  if (ses.state === 'block') {
    s.block = [...new Set(text.split(/[\n,،]+/).map((w) => w.trim()).filter(Boolean))].slice(0, 100);
    await saveSettings(link.id, s);
    await clearSession(p, uid);
    return reply(p, uid, blockScreen(await getLink(link.id)));
  }
  await clearSession(p, uid);
  return reply(p, uid, linkScreen(link));
}

// A channel post forwarded to the bot: offer to resend or delete it on both sides.
async function forwardedPost(p, uid, m) {
  const src = forwardSource(m);
  const link = await linkByChat(p, src.chatId);
  if (!link || !canManage(p, uid, link)) {
    return send(p, uid, 'ℹ️ این پست از کانالی است که در اتصال‌های شما نیست.', { kb: backMain });
  }
  const o = OTHER[p];
  const title = esc(p === 'tg' ? link.tg_title : link.bale_title);
  const item = { link_id: link.id, sp: p, sc: src.chatId, sm: src.msgId, msg: m, at: now() };

  // Album items arrive one by one: collect them and prompt once for the whole album.
  if (m.media_group_id) {
    const gid = String(m.media_group_id);
    await kvSetJSON(`fwa:${p}:${uid}:${gid}:${src.msgId}`, item);
    if (!(await claimOnce(`fwa:${p}:${uid}:${gid}`))) return;
    return send(p, uid, `🖼 آلبوم از کانال <b>${title}</b> دریافت شد.\n\nچه کاری انجام شود؟ (اگر همهٔ عکس‌ها هنوز نرسیده‌اند، چند ثانیه صبر کن و بعد دکمه را بزن.)`, {
      kb: [
        [{ text: `📤 ارسال آلبوم به کانال ${PNAME[o]}`, cb: `fw:as:${gid}` }],
        [{ text: '🗑 حذف آلبوم از هر دو کانال', cb: `fw:ad:${gid}` }],
        ...backMain,
      ],
    });
  }

  await kvSetJSON(`fw:${p}:${uid}:${m.message_id}`, item);
  const mapped = await counterpart(p, src.chatId, src.msgId);
  const html = `📨 این پست از کانال <b>${title}</b> است.\n${mapped ? `✅ نسخهٔ آن در ${PNAME[o]} وجود دارد.` : `ℹ️ نسخه‌ای از آن در ${PNAME[o]} ثبت نشده.`}\n\nچه کاری انجام شود؟`;
  const kb = [
    [{ text: `📤 ارسال به کانال ${PNAME[o]}`, cb: `fw:s:${m.message_id}` }],
    [{ text: '🗑 حذف از هر دو کانال', cb: `fw:d:${m.message_id}` }],
    ...backMain,
  ];
  return send(p, uid, html, { kb });
}
