// handlers/poll — self-wake ticks (see lib/tick). Only polls this bot sent
// produce `poll` updates, and we only act once they are closed.
import { TICK_Q } from 'lib/config';
import { runPump, runWorker } from 'lib/pump';
import { logError } from 'lib/store';

export default async function (poll) {
  if (!poll.is_closed) return;
  try {
    if (poll.question === TICK_Q.pump) await runPump();
    else if (poll.question === TICK_Q.job) await runWorker();
  } catch (e) {
    await logError('tg:poll', e);
  }
}
