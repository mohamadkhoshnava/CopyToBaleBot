// lib/screens — message text + inline keyboards for the user-facing UI.
// Every screen returns { html, kb } and works on both platforms.
import { isAdmin, PNAME, PICON, OTHER, BOT_USERNAME, CODE_TTL } from 'lib/config';
import { S, TYPES, linkTitle } from 'lib/links';
import { esc, fa, ago, trunc } from 'lib/util';

const DIR_LABEL = { both: '↔️ دوطرفه', t2b: '➡️ فقط تلگرام ← بله', b2t: '⬅️ فقط بله ← تلگرام' };
const DIR_NEXT = { both: 't2b', t2b: 'b2t', b2t: 'both' };
export { DIR_NEXT };

const TYPE_LABEL = {
  text: '📝 متن', photo: '🖼 عکس', video: '🎬 ویدیو', animation: '🎞 گیف', document: '📄 فایل',
  audio: '🎵 موزیک', voice: '🎙 ویس', sticker: '🧩 استیکر', poll: '📊 نظرسنجی', location: '📍 لوکیشن', contact: '👤 مخاطب',
};

// Toggle keys shown on the "more settings" screen.
export const MORE = [
  ['edits', '✏️ همگام‌سازی ویرایش پست‌ها'],
  ['deletes', '🗑 حذف نسخهٔ مقابل با دستور /del'],
  ['replies', '↩️ حفظ ریپلای‌ها'],
  ['pins', '📌 همگام‌سازی سنجاق (پین)'],
  ['fmt', '🔤 حفظ قالب‌بندی متن (بولد، لینک و ...)'],
  ['silent', '🔕 ارسال بی‌صدا (تلگرام)'],
  ['stripLinks', '🔗 حذف لینک‌ها از متن'],
  ['stripMentions', '@ حذف منشن‌ها (@username)'],
  ['bigNote', '📎 اطلاع‌رسانی فایل‌های بزرگ (+۲۰MB)'],
];

const on = (b) => (b ? '✅' : '❌');

export function mainScreen(p, uid, name) {
  const html = `👋 سلام ${esc(name || '')}!\n\nبا این ربات کانال <b>تلگرام</b> و کانال <b>بله</b>‌ات را به هم وصل کن تا هر پستی که در یکی می‌گذاری، خودکار در دیگری هم منتشر شود (دوطرفه یا یک‌طرفه) — همراه با ویرایش‌ها، آلبوم‌ها، فایل‌ها، جایگزینی یوزرنیم و کلی تنظیمات دیگر.\n\nاز منوی زیر شروع کن 👇`;
  const kb = [
    [{ text: '➕ اتصال کانال جدید', cb: 'new' }],
    [{ text: '📋 اتصال‌های من', cb: 'ls' }, { text: '📊 آمار', cb: 'st' }],
    [{ text: '📖 راهنما', cb: 'hp' }],
  ];
  if (isAdmin(p, uid)) kb.push([{ text: '🛠 پنل مدیریت', cb: 'ad' }]);
  return { html, kb };
}

export const backMain = [[{ text: '🏠 منوی اصلی', cb: 'm' }]];

export function helpScreen(p) {
  const o = OTHER[p];
  const html = [
    '📖 <b>راهنمای ربات</b>',
    '',
    '<b>۱. اتصال دو کانال</b>',
    `• ربات @${BOT_USERNAME.tg} را در کانال تلگرام و @${BOT_USERNAME.bale} را در کانال بله ادمین کن (ارسال، ویرایش و حذف پیام).`,
    '• «➕ اتصال کانال جدید» را بزن و کانال همین پیامرسان را معرفی کن (فوروارد یک پست، یوزرنیم یا آیدی عددی).',
    `• ربات یک کد مثل <code>CTB-XXXXXX</code> می‌دهد؛ آن را داخل کانال ${PNAME[o]} پست کن (یا در پیوی ربات ${PNAME[o]} بفرست). تمام! 🎉`,
    '',
    '<b>۲. چه چیزهایی همگام می‌شود؟</b>',
    '• متن، عکس، ویدیو، گیف، فایل، موزیک، ویس، آلبوم، استیکر، لوکیشن، مخاطب و نظرسنجی (به‌صورت متن)',
    '• ویرایش متن/کپشن، ریپلای‌ها و سنجاق کردن',
    '• فایل‌های بزرگ‌تر از ۲۰ مگابایت به دلیل محدودیت API قابل انتقال نیستند.',
    '',
    '<b>۳. حذف پست</b>',
    'پیامرسان‌ها حذف پست کانال را به ربات اطلاع نمی‌دهند؛ برای حذف در هر دو طرف یکی از این کارها را بکن:',
    '• روی پست در کانال ریپلای کن و بنویس <code>/del</code>',
    '• یا پست را به ربات فوروارد کن و «🗑 حذف از هر دو کانال» را بزن.',
    '',
    '<b>۴. ترفندها</b>',
    '• پستی که <code>#nosync</code> داشته باشد منتقل نمی‌شود.',
    '• پست‌های قدیمی را به ربات فوروارد کن تا به کانال مقابل ارسال شوند.',
    '• از «📋 اتصال‌های من» جهت، جایگزینی متن، امضا، فیلتر کلمات، نوع محتوا و... را تنظیم کن.',
    '',
    '<b>دستورات:</b> /start منو • /new اتصال جدید • /links اتصال‌ها • /stats آمار • /cancel لغو',
  ].join('\n');
  return { html, kb: backMain };
}

export function newScreen(p) {
  const o = OTHER[p];
  const html = [
    '➕ <b>اتصال کانال جدید</b> — مرحله ۱ از ۲',
    '',
    `کانال <b>${PNAME[p]}</b> خودت را معرفی کن:`,
    '',
    `۱. ربات @${BOT_USERNAME[p]} را در کانال ادمین کن (دسترسی ارسال، ویرایش و حذف پیام).`,
    '۲. سپس یکی از این کارها را انجام بده:',
    '   • یک پست از کانال را همین‌جا فوروارد کن',
    '   • یا یوزرنیم کانال را بفرست (مثل @mychannel)',
    '   • یا آیدی عددی کانال را بفرست',
    ...(p === 'tg' ? ['   • یا از دکمهٔ «📢 انتخاب کانال» پایین صفحه استفاده کن'] : []),
    '',
    `💡 اگر قبلاً در ${PNAME[o]} کد اتصال گرفته‌ای، همان کد را همین‌جا بفرست.`,
  ].join('\n');
  return { html, kb: [[{ text: '❌ انصراف', cb: 'x' }]] };
}

export function codeScreen(p, chat, code) {
  const o = OTHER[p];
  const html = [
    `✅ کانال <b>${esc(chat.title)}</b> تایید شد.`,
    '',
    `➕ <b>مرحله ۲ از ۲</b> — حالا در <b>${PNAME[o]}</b>:`,
    '',
    `۱. ربات @${BOT_USERNAME[o]} را در کانال ${PNAME[o]} ادمین کن (ارسال، ویرایش و حذف پیام).`,
    `۲. این کد را <b>داخل همان کانال ${PNAME[o]}</b> پست کن:`,
    '',
    `<code>${code}</code>`,
    '',
    'ربات کد را می‌بیند، اتصال را برقرار می‌کند و پست کد را پاک می‌کند. نتیجه همین‌جا اطلاع داده می‌شود.',
    '',
    `راه دیگر: کد را در پیوی ربات ${PNAME[o]} بفرست و کانال را آنجا معرفی کن.`,
    `⏳ اعتبار کد: ${fa(CODE_TTL / 60)} دقیقه`,
  ].join('\n');
  return { html, kb: [[{ text: '📋 کپی کد', copy: code }], ...backMain] };
}

export function linkCreatedHtml(link) {
  return {
    html: `🎉 <b>اتصال برقرار شد!</b>\n\n${PICON.tg} تلگرام: <b>${esc(link.tg_title)}</b>\n${PICON.bale} بله: <b>${esc(link.bale_title)}</b>\n\nاز این به بعد پست‌ها به‌صورت دوطرفه همگام می‌شوند. برای تغییر جهت، جایگزینی یوزرنیم، امضا و سایر تنظیمات دکمهٔ زیر را بزن.`,
    kb: [[{ text: '⚙️ تنظیمات اتصال', cb: 'lk:' + link.id }], ...backMain],
  };
}

export function listScreen(links, page, title = '📋 <b>اتصال‌های من</b>', cbPrefix = 'ls') {
  const per = 8;
  const pages = Math.max(1, Math.ceil(links.length / per));
  page = Math.min(Math.max(0, page), pages - 1);
  const slice = links.slice(page * per, page * per + per);
  const html = links.length
    ? `${title}\n\n${fa(links.length)} اتصال. برای مدیریت روی هر کدام بزن:`
    : `${title}\n\nهنوز اتصالی نداری. از «➕ اتصال کانال جدید» شروع کن.`;
  const kb = slice.map((l) => [{ text: `${S(l).paused ? '⏸' : l.err_count ? '⚠️' : '✅'} ${trunc(linkTitle(l), 48)}`, cb: 'lk:' + l.id }]);
  if (pages > 1) {
    const nav = [];
    if (page > 0) nav.push({ text: '◀️ قبلی', cb: `${cbPrefix}:${page - 1}` });
    nav.push({ text: `${fa(page + 1)}/${fa(pages)}`, cb: 'noop' });
    if (page < pages - 1) nav.push({ text: 'بعدی ▶️', cb: `${cbPrefix}:${page + 1}` });
    kb.push(nav);
  }
  kb.push([{ text: '➕ اتصال کانال جدید', cb: 'new' }], ...backMain);
  return { html, kb };
}

function chLine(p, title, user, id) {
  return `${PICON[p]} ${PNAME[p]}: <b>${esc(title || id)}</b>${user ? ' (@' + esc(user) + ')' : ''}`;
}

export function linkScreen(link) {
  const s = S(link);
  const id = link.id;
  const html = [
    `🔗 <b>اتصال #${fa(id)}</b>`,
    '',
    chLine('tg', link.tg_title, link.tg_user, link.tg_chat),
    chLine('bale', link.bale_title, link.bale_user, link.bale_chat),
    '',
    `وضعیت: ${s.paused ? '⏸ متوقف' : '✅ فعال'} | جهت: ${DIR_LABEL[s.dir]}`,
    `📤 تلگرام ← بله: ${fa(link.t2b)} | 📥 بله ← تلگرام: ${fa(link.b2t)}`,
    `🕒 آخرین همگام‌سازی: ${link.last_at ? ago(link.last_at * 1000) : '—'}`,
    ...(link.err_count ? [`⚠️ خطای اخیر: <code>${esc(trunc(link.last_err, 200))}</code>`] : []),
  ].join('\n');
  const kb = [
    [{ text: s.paused ? '▶️ فعال‌سازی' : '⏸ توقف', cb: `lk:${id}:pz` }, { text: DIR_LABEL[s.dir], cb: `lk:${id}:dir` }],
    [{ text: '✏️ جایگزینی متن', cb: `lk:${id}:rl` }, { text: '🧾 سربرگ و امضا', cb: `lk:${id}:ft` }],
    [{ text: '🚫 فیلتر کلمات', cb: `lk:${id}:bk` }, { text: '🎞 نوع محتوا', cb: `lk:${id}:ty` }],
    [{ text: '⚙️ تنظیمات بیشتر', cb: `lk:${id}:mo` }],
    [{ text: '🩺 بررسی دسترسی‌ها', cb: `lk:${id}:ck` }, { text: '🔄 بروزرسانی', cb: `lk:${id}` }],
    [{ text: '❌ حذف اتصال', cb: `lk:${id}:rm` }],
    [{ text: '🔙 اتصال‌ها', cb: 'ls' }],
  ];
  return { html, kb };
}

const back = (id) => [{ text: '🔙 بازگشت', cb: 'lk:' + id }];
const DSHORT = { both: 'هر دو طرف', t2b: 'تلگرام→بله', b2t: 'بله→تلگرام' };

export function rulesScreen(link) {
  const s = S(link);
  const id = link.id;
  const auto = link.tg_user && link.bale_user
    ? `@${esc(link.tg_user)} ⇄ @${esc(link.bale_user)}`
    : 'نیاز به یوزرنیم عمومی در هر دو کانال دارد';
  const html = [
    '✏️ <b>جایگزینی متن</b>',
    '',
    `🔁 جایگزینی خودکار یوزرنیم کانال: ${on(s.autoUser)}`,
    `   ${auto}`,
    '   (لینک‌های t.me و ble.ir کانال هم جایگزین می‌شوند)',
    '',
    s.rules.length ? '<b>قوانین شما:</b>' : 'هنوز قانون دستی نداری.',
    ...s.rules.map((r, i) => `${fa(i + 1)}. «${esc(r.f)}» ← «${esc(r.t)}» <i>(${DSHORT[r.d]})</i>`),
  ].join('\n');
  const kb = [
    [{ text: `🔁 یوزرنیم خودکار: ${on(s.autoUser)}`, cb: `lk:${id}:tg:autoUser` }],
    [{ text: '➕ قانون برای هر دو طرف', cb: `lk:${id}:ra:both` }],
    [{ text: '➕ فقط تلگرام→بله', cb: `lk:${id}:ra:t2b` }, { text: '➕ فقط بله→تلگرام', cb: `lk:${id}:ra:b2t` }],
  ];
  const delRow = s.rules.slice(0, 16).map((_, i) => ({ text: '🗑 ' + fa(i + 1), cb: `lk:${id}:rd:${i}` }));
  for (let i = 0; i < delRow.length; i += 4) kb.push(delRow.slice(i, i + 4));
  if (s.rules.length) kb.push([{ text: '🧹 حذف همهٔ قوانین', cb: `lk:${id}:rc` }]);
  kb.push(back(id));
  return { html, kb };
}

export function footerScreen(link) {
  const s = S(link);
  const id = link.id;
  const show = (v) => (v ? `<i>${esc(trunc(v, 120))}</i>` : '—');
  const html = [
    '🧾 <b>سربرگ و امضا</b>',
    '',
    'متنی که بالا (سربرگ) یا پایین (امضا) هر پست منتقل‌شده اضافه می‌شود. مثلاً آیدی کانال بله در انتهای پست‌هایی که از تلگرام می‌آیند.',
    '',
    `<b>تلگرام ← بله</b>\nسربرگ: ${show(s.header_t2b)}\nامضا: ${show(s.footer_t2b)}`,
    '',
    `<b>بله ← تلگرام</b>\nسربرگ: ${show(s.header_b2t)}\nامضا: ${show(s.footer_b2t)}`,
  ].join('\n');
  const kb = [
    [{ text: '⬆️ سربرگ تلگرام→بله', cb: `lk:${id}:fs:header_t2b` }, { text: '⬇️ امضا تلگرام→بله', cb: `lk:${id}:fs:footer_t2b` }],
    [{ text: '⬆️ سربرگ بله→تلگرام', cb: `lk:${id}:fs:header_b2t` }, { text: '⬇️ امضا بله→تلگرام', cb: `lk:${id}:fs:footer_b2t` }],
    back(id),
  ];
  return { html, kb };
}

export function blockScreen(link) {
  const s = S(link);
  const id = link.id;
  const html = [
    '🚫 <b>فیلتر کلمات</b>',
    '',
    'پست‌هایی که هر کدام از این کلمات را داشته باشند منتقل نمی‌شوند.',
    '',
    s.block.length ? s.block.map((w) => '• ' + esc(w)).join('\n') : '— هیچ کلمه‌ای تنظیم نشده —',
    '',
    `#nosync: ${on(s.nosync)} (پست‌های دارای <code>#nosync</code> منتقل نمی‌شوند)`,
  ].join('\n');
  const kb = [
    [{ text: '✏️ تنظیم کلمات', cb: `lk:${id}:bs` }],
    ...(s.block.length ? [[{ text: '🧹 پاک کردن فهرست', cb: `lk:${id}:bc` }]] : []),
    [{ text: `#nosync: ${on(s.nosync)}`, cb: `lk:${id}:tg:nosync` }],
    back(id),
  ];
  return { html, kb };
}

export function typesScreen(link) {
  const s = S(link);
  const id = link.id;
  const html = '🎞 <b>نوع محتوا</b>\n\nانتخاب کن چه نوع پست‌هایی منتقل شوند:';
  const btns = TYPES.map((t) => ({ text: `${on(s.types[t])} ${TYPE_LABEL[t]}`, cb: `lk:${id}:tt:${t}` }));
  const kb = [];
  for (let i = 0; i < btns.length; i += 2) kb.push(btns.slice(i, i + 2));
  kb.push(back(id));
  return { html, kb };
}

export function moreScreen(link) {
  const s = S(link);
  const id = link.id;
  const html = '⚙️ <b>تنظیمات بیشتر</b>\n\nروی هر گزینه بزن تا روشن/خاموش شود:';
  const kb = MORE.map(([k, label]) => [{ text: `${on(s[k])} ${label}`, cb: `lk:${id}:tg:${k}` }]);
  kb.push(back(id));
  return { html, kb };
}

export function removeConfirm(link) {
  return {
    html: `❓ اتصال <b>${esc(linkTitle(link))}</b> حذف شود؟\n\nپست‌های منتشرشده باقی می‌مانند و فقط همگام‌سازی متوقف می‌شود.`,
    kb: [[{ text: '✅ بله، حذف کن', cb: `lk:${link.id}:rmy` }, { text: '❌ نه', cb: 'lk:' + link.id }]],
  };
}

// Where each toggle key lives, so a toggle re-renders the right screen.
export const TOGGLE_SCREEN = { autoUser: rulesScreen, nosync: blockScreen };
