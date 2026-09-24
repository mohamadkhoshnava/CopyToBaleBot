// lib/pump — the Bale side and the queue workers, both driven by ticks.
//
// Pump: holds a lease, long-polls Bale getUpdates for ~20s, turns channel posts
// into jobs and answers private chats directly, flushes finished albums, then
// ticks itself again. Workers: claim jobs until their budget runs out.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { PUMP, WORKER } from 'lib/config';
import { bale } from 'lib/bale';
import { kvGet, kvSet, acquire, logError } from 'lib/store';
import { now } from 'lib/util';
import { tick, kickWorkers } from 'lib/tick';
import { claim, done, retry, readyCount, enqueue } from 'lib/queue';
import { runJob, jobFailed } from 'lib/sync';
import { onChannelPost, onChannelEdit } from 'lib/channel';
import { onDM } from 'lib/dm';
import { onCallback } from 'lib/callbacks';
import { linkByChat } from 'lib/links';

async function onBaleUpdate(u) {
  const m = u.message || u.channel_post;
  if (m) {
    if (m.chat?.type === 'channel') return onChannelPost('bale', m);
    if (m.chat?.type === 'private') return onDM('bale', m);
    return;
  }
  const e = u.edited_message || u.edited_channel_post;
  if (e) {
    if (e.chat?.type === 'channel') return onChannelEdit('bale', e);
    return;
  }
  if (u.callback_query) return onCallback('bale', u.callback_query);
}

async function hasAlbums() {
  const r = await db.get(sql`SELECT 1 AS x FROM albums LIMIT 1`);
  return !!r;
}

// Albums arrive one item per update; a group is complete once it's been quiet for 2.5s.
export async function flushAlbums() {
  const cutoff = Date.now() - 2500;
  const groups = await db.all(sql`SELECT platform, chat_id, gid, MAX(at_ms) AS last FROM albums
    GROUP BY platform, chat_id, gid HAVING MAX(at_ms) < ${cutoff}`);
  for (const g of groups) {
    const { rows } = await db.run(sql`DELETE FROM albums WHERE platform = ${g.platform} AND chat_id = ${g.chat_id} AND gid = ${g.gid} RETURNING payload, msg_id`);
    if (!rows.length) continue; // another flusher took it
    const link = await linkByChat(g.platform, g.chat_id);
    if (!link) continue;
    const items = rows.sort((a, b) => a.msg_id - b.msg_id).map((r) => JSON.parse(r.payload));
    await enqueue('album', 'L' + link.id, { link_id: link.id, sp: g.platform, sc: g.chat_id, items });
  }
}

async function housekeeping() {
  if (!(await acquire('gc_at', Date.now() + 10 * 60e3))) return;
  const t = now();
  await db.run(sql`DELETE FROM jobs WHERE status IN ('done', 'fail') AND created_at < ${t - 3 * 86400}`);
  await db.run(sql`DELETE FROM claims WHERE at < ${t - 7 * 86400}`);
  await db.run(sql`DELETE FROM codes WHERE created_at < ${t - 86400}`);
  await db.run(sql`DELETE FROM sessions WHERE at < ${t - 86400}`);
  await db.run(sql`DELETE FROM errors WHERE at < ${t - 14 * 86400}`);
  await db.run(sql`DELETE FROM albums WHERE at_ms < ${Date.now() - 3600e3}`);
  await db.run(sql`DELETE FROM msgmap WHERE created_at < ${t - 180 * 86400}`);
  await db.run(sql`DELETE FROM kv WHERE k LIKE 'fw:%' AND CAST(json_extract(v, '$.at') AS INTEGER) < ${t - 86400}`);
}

export async function runPump() {
  const t0 = Date.now();
  if (!(await acquire('pump_lock', t0 + PUMP.lockMs))) return;
  let chain = true;
  try {
    let offset = Number(await kvGet('bale_offset', '0')) || 0;
    let failures = 0;
    while (Date.now() - t0 < PUMP.budgetMs) {
      const left = PUMP.budgetMs - (Date.now() - t0);
      const timeout = (await hasAlbums()) ? 1 : Math.max(1, Math.min(PUMP.pollTimeout, Math.floor(left / 1000) - 1));
      let ups;
      try {
        ups = await bale('getUpdates', { offset, timeout, limit: 50 });
        failures = 0;
      } catch (e) {
        await logError('pump:getUpdates', e);
        if (++failures >= 3) {
          // Bale unreachable: back off instead of spinning; the watchdog resumes later.
          const streak = Number(await kvGet('pump_fail_streak', '0')) + 1;
          await kvSet('pump_fail_streak', streak);
          if (streak >= 3) {
            await kvSet('pump_pause_until', Date.now() + 60e3);
            chain = false;
          }
          break;
        }
        continue;
      }
      await kvSet('pump_fail_streak', '0');
      for (const u of ups) {
        if (Date.now() - t0 > PUMP.budgetMs + 3000) break; // leave the rest for the next round
        try {
          await onBaleUpdate(u);
        } catch (e) {
          await logError('bale:update', e);
        }
        offset = u.update_id + 1;
        await kvSet('bale_offset', offset);
      }
      await flushAlbums();
      await kickWorkers();
      await kvSet('pump_beat', Date.now());
    }
    await housekeeping();
  } catch (e) {
    await logError('pump', e);
  } finally {
    await kvSet('pump_lock', '0');
    await kvSet('pump_beat', Date.now());
  }
  if (chain) await tick('pump');
}

async function takeSlot() {
  for (let i = 1; i <= WORKER.slots; i++) {
    if (await acquire('wslot:' + i, Date.now() + WORKER.leaseSec * 1000)) return i;
  }
  return 0;
}

export async function runWorker() {
  const t0 = Date.now();
  const slot = await takeSlot();
  if (!slot) return;
  let more = false;
  try {
    while (Date.now() - t0 < WORKER.budgetMs) {
      const job = await claim();
      if (!job) break;
      try {
        await runJob(job);
        await done(job.id);
      } catch (e) {
        await logError('job:' + job.kind + '#' + job.id, e);
        if (await retry(job, e)) await jobFailed(job, e);
      }
    }
    more = (await readyCount()) > 0;
  } finally {
    await kvSet('wslot:' + slot, '0');
  }
  if (more) await tick('job');
}
