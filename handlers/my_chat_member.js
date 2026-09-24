// handlers/my_chat_member — the bot was added to / removed from a Telegram channel.
import { linkByChat, linkTitle } from 'lib/links';
import { trySend } from 'lib/platform';
import { watchdog } from 'lib/tick';
import { logError } from 'lib/store';
import { esc } from 'lib/util';

export default async function (upd) {
  try {
    const chat = upd.chat;
    if (chat?.type !== 'channel') return;
    const status = upd.new_chat_member?.status;
    const link = await linkByChat('tg', chat.id);
    if (status === 'administrator') {
      if (link || !upd.from || upd.from.is_bot) return;
      await trySend('tg', upd.from.id,
        `✅ ربات به کانال <b>${esc(chat.title)}</b> اضافه شد.\n\nمی‌خواهی این کانال را به یک کانال بله وصل کنی؟`,
        { kb: [[{ text: '🔗 اتصال این کانال به بله', cb: 'cn:' + chat.id }]] });
    } else if (link) {
      const html = `⚠️ ربات دیگر ادمین کانال تلگرام <b>${esc(chat.title)}</b> نیست؛ همگام‌سازی اتصال «${esc(linkTitle(link))}» تا ادمین شدن دوبارهٔ ربات کار نمی‌کند.`;
      const kb = [[{ text: '⚙️ مدیریت اتصال', cb: 'lk:' + link.id }]];
      if (link.owner_tg) await trySend('tg', link.owner_tg, html, { kb });
      if (link.owner_bale) await trySend('bale', link.owner_bale, html, { kb });
    }
  } catch (e) {
    await logError('tg:my_chat_member', e);
  } finally {
    await watchdog();
  }
}
