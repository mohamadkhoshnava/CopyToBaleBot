// lib/callbacks — inline button presses (same flow on Telegram and Bale).
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { isAdmin, PNAME, PICON, BOT_ID, OTHER } from 'lib/config';
import {
  touchUser, clearSession, setSession, kvJSON, kvDel,
} from 'lib/store';
import {
  answer, edit, send, getMember,
} from 'lib/platform';
import { fjOk, fjPrompt, resetFjCache } from 'lib/fj';
import {
  mainScreen, helpScreen, listScreen, linkScreen, rulesScreen, footerScreen, blockScreen,
  typesScreen, moreScreen, removeConfirm, backMain, DIR_NEXT, TOGGLE_SCREEN,
} from 'lib/screens';
import {
  getLink, linksOf, canManage, S, saveSettings, DEFAULTS, TYPES, chatOf,
} from 'lib/links';
import { refreshTitles } from 'lib/linking';
import { adminCallback } from 'lib/admin';
import { adminStatsHtml, userStatsHtml } from 'lib/stats';
import { startNew, pickChannel } from 'lib/dm';
import { enqueue } from 'lib/queue';
import { kickWorkers } from 'lib/tick';
import { esc, parseJSON } from 'lib/util';

const DSHORT = { both: 'هر دو طرف', t2b: 'تلگرام→بله', b2t: 'بله→تلگرام' };
const FOOT_LABEL = {
  header_t2b: 'سربرگ پست‌های تلگرام→بله', footer_t2b: 'امضای پست‌های تلگرام→بله',
  header_b2t: 'سربرگ پست‌های بله→تلگرام', footer_b2t: 'امضای پست‌های بله→تلگرام',
};

export async function onCallback(p, cq) {
  const uid = cq.from.id;
  const data = cq.data || '';
  const chatId = cq.message?.chat?.id ?? uid;
  const mid = cq.message?.message_id;
  const user = await touchUser(p, cq.from);
  if (user.banned) return answer(p, cq.id, '⛔️ دسترسی شما مسدود است.', true);

  let answered = false;
  const toast = async (text, alert) => { answered = true; await answer(p, cq.id, text, alert); };
  const show = async (s, t) => {
    if (!answered) await toast(t);
    if (!s) return;
    if (mid) await edit(p, chatId, mid, s.html, { kb: s.kb });
    else await send(p, chatId, s.html, { kb: s.kb });
  };

  if (data === 'noop') return toast();
  if (data === 'fj') {
    await resetFjCache(p, uid);
    if (await fjOk(p, { ...user, fj_at: 0 })) return show(mainScreen(p, uid, cq.from.first_name), '✅ ممنون! حالا می‌توانی از ربات استفاده کنی.');
    return toast('❌ هنوز عضو همهٔ کانال‌ها نشده‌ای.', true);
  }
  if (!(await fjOk(p, user))) {
    const s = await fjPrompt(p, uid);
    return show(s, '🔒 اول عضو کانال شو');
  }

  const parts = data.split(':');
  switch (parts[0]) {
    case 'm':
    case 'x':
      await clearSession(p, uid);
      return show(mainScreen(p, uid, cq.from.first_name), parts[0] === 'x' ? 'لغو شد' : undefined);
    case 'hp':
      return show(helpScreen(p));
    case 'st': {
      const html = isAdmin(p, uid) ? await adminStatsHtml() : await userStatsHtml(p, uid);
      return show({ html, kb: [[{ text: '🔄 بروزرسانی', cb: 'st' }], ...backMain] }, '📊');
    }
    case 'new':
      await toast();
      return startNew(p, uid);
    case 'ls':
      return show(listScreen(await linksOf(p, uid), Number(parts[1] || 0)));
    case 'cn':
      await toast();
      return pickChannel(p, uid, { chat_shared: { chat_id: Number(parts[1]) } }, { data: { mode: 'new' } });
    case 'lk':
      return linkAction(p, uid, parts, show, toast);
    case 'fw':
      return forwardAction(p, uid, parts, show, toast);
    case 'ad':
      if (!isAdmin(p, uid)) return toast('⛔️', true);
      return show(await adminCallback(p, uid, chatId, parts));
    default:
      return toast();
  }
}

async function linkAction(p, uid, parts, show, toast) {
  const id = Number(parts[1]);
  let link = await getLink(id);
  if (!link) return show(listScreen(await linksOf(p, uid), 0), 'این اتصال دیگر وجود ندارد.');
  if (!canManage(p, uid, link)) return toast('⛔️ اجازهٔ مدیریت این اتصال را نداری.', true);
  const s = S(link);
  const save = async () => { await saveSettings(id, s); link = await getLink(id); };
  const cancel = (cb) => [[{ text: '❌ انصراف', cb }]];

  switch (parts[2]) {
    case undefined:
      return show(linkScreen(link));
    case 'pz':
      s.paused = !s.paused;
      await save();
      return show(linkScreen(link), s.paused ? '⏸ متوقف شد' : '▶️ فعال شد');
    case 'dir':
      s.dir = DIR_NEXT[s.dir] || 'both';
      await save();
      return show(linkScreen(link), '↔️ جهت تغییر کرد');
    case 'rl':
      return show(rulesScreen(link));
    case 'ra': {
      const d = ['both', 't2b', 'b2t'].includes(parts[3]) ? parts[3] : 'both';
      await setSession(p, uid, 'rule', { id, d });
      return show({
        html: `✍️ قانون جدید (<b>${DSHORT[d]}</b>) را به این شکل بفرست:\n\n<code>متن قدیم => متن جدید</code>\n\nچند قانون را می‌توانی در چند خط بفرستی. برای حذف یک عبارت، سمت راست را خالی بگذار:\n<code>تبلیغ =></code>`,
        kb: cancel(`lk:${id}:rl`),
      });
    }
    case 'rd':
      s.rules.splice(Number(parts[3]), 1);
      await save();
      return show(rulesScreen(link), '🗑 حذف شد');
    case 'rc':
      s.rules = [];
      await save();
      return show(rulesScreen(link), '🧹 پاک شد');
    case 'ft':
      return show(footerScreen(link));
    case 'fs': {
      const key = parts[3];
      if (!FOOT_LABEL[key]) return toast();
      await setSession(p, uid, 'foot', { id, key });
      return show({
        html: `✍️ متن <b>${FOOT_LABEL[key]}</b> را بفرست.\nبرای حذف، یک خط تیره (-) بفرست.\n\nمقدار فعلی: ${s[key] ? '<i>' + esc(s[key]) + '</i>' : '—'}`,
        kb: cancel(`lk:${id}:ft`),
      });
    }
    case 'bk':
      return show(blockScreen(link));
    case 'bs':
      await setSession(p, uid, 'block', { id });
      return show({ html: '✍️ کلمات ممنوع را بفرست (هر کلمه در یک خط یا جداشده با کاما):', kb: cancel(`lk:${id}:bk`) });
    case 'bc':
      s.block = [];
      await save();
      return show(blockScreen(link), '🧹 پاک شد');
    case 'ty':
      return show(typesScreen(link));
    case 'tt':
      if (TYPES.includes(parts[3])) {
        s.types[parts[3]] = !s.types[parts[3]];
        await save();
      }
      return show(typesScreen(link));
    case 'mo':
      return show(moreScreen(link));
    case 'tg': {
      const k = parts[3];
      if (typeof DEFAULTS[k] !== 'boolean' || k === 'paused') return toast();
      s[k] = !s[k];
      await save();
      return show((TOGGLE_SCREEN[k] || moreScreen)(link), s[k] ? '✅ روشن شد' : '❌ خاموش شد');
    }
    case 'ck': {
      await toast('🩺 در حال بررسی...');
      await refreshTitles(link);
      link = await getLink(id);
      const lines = ['🩺 <b>بررسی دسترسی‌ها</b>', ''];
      for (const q of ['tg', 'bale']) {
        const title = q === 'tg' ? link.tg_title : link.bale_title;
        try {
          const me = await getMember(q, chatOf(link, q), BOT_ID[q]);
          const isAdm = me.status === 'administrator' || me.status === 'creator';
          const r = (k) => (me[k] === false ? '❌' : '✅');
          lines.push(`${PICON[q]} ${PNAME[q]} «${esc(title)}»: ${isAdm ? '✅ ربات ادمین است' : '❌ ربات ادمین نیست'}`);
          if (isAdm && q === 'tg') lines.push(`   ارسال ${r('can_post_messages')} | ویرایش ${r('can_edit_messages')} | حذف ${r('can_delete_messages')}`);
        } catch (e) {
          lines.push(`${PICON[q]} ${PNAME[q]} «${esc(title)}»: ❌ دسترسی ندارد (${esc(e.description || e.message)})`);
        }
      }
      lines.push('', 'اگر مشکلی هست، ربات را در آن کانال ادمین کن و دسترسی ارسال، ویرایش و حذف پیام را بده.');
      return show({ html: lines.join('\n'), kb: [[{ text: '🔙 بازگشت', cb: 'lk:' + id }]] });
    }
    case 'rm':
      return show(removeConfirm(link));
    case 'rmy':
      await db.run(sql`DELETE FROM links WHERE id = ${id}`);
      await db.run(sql`DELETE FROM msgmap WHERE link_id = ${id}`);
      await db.run(sql`UPDATE jobs SET status = 'done' WHERE lk = ${'L' + id} AND status IN ('new', 'run')`);
      return show(listScreen(await linksOf(p, uid), 0), '🗑 اتصال حذف شد');
    default:
      return toast();
  }
}

async function forwardAction(p, uid, parts, show, toast) {
  if (parts[1] === 'as' || parts[1] === 'ad') return forwardAlbumAction(p, uid, parts, show, toast);
  const key = `fw:${p}:${uid}:${parts[2]}`;
  const f = await kvJSON(key, null);
  if (!f) return toast('⌛️ منقضی شده؛ پست را دوباره فوروارد کن.', true);
  const link = await getLink(f.link_id);
  if (!link || !canManage(p, uid, link)) return toast('⛔️', true);
  await kvDel(key);
  if (parts[1] === 's') {
    await enqueue('post', 'L' + link.id, { link_id: link.id, sp: f.sp, sc: f.sc, sm: f.sm, msg: f.msg, manual: true });
    await kickWorkers();
    return show({ html: `📤 پست در صف ارسال به کانال ${PNAME[OTHER[p]]} قرار گرفت.`, kb: backMain }, '📤');
  }
  if (parts[1] === 'd') {
    await enqueue('del', 'L' + link.id, { link_id: link.id, sp: f.sp, sc: f.sc, sm: f.sm });
    await kickWorkers();
    return show({ html: '🗑 پست و نسخهٔ مقابل آن حذف می‌شوند.', kb: backMain }, '🗑');
  }
  return toast();
}

async function forwardAlbumAction(p, uid, parts, show, toast) {
  const prefix = `fwa:${p}:${uid}:${parts[2]}:`;
  const { rows } = await db.run(sql`DELETE FROM kv WHERE k LIKE ${prefix + '%'} RETURNING v`);
  const items = rows.map((r) => parseJSON(r.v, null)).filter(Boolean).sort((a, b) => a.sm - b.sm);
  if (!items.length) return toast('⌛️ منقضی شده؛ آلبوم را دوباره فوروارد کن.', true);
  const link = await getLink(items[0].link_id);
  if (!link || !canManage(p, uid, link)) return toast('⛔️', true);
  const { sp, sc } = items[0];
  if (parts[1] === 'as') {
    // Use the channel message ids so later edits/deletes map to the right posts.
    const msgs = items.map((f) => ({ ...f.msg, message_id: f.sm, chat: { id: sc, type: 'channel' } }));
    await enqueue('album', 'L' + link.id, { link_id: link.id, sp, sc, items: msgs, manual: true });
    await kickWorkers();
    return show({ html: `📤 آلبوم (${items.length} مورد) در صف ارسال به کانال ${PNAME[OTHER[p]]} قرار گرفت.`, kb: backMain }, '📤');
  }
  for (const f of items) await enqueue('del', 'L' + link.id, { link_id: link.id, sp, sc, sm: f.sm });
  await kickWorkers();
  return show({ html: `🗑 آلبوم (${items.length} مورد) و نسخهٔ مقابل آن حذف می‌شوند.`, kb: backMain }, '🗑');
}
