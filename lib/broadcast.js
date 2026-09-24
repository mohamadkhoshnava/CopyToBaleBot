// lib/broadcast — admin messages to every user, sent in small slices by the queue.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { call, trySend } from 'lib/platform';
import { enqueue } from 'lib/queue';
import { markBlocked } from 'lib/store';
import { fa } from 'lib/util';

const SLICE = 25;

export async function runBroadcast({ bid }) {
  const b = await db.get(sql`SELECT * FROM broadcasts WHERE id = ${bid}`);
  if (!b || b.status !== 'run') return;
  const users = b.target === 'all'
    ? await db.all(sql`SELECT id, platform, uid FROM users WHERE id > ${b.cursor} AND blocked = 0 AND banned = 0 ORDER BY id LIMIT ${SLICE}`)
    : await db.all(sql`SELECT id, platform, uid FROM users WHERE id > ${b.cursor} AND platform = ${b.target} AND blocked = 0 AND banned = 0 ORDER BY id LIMIT ${SLICE}`);
  let sent = 0;
  let failed = 0;
  let cursor = b.cursor;
  for (const u of users) {
    cursor = u.id;
    try {
      if (u.platform === b.sp) {
        await call(u.platform, 'copyMessage', { chat_id: u.uid, from_chat_id: b.sc, message_id: b.sm });
      } else if (b.text) {
        await call(u.platform, 'sendMessage', { chat_id: u.uid, text: b.text });
      } else {
        continue;
      }
      sent++;
    } catch (e) {
      failed++;
      if (e?.code === 403) await markBlocked(u.platform, u.uid);
      if (e?.code === 429) { cursor = u.id - 1; break; }
    }
  }
  await db.run(sql`UPDATE broadcasts SET cursor = ${cursor}, sent = sent + ${sent}, failed = failed + ${failed} WHERE id = ${bid}`);
  if (users.length === SLICE || cursor !== (users[users.length - 1]?.id ?? cursor)) {
    await enqueue('bc', 'bc', { bid }, 1);
    return;
  }
  await db.run(sql`UPDATE broadcasts SET status = 'done' WHERE id = ${bid}`);
  const fin = await db.get(sql`SELECT * FROM broadcasts WHERE id = ${bid}`);
  await trySend(fin.sp, fin.by_uid, `📣 پیام همگانی #${fin.id} تمام شد.\n\n✅ ارسال موفق: ${fa(fin.sent)}\n❌ ناموفق: ${fa(fin.failed)}`);
}
