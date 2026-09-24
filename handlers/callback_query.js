// handlers/callback_query — inline button presses on Telegram.
import { onCallback } from 'lib/callbacks';
import { watchdog } from 'lib/tick';
import { logError } from 'lib/store';

export default async function (query) {
  try {
    await onCallback('tg', query);
  } catch (e) {
    await logError('tg:callback_query', e);
  } finally {
    await watchdog();
  }
}
