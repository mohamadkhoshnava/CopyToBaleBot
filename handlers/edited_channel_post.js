// handlers/edited_channel_post — edits in Telegram channels.
import { onChannelEdit } from 'lib/channel';
import { watchdog } from 'lib/tick';
import { logError } from 'lib/store';

export default async function (post) {
  try {
    await onChannelEdit('tg', post);
  } catch (e) {
    await logError('tg:edited_channel_post', e);
  } finally {
    await watchdog();
  }
}
