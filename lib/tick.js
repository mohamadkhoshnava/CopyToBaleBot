// lib/tick — the self-wake mechanism.
//
// Telegram Serverless only runs code when the bot receives a Telegram update,
// and has no timers. But a bot that stops its own poll receives a `poll`
// update — so sendPoll + stopPoll (+ delete) wakes our `handlers/poll` in a
// fresh invocation. The Bale pump and the queue workers chain themselves with
// these ticks; `watchdog()` (run on every Telegram update) restarts the pump
// if the chain ever breaks.
import { api } from 'sdk';
import { ADMINS, TICK_Q, PUMP, WORKER } from 'lib/config';
import { kvGet, kvSet, kvJSON, acquire, logError } from 'lib/store';
import { readyCount } from 'lib/queue';

export async function tickerChats() {
  const list = await kvJSON('tickers', []);
  return list.length ? list.map((t) => t.id) : [ADMINS.tg[0]];
}

export async function tick(kind) {
  const chats = await tickerChats();
  const start = Number(await kvGet('tick_rr', '0')) || 0;
  for (let a = 0; a < chats.length; a++) {
    const i = (start + a) % chats.length;
    const chat = chats[i];
    try {
      const m = await api.sendPoll({
        chat_id: chat, question: TICK_Q[kind], options: [{ text: '1' }, { text: '2' }],
        disable_notification: true,
      });
      await api.stopPoll({ chat_id: chat, message_id: m.message_id });
      try { await api.deleteMessage({ chat_id: chat, message_id: m.message_id }); } catch { /* ignore */ }
      if (chats.length > 1) await kvSet('tick_rr', (i + 1) % chats.length);
      return true;
    } catch (e) {
      await logError('tick:' + chat, e);
    }
  }
  return false;
}

async function freeSlots() {
  let n = 0;
  for (let i = 1; i <= WORKER.slots; i++) {
    if (Number(await kvGet('wslot:' + i, '0')) < Date.now()) n++;
  }
  return n;
}

// Start a worker if there's ready work and a free slot (at most one kick per 2s).
export async function kickWorkers() {
  if (!(await readyCount())) return;
  if (!(await freeSlots())) return;
  if (!(await acquire('kick_at', Date.now() + 2000))) return;
  await tick('job');
}

export async function watchdog() {
  try {
    const beat = Number(await kvGet('pump_beat', '0'));
    if (Date.now() - beat < PUMP.staleMs) return;
    if (Number(await kvGet('pump_lock', '0')) > Date.now()) return;
    if (Number(await kvGet('pump_pause_until', '0')) > Date.now()) return;
    if (!(await acquire('wd_at', Date.now() + 20000))) return;
    await tick('pump');
  } catch (e) {
    await logError('watchdog', e);
  }
}
