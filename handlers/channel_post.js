// handlers/channel_post — new posts in Telegram channels where the bot is admin.
import { onChannelPost } from 'lib/channel';
import { watchdog } from 'lib/tick';
import { logError } from 'lib/store';

export default async function (post) {
  try {
    await onChannelPost('tg', post);
  } catch (e) {
    await logError('tg:channel_post', e);
  } finally {
    await watchdog();
  }
}
