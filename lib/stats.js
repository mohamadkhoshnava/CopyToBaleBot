// lib/stats — numbers for the stats screens.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { now, day, fa, ago, esc, trunc } from 'lib/util';
import { kvGet, kvJSON } from 'lib/store';
import { S, linksOf, linkTitle } from 'lib/links';
import { PNAME } from 'lib/config';

async function n(q) {
  const r = await db.get(q);
  return r ? Number(Object.values(r)[0] || 0) : 0;
}

async function dayStat(k, days = 1) {
  const from = day(days - 1);
  return n(sql`SELECT COALESCE(SUM(n), 0) AS c FROM stats WHERE k = ${k} AND day >= ${from}`);
}

export async function adminStatsHtml() {
  const t = now();
  const u = {};
  for (const p of ['tg', 'bale']) {
    u[p] = {
      total: await n(sql`SELECT count(*) AS c FROM users WHERE platform = ${p}`),
      today: await dayStat('new_' + p),
      week: await dayStat('new_' + p, 7),
    };
  }
  const active = await n(sql`SELECT count(*) AS c FROM users WHERE last_seen > ${t - 86400}`);
  const blocked = await n(sql`SELECT count(*) AS c FROM users WHERE blocked = 1`);
  const banned = await n(sql`SELECT count(*) AS c FROM users WHERE banned = 1`);

  const links = await db.all(sql`SELECT id, settings, err_count, t2b, b2t, tg_title, bale_title, tg_chat, bale_chat FROM links`);
  let paused = 0;
  let withErr = 0;
  const dirs = { both: 0, t2b: 0, b2t: 0 };
  let t2b = 0;
  let b2t = 0;
  for (const l of links) {
    const s = S(l);
    if (s.paused) paused++;
    if (l.err_count > 0) withErr++;
    dirs[s.dir] = (dirs[s.dir] || 0) + 1;
    t2b += l.t2b || 0;
    b2t += l.b2t || 0;
  }
  const top = links.slice().sort((a, b) => (b.t2b + b.b2t) - (a.t2b + a.b2t)).slice(0, 5).filter((l) => l.t2b + l.b2t > 0);

  const queue = await n(sql`SELECT count(*) AS c FROM jobs WHERE status IN ('new', 'run')`);
  const failed = await n(sql`SELECT count(*) AS c FROM jobs WHERE status = 'fail' AND created_at > ${t - 86400}`);
  const beat = Number(await kvGet('pump_beat', '0'));
  const tickers = await kvJSON('tickers', []);

  return [
    '📊 <b>آمار کامل ربات</b>',
    '',
    '👥 <b>کاربران</b>',
    `• ${PNAME.tg}: ${fa(u.tg.total)} (امروز +${fa(u.tg.today)} | ۷ روز +${fa(u.tg.week)})`,
    `• ${PNAME.bale}: ${fa(u.bale.total)} (امروز +${fa(u.bale.today)} | ۷ روز +${fa(u.bale.week)})`,
    `• مجموع: ${fa(u.tg.total + u.bale.total)} | فعال ۲۴ ساعت: ${fa(active)}`,
    `• ربات را بلاک کرده‌اند: ${fa(blocked)} | مسدود: ${fa(banned)}`,
    '',
    '🔗 <b>کانال‌ها و اتصال‌ها</b>',
    `• اتصال‌ها: ${fa(links.length)} (فعال ${fa(links.length - paused)} | متوقف ${fa(paused)} | دارای خطا ${fa(withErr)})`,
    `• کانال‌های متصل: ${fa(links.length)} تلگرام + ${fa(links.length)} بله`,
    `• دوطرفه: ${fa(dirs.both)} | فقط تلگرام→بله: ${fa(dirs.t2b)} | فقط بله→تلگرام: ${fa(dirs.b2t)}`,
    `• اتصال‌های جدید امروز: ${fa(await dayStat('links_new'))} | ۷ روز: ${fa(await dayStat('links_new', 7))}`,
    '',
    '🔄 <b>همگام‌سازی</b>',
    `• کل پست‌ها: تلگرام→بله ${fa(t2b)} | بله→تلگرام ${fa(b2t)}`,
    `• امروز: تلگرام→بله ${fa(await dayStat('sync_t2b'))} | بله→تلگرام ${fa(await dayStat('sync_b2t'))}`,
    `• ۷ روز: تلگرام→بله ${fa(await dayStat('sync_t2b', 7))} | بله→تلگرام ${fa(await dayStat('sync_b2t', 7))}`,
    `• امروز: ویرایش ${fa(await dayStat('edits'))} | حذف ${fa(await dayStat('deletes'))} | ردشده با فیلتر ${fa(await dayStat('skipped'))}`,
    '',
    '⚙️ <b>سیستم</b>',
    `• صف کارها: ${fa(queue)} | ناموفق ۲۴ ساعت: ${fa(failed)} | خطاهای امروز: ${fa(await dayStat('errors'))}`,
    `• آخرین ضربان پمپ بله: ${ago(beat)}`,
    `• کانال‌های تیکر: ${tickers.length ? fa(tickers.length) : 'پیوی ادمین (پیش‌فرض)'}`,
    ...(top.length ? ['', '🏆 <b>پرکارترین اتصال‌ها</b>', ...top.map((l, i) => `${fa(i + 1)}. ${esc(trunc(linkTitle(l), 40))} — ${fa(l.t2b + l.b2t)}`)] : []),
  ].join('\n');
}

export async function userStatsHtml(p, uid) {
  const mine = await linksOf(p, uid);
  const users = await n(sql`SELECT count(*) AS c FROM users`);
  const links = await n(sql`SELECT count(*) AS c FROM links`);
  const posts = await n(sql`SELECT COALESCE(SUM(t2b + b2t), 0) AS c FROM links`);
  const lines = ['📊 <b>آمار</b>', ''];
  if (mine.length) {
    lines.push('<b>اتصال‌های شما</b>');
    for (const l of mine) {
      const s = S(l);
      lines.push(`${s.paused ? '⏸' : '✅'} ${esc(trunc(linkTitle(l), 40))}`);
      lines.push(`   تلگرام→بله: ${fa(l.t2b)} | بله→تلگرام: ${fa(l.b2t)} | آخرین: ${l.last_at ? ago(l.last_at * 1000) : '—'}`);
    }
  } else {
    lines.push('هنوز اتصالی نساخته‌ای. از «➕ اتصال کانال جدید» شروع کن.');
  }
  lines.push('', '<b>کل ربات</b>', `👥 کاربران: ${fa(users)} | 🔗 اتصال‌ها: ${fa(links)} | 🔄 پست‌های همگام‌شده: ${fa(posts)}`);
  return lines.join('\n');
}
