// lib/admin — admin panel: stats, forced join, broadcast, users, links, system.
import { db, api } from 'sdk';
import { sql } from 'sdk/db';
import { PNAME, PICON, ADMINS, TICK_Q } from 'lib/config';
import { kvGet, kvSet, kvJSON, kvSetJSON, setSession, clearSession, logError } from 'lib/store';
import { fjConfig, saveFj, resolveFjChannel } from 'lib/fj';
import { adminStatsHtml } from 'lib/stats';
import { listScreen, backMain } from 'lib/screens';
import { enqueue } from 'lib/queue';
import { tick, kickWorkers } from 'lib/tick';
import { channelRef } from 'lib/linking';
import { getChat, getMember } from 'lib/platform';
import { now, esc, fa, ago, trunc } from 'lib/util';
import { BOT_ID } from 'lib/config';

const backAdmin = [[{ text: '🔙 پنل مدیریت', cb: 'ad' }]];

export function adminScreen() {
  return {
    html: '🛠 <b>پنل مدیریت</b>\n\nیک بخش را انتخاب کن:',
    kb: [
      [{ text: '📊 آمار کامل', cb: 'ad:st' }, { text: '📢 عضویت اجباری', cb: 'ad:fj' }],
      [{ text: '📣 پیام همگانی', cb: 'ad:bc' }, { text: '🔗 همه اتصال‌ها', cb: 'ad:ln' }],
      [{ text: '👤 مدیریت کاربر', cb: 'ad:us' }, { text: '🫀 وضعیت سیستم', cb: 'ad:sy' }],
      ...backMain,
    ],
  };
}

async function fjScreen() {
  const c = await fjConfig();
  const lines = ['📢 <b>عضویت اجباری</b>', '', `وضعیت: ${c.on ? '✅ روشن' : '❌ خاموش'}`, ''];
  const kb = [];
  for (const p of ['tg', 'bale']) {
    lines.push(`${PICON[p]} <b>کاربران ${PNAME[p]}</b> باید عضو این کانال‌ها باشند:`);
    if (!c[p].length) lines.push('   — هیچ —');
    c[p].forEach((ch, i) => {
      lines.push(`   ${fa(i + 1)}. ${esc(ch.title)}`);
      kb.push([{ text: `❌ حذف ${ch.title} (${PNAME[p]})`, cb: `ad:fr:${p}:${i}` }]);
    });
    lines.push('');
  }
  lines.push('ربات باید در این کانال‌ها ادمین باشد تا بتواند عضویت را بررسی کند.');
  kb.push([{ text: '➕ کانال تلگرام', cb: 'ad:fa:tg' }, { text: '➕ کانال بله', cb: 'ad:fa:bale' }]);
  kb.push([{ text: c.on ? '⏸ خاموش کردن' : '▶️ روشن کردن', cb: 'ad:ft' }]);
  kb.push(...backAdmin);
  return { html: lines.join('\n'), kb };
}

async function sysScreen() {
  const beat = Number(await kvGet('pump_beat', '0'));
  const lock = Number(await kvGet('pump_lock', '0'));
  const offset = await kvGet('bale_offset', '0');
  const tickers = await kvJSON('tickers', []);
  const q = await db.get(sql`SELECT
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS n,
      SUM(CASE WHEN status = 'run' THEN 1 ELSE 0 END) AS r,
      SUM(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS f
    FROM jobs`);
  const errs = await db.get(sql`SELECT count(*) AS c FROM errors WHERE at > ${now() - 86400}`);
  const slots = [];
  for (let i = 1; i <= 3; i++) slots.push(Number(await kvGet('wslot:' + i, '0')) > Date.now() ? '🟢' : '⚪️');
  const html = [
    '🫀 <b>وضعیت سیستم</b>',
    '',
    `پمپ بله: ${Date.now() - beat < 45000 ? '🟢 فعال' : '🔴 متوقف'} (ضربان ${ago(beat)}${lock > Date.now() ? '، در حال اجرا' : ''})`,
    `آفست آپدیت بله: <code>${esc(offset)}</code>`,
    `ورکرها: ${slots.join(' ')}`,
    `صف: جدید ${fa(q?.n)} | در حال اجرا ${fa(q?.r)} | ناموفق ${fa(q?.f)}`,
    `خطاهای ۲۴ ساعت: ${fa(errs?.c)}`,
    `تیکر: ${tickers.length ? tickers.map((t) => esc(t.title)).join('، ') : 'پیوی ادمین (پیش‌فرض)'}`,
    '',
    'ℹ️ تلگرام سرورلس تایمر ندارد؛ ربات با ارسال و بستن یک نظرسنجی در «چت تیکر» خودش را بیدار می‌کند. پیشنهاد می‌شود یک کانال یا گروه خصوصی خالی بسازی، ربات را ادمینش کنی و از بخش «⏱ تیکر» ثبتش کنی تا پیوی شما شلوغ نشود.',
  ].join('\n');
  return {
    html,
    kb: [
      [{ text: '🔄 راه‌اندازی مجدد پمپ', cb: 'ad:kp' }, { text: '⚙️ اجرای صف', cb: 'ad:kw' }],
      [{ text: '📜 خطاهای اخیر', cb: 'ad:er' }, { text: '🧹 پاک کردن خطاها', cb: 'ad:ec' }],
      [{ text: '♻️ تلاش مجدد کارهای ناموفق', cb: 'ad:rf' }],
      [{ text: '⏱ تیکر', cb: 'ad:tk' }],
      ...backAdmin,
    ],
  };
}

async function errorsScreen() {
  const rows = await db.all(sql`SELECT at, src, msg FROM errors ORDER BY id DESC LIMIT 12`);
  const html = rows.length
    ? '📜 <b>خطاهای اخیر</b>\n\n' + rows.map((r) => `• ${ago(r.at * 1000)} — <code>${esc(r.src)}</code>\n  ${esc(trunc(r.msg, 160))}`).join('\n')
    : '📜 خطایی ثبت نشده ✅';
  return { html, kb: [[{ text: '🔙 وضعیت سیستم', cb: 'ad:sy' }]] };
}

async function tickerScreen() {
  const list = await kvJSON('tickers', []);
  const html = [
    '⏱ <b>چت‌های تیکر</b>',
    '',
    'ربات برای بیدار شدن، هر چند ثانیه یک نظرسنجی در این چت‌ها می‌فرستد و فوراً پاکش می‌کند. بهتر است یک کانال خصوصی خالی (که فقط خودت عضوش هستی) بسازی، ربات را ادمین کنی و اینجا ثبتش کنی. اگر چند چت ثبت شود، به نوبت استفاده می‌شوند.',
    '',
    list.length ? list.map((t, i) => `${fa(i + 1)}. ${esc(t.title)} <code>${t.id}</code>`).join('\n') : `— هیچ؛ از پیوی ادمین (${ADMINS.tg[0]}) استفاده می‌شود —`,
  ].join('\n');
  const kb = list.map((t, i) => [{ text: '❌ حذف ' + t.title, cb: `ad:tr:${i}` }]);
  kb.push([{ text: '➕ افزودن چت تیکر', cb: 'ad:ta' }, { text: '🧪 تست', cb: 'ad:tt' }]);
  kb.push([{ text: '🔙 وضعیت سیستم', cb: 'ad:sy' }]);
  return { html, kb };
}

export async function userCard(p, uid) {
  const u = await db.get(sql`SELECT * FROM users WHERE platform = ${p} AND uid = ${uid}`);
  if (!u) return null;
  const links = p === 'tg'
    ? await db.get(sql`SELECT count(*) AS c FROM links WHERE owner_tg = ${uid}`)
    : await db.get(sql`SELECT count(*) AS c FROM links WHERE owner_bale = ${uid}`);
  const html = [
    `👤 <b>${esc(u.first_name || '')}</b> ${u.username ? '@' + esc(u.username) : ''}`,
    `${PICON[p]} ${PNAME[p]} — آیدی <code>${u.uid}</code>`,
    `عضویت: ${ago(u.joined_at * 1000)} | آخرین فعالیت: ${ago(u.last_seen * 1000)}`,
    `اتصال‌ها: ${fa(links?.c)} | ${u.blocked ? '🚫 ربات را بلاک کرده' : '✅ در دسترس'} | ${u.banned ? '⛔️ مسدود' : 'آزاد'}`,
  ].join('\n');
  const kb = [[u.banned
    ? { text: '✅ رفع مسدودیت', cb: `ad:uu:${p}:${uid}` }
    : { text: '⛔️ مسدود کردن', cb: `ad:ub:${p}:${uid}` }], ...backAdmin];
  return { html, kb };
}

// Returns a screen to show, or null when the action already replied.
export async function adminCallback(p, uid, chatId, parts) {
  const a = parts[1];
  switch (a) {
    case undefined: return adminScreen();
    case 'st': return { html: await adminStatsHtml(), kb: [[{ text: '🔄 بروزرسانی', cb: 'ad:st' }], ...backAdmin] };
    case 'fj': return fjScreen();
    case 'ft': {
      const c = await fjConfig();
      c.on = !c.on;
      await saveFj(c);
      return fjScreen();
    }
    case 'fr': {
      const c = await fjConfig();
      c[parts[2]].splice(Number(parts[3]), 1);
      await saveFj(c);
      return fjScreen();
    }
    case 'fa': {
      const tp = parts[2];
      await setSession(p, uid, 'afj', { p: tp });
      return {
        html: `➕ افزودن کانال عضویت اجباری برای کاربران <b>${PNAME[tp]}</b>\n\nیوزرنیم کانال (مثل @channel) یا آیدی عددی آن را بفرست${tp === p ? '، یا یک پست از آن را فوروارد کن' : ''}.\nربات باید در آن کانال ادمین باشد.`,
        kb: [[{ text: '❌ انصراف', cb: 'ad:fj' }]],
      };
    }
    case 'bc':
      return {
        html: '📣 <b>پیام همگانی</b>\n\nپیام برای چه کسانی ارسال شود؟\n\nℹ️ برای کاربران همین پیامرسان پیام کامل (با عکس/فایل) کپی می‌شود؛ برای پیامرسان دیگر فقط متن ارسال می‌شود.',
        kb: [
          [{ text: `${PICON.tg} کاربران تلگرام`, cb: 'ad:bt:tg' }, { text: `${PICON.bale} کاربران بله`, cb: 'ad:bt:bale' }],
          [{ text: '🌐 همه کاربران', cb: 'ad:bt:all' }],
          ...backAdmin,
        ],
      };
    case 'bt':
      await setSession(p, uid, 'abc', { target: parts[2] });
      return { html: '✍️ پیام همگانی را بفرست (متن، عکس، ویدیو و ...):', kb: [[{ text: '❌ انصراف', cb: 'ad' }]] };
    case 'bg': {
      const b = await db.get(sql`SELECT * FROM broadcasts WHERE id = ${Number(parts[2])}`);
      if (!b || b.status !== 'draft') return adminScreen();
      await db.run(sql`UPDATE broadcasts SET status = 'run' WHERE id = ${b.id}`);
      await enqueue('bc', 'bc', { bid: b.id });
      await kickWorkers();
      return { html: `🚀 ارسال پیام همگانی #${fa(b.id)} شروع شد. پس از پایان گزارش داده می‌شود.`, kb: backAdmin };
    }
    case 'bx':
      await db.run(sql`UPDATE broadcasts SET status = 'cancel' WHERE id = ${Number(parts[2])} AND status = 'draft'`);
      return adminScreen();
    case 'ln': {
      const all = await db.all(sql`SELECT * FROM links ORDER BY id DESC`);
      return listScreen(all, Number(parts[2] || 0), '🔗 <b>همه اتصال‌ها</b>', 'ad:ln');
    }
    case 'us':
      await setSession(p, uid, 'aus', {});
      return { html: '👤 آیدی عددی یا یوزرنیم کاربر (تلگرام یا بله) را بفرست:', kb: [[{ text: '❌ انصراف', cb: 'ad' }]] };
    case 'uc': return (await userCard(parts[2], Number(parts[3]))) || adminScreen();
    case 'ub':
    case 'uu': {
      const ban = a === 'ub' ? 1 : 0;
      await db.run(sql`UPDATE users SET banned = ${ban} WHERE platform = ${parts[2]} AND uid = ${Number(parts[3])}`);
      return (await userCard(parts[2], Number(parts[3]))) || adminScreen();
    }
    case 'sy': return sysScreen();
    case 'kp':
      await kvSet('pump_lock', '0');
      await kvSet('pump_pause_until', '0');
      await kvSet('pump_fail_streak', '0');
      await tick('pump');
      return sysScreen();
    case 'kw':
      await kvSet('kick_at', '0');
      await kickWorkers();
      return sysScreen();
    case 'rf':
      await db.run(sql`UPDATE jobs SET status = 'new', tries = 0, run_at = 0 WHERE status = 'fail' AND created_at > ${now() - 86400}`);
      await kickWorkers();
      return sysScreen();
    case 'er': return errorsScreen();
    case 'ec':
      await db.run(sql`DELETE FROM errors`);
      return sysScreen();
    case 'tk': return tickerScreen();
    case 'ta':
      await setSession(p, uid, 'atk', {});
      return {
        html: '➕ یک پست از کانال تیکر را فوروارد کن یا آیدی عددی کانال/گروه تلگرامی را بفرست.\nربات باید آنجا ادمین باشد و اجازه ارسال و حذف پیام داشته باشد.',
        kb: [[{ text: '❌ انصراف', cb: 'ad:tk' }]],
      };
    case 'tr': {
      const list = await kvJSON('tickers', []);
      list.splice(Number(parts[2]), 1);
      await kvSetJSON('tickers', list);
      return tickerScreen();
    }
    case 'tt': {
      const ok = await tick('job');
      const s = await tickerScreen();
      s.html += `\n\n🧪 نتیجهٔ تست: ${ok ? '✅ موفق' : '❌ ناموفق (خطاها را ببین)'}`;
      return s;
    }
    default: return adminScreen();
  }
}

// Free-text input while an admin session is active. Returns a screen.
export async function adminInput(p, uid, m, ses) {
  const text = (m.text || '').trim();
  if (ses.state === 'afj') {
    const tp = ses.data.p;
    const ref = tp === p ? channelRef(m) : (/^-?\d{5,}$/.test(text) ? Number(text) : (text.match(/^@?([A-Za-z][A-Za-z0-9_]{3,})$/) ? '@' + text.replace(/^@/, '') : null));
    if (!ref) return { html: '❗️ ورودی نامعتبر. یوزرنیم یا آیدی عددی کانال را بفرست.', kb: [[{ text: '❌ انصراف', cb: 'ad:fj' }]] };
    const r = await resolveFjChannel(tp, ref);
    if (r.error) return { html: '❌ ' + r.error, kb: [[{ text: '❌ انصراف', cb: 'ad:fj' }]] };
    const c = await fjConfig();
    if (!c[tp].some((x) => x.id === r.channel.id)) c[tp].push(r.channel);
    await saveFj(c);
    await clearSession(p, uid);
    const s = await fjScreen();
    s.html = `✅ کانال «${esc(r.channel.title)}» اضافه شد.\n\n` + s.html;
    return s;
  }
  if (ses.state === 'abc') {
    const r = await db.run(sql`INSERT INTO broadcasts (target, sp, sc, sm, text, status, by_uid, created_at)
      VALUES (${ses.data.target}, ${p}, ${m.chat.id}, ${m.message_id}, ${m.text || m.caption || null}, 'draft', ${uid}, ${now()}) RETURNING id`);
    const bid = r.rows[0].id;
    await clearSession(p, uid);
    const cnt = ses.data.target === 'all'
      ? await db.get(sql`SELECT count(*) AS c FROM users WHERE blocked = 0 AND banned = 0`)
      : await db.get(sql`SELECT count(*) AS c FROM users WHERE platform = ${ses.data.target} AND blocked = 0 AND banned = 0`);
    return {
      html: `📣 پیام بالا برای ${fa(cnt?.c)} کاربر ارسال شود؟`,
      kb: [[{ text: '🚀 ارسال', cb: `ad:bg:${bid}` }, { text: '❌ لغو', cb: `ad:bx:${bid}` }]],
    };
  }
  if (ses.state === 'aus') {
    const q = text.replace(/^@/, '');
    const rows = /^\d+$/.test(q)
      ? await db.all(sql`SELECT platform, uid FROM users WHERE uid = ${Number(q)} LIMIT 4`)
      : await db.all(sql`SELECT platform, uid FROM users WHERE lower(username) = ${q.toLowerCase()} LIMIT 4`);
    if (!rows.length) return { html: '🔍 کاربری پیدا نشد. دوباره بفرست یا انصراف بزن.', kb: [[{ text: '❌ انصراف', cb: 'ad' }]] };
    await clearSession(p, uid);
    if (rows.length === 1) return userCard(rows[0].platform, rows[0].uid);
    return {
      html: '🔍 چند کاربر پیدا شد:',
      kb: [...rows.map((r) => [{ text: `${PICON[r.platform]} ${r.uid}`, cb: `ad:uc:${r.platform}:${r.uid}` }]), ...backAdmin],
    };
  }
  if (ses.state === 'atk') {
    const ref = channelRef(m) ?? (/^-?\d{5,}$/.test(text) ? Number(text) : null);
    if (!ref) return { html: '❗️ یک پست فوروارد کن یا آیدی عددی بفرست.', kb: [[{ text: '❌ انصراف', cb: 'ad:tk' }]] };
    try {
      const chat = await getChat('tg', ref);
      const me = await getMember('tg', chat.id, BOT_ID.tg);
      if (me.status !== 'administrator' && chat.type !== 'group' && chat.type !== 'supergroup') throw new Error('bot is not admin');
      const probe = await api.sendPoll({ chat_id: chat.id, question: TICK_Q.job, options: [{ text: '1' }, { text: '2' }], disable_notification: true });
      await api.stopPoll({ chat_id: chat.id, message_id: probe.message_id });
      await api.deleteMessage({ chat_id: chat.id, message_id: probe.message_id });
      const list = await kvJSON('tickers', []);
      if (!list.some((t) => t.id === chat.id)) list.push({ id: chat.id, title: chat.title || String(chat.id) });
      await kvSetJSON('tickers', list);
      await clearSession(p, uid);
      const s = await tickerScreen();
      s.html = `✅ «${esc(chat.title)}» به عنوان چت تیکر ثبت شد.\n\n` + s.html;
      return s;
    } catch (e) {
      await logError('ticker:add', e);
      return { html: '❌ ثبت نشد. ربات باید در آن چت ادمین باشد و اجازه ارسال و حذف پیام داشته باشد.', kb: [[{ text: '❌ انصراف', cb: 'ad:tk' }]] };
    }
  }
  return null;
}
