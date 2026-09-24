// lib/channel — incoming channel posts and edits from either platform.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { BOT_ID, CODE_RE, PNAME, OTHER } from 'lib/config';
import { linkByChat, allowed, dirOf, S, isOurCopy, claimEcho } from 'lib/links';
import { getCode, linkWithCode, verifyChannel, setOwner } from 'lib/linking';
import { enqueue } from 'lib/queue';
import { kickWorkers } from 'lib/tick';
import { claimOnce, logError } from 'lib/store';
import { del, trySend } from 'lib/platform';
import { esc } from 'lib/util';
import { linkCreatedHtml } from 'lib/screens';

const DEL_RE = /^[/#!](del|delete|حذف)(@\w+)?$/i;

export async function onChannelPost(p, m) {
  const chatId = m.chat.id;
  if (p === 'bale' && m.from?.id === BOT_ID.bale) return;
  // Bale reports our own copies back; they're checked again inside the job.
  if (p === 'bale' ? await claimEcho(chatId, m) : await isOurCopy(p, chatId, m.message_id)) return;

  const text = (m.text || '').trim();
  if (CODE_RE.test(text.toUpperCase())) return channelCode(p, m, text.toUpperCase());

  const link = await linkByChat(p, chatId);
  if (!link) return;

  if (DEL_RE.test(text) && m.reply_to_message) {
    await del(p, chatId, m.message_id);
    await enqueue('del', 'L' + link.id, { link_id: link.id, sp: p, sc: chatId, sm: m.reply_to_message.message_id });
    return kick(p);
  }
  if (!allowed(link, dirOf(p))) return;

  if (m.pinned_message) {
    if (S(link).pins) {
      await enqueue('pin', 'L' + link.id, { link_id: link.id, sp: p, sc: chatId, sm: m.pinned_message.message_id });
      await kick(p);
    }
    return;
  }
  if (!(await claimOnce(`${p}:${chatId}:${m.message_id}`))) return;

  if (m.media_group_id) {
    await db.run(sql`INSERT INTO albums (platform, chat_id, gid, msg_id, payload, at_ms)
      VALUES (${p}, ${chatId}, ${String(m.media_group_id)}, ${m.message_id}, ${JSON.stringify(m)}, ${Date.now()})
      ON CONFLICT DO NOTHING`);
    return;
  }
  await enqueue('post', 'L' + link.id, { link_id: link.id, sp: p, sc: chatId, sm: m.message_id, msg: m });
  await kick(p);
}

export async function onChannelEdit(p, m) {
  const link = await linkByChat(p, m.chat.id);
  if (!link || !S(link).edits || !allowed(link, dirOf(p))) return;
  // Copies we made are edited by us; ignore echoes.
  if (await isOurCopy(p, m.chat.id, m.message_id)) return;
  await enqueue('edit', 'L' + link.id, { link_id: link.id, sp: p, sc: m.chat.id, sm: m.message_id, msg: m });
  await kick(p);
}

// Telegram handlers kick workers right away; the Bale pump kicks after each batch.
async function kick(p) {
  if (p === 'tg') await kickWorkers();
}

// A pairing code posted inside a channel proves the poster administers it.
async function channelCode(p, m, code) {
  const row = await getCode(code);
  if (!row) return;
  const v = await verifyChannel(p, m.chat.id, null);
  const res = v.ok ? await linkWithCode(row, p, v.chat, null) : { ok: false, error: v.problems.join('\n') };
  await del(p, m.chat.id, m.message_id);
  if (res.ok) {
    // On Bale the poster may be visible; if they're an admin, give them access too.
    const poster = m.from && !m.from.is_bot ? m.from.id : null;
    if (poster) {
      const pv = await verifyChannel(p, m.chat.id, poster).catch(() => null);
      if (pv?.ok) await setOwner(res.link, p, poster);
    }
    const { html, kb } = linkCreatedHtml(res.link);
    await trySend(row.platform, row.owner_uid, html, { kb });
  } else {
    await trySend(row.platform, row.owner_uid,
      `❌ اتصال با کد <code>${esc(code)}</code> در کانال ${PNAME[OTHER[row.platform]]} انجام نشد:\n\n${res.error}`);
  }
}

export async function safeChannelPost(p, m) {
  try { await onChannelPost(p, m); } catch (e) { await logError('channel_post:' + p, e); }
}
