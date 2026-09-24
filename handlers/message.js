// handlers/message — private chats with the bot on Telegram.
import { onDM } from 'lib/dm';
import { watchdog } from 'lib/tick';
import { logError } from 'lib/store';

export default async function (message) {
  try {
    if (message.chat?.type === 'private') await onDM('tg', message);
  } catch (e) {
    await logError('tg:message', e);
  } finally {
    await watchdog();
  }
}
