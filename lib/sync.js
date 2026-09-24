// lib/sync — the job runners that actually copy, edit, delete and pin posts.
import { db } from 'sdk';
import { sql } from 'sdk/db';
import { OTHER, PNAME, LIMITS } from 'lib/config';
import {
  getLink, S, allowed, dirOf, chatOf, saveMap, bump, linkTitle,
} from 'lib/links';
import { extract, prepare } from 'lib/content';
import { deliver, deliverAlbum } from 'lib/deliver';
import { call, isNotModified, isGone, trySend } from 'lib/platform';
import { tgEntities, renderBale, sliceRich } from 'lib/text';
import { statInc } from 'lib/store';
import { now, esc, errText } from 'lib/util';
import { runBroadcast } from 'lib/broadcast';

export async function runJob(job) {
  const P = JSON.parse(job.payload);
  switch (job.kind) {
    case 'post': return syncPost(P);
    case 'album': return syncAlbum(P);
    case 'edit': return syncEdit(P);
    case 'del': return syncDelete(P);
    case 'pin': return syncPin(P);
    case 'bc': return runBroadcast(P);
    default: console.warn('unknown job', job.kind);
  }
}

async function replyTarget(link, sp, sc, msg) {
  const r = msg.reply_to_message?.message_id;
  if (!r || !S(link).replies) return undefined;
  const row = await db.get(sql`SELECT dm FROM msgmap WHERE sp = ${sp} AND sc = ${sc} AND sm = ${r} AND role = 'main' LIMIT 1`);
  if (row) return row.dm;
  // The replied post may itself be a copy from the other side.
  const back = await db.get(sql`SELECT sm FROM msgmap WHERE dp = ${sp} AND dc = ${sc} AND dm = ${r} LIMIT 1`);
  return back?.sm;
}

// P: { link_id, sp, sc, sm, msg, manual? }
async function syncPost(P) {
  const link = await getLink(P.link_id);
  if (!link) return;
  const dir = dirOf(P.sp);
  if (!P.manual && !allowed(link, dir)) return;
  const content = extract(P.sp, P.msg);
  if (!content) return;
  const prepared = prepare(link, dir, content, { manual: P.manual });
  if (!prepared) { await statInc('skipped'); return; }
  const dp = OTHER[P.sp];
  const dc = chatOf(link, dp);
  const s = S(link);
  const reply = P.manual ? undefined : await replyTarget(link, P.sp, P.sc, P.msg);
  const ids = await deliver(P.sp, dp, dc, prepared, { reply, silent: s.silent, bigNote: s.bigNote });
  if (!ids.length) return;
  await saveMap(link.id, P.sp, P.sc, P.sm, dp, dc, ids);
  await bump(link, dir);
  await statInc('sync_' + dir);
}

// P: { link_id, sp, sc, items: [msg] }
async function syncAlbum(P) {
  const link = await getLink(P.link_id);
  if (!link) return;
  const dir = dirOf(P.sp);
  if (!allowed(link, dir)) return;
  const msgs = P.items.slice().sort((a, b) => a.message_id - b.message_id);
  const src = [];
  for (const m of msgs) {
    const c = extract(P.sp, m);
    if (!c) continue;
    const p = prepare(link, dir, c);
    if (p) src.push({ m, c: p });
  }
  // Header/footer belong once per album: keep them only on the captioned item.
  if (src.length > 1) {
    const s = S(link);
    const h = s['header_' + dir];
    const f = s['footer_' + dir];
    const captioned = src.findIndex((x) => (x.m.caption || '').trim());
    src.forEach((x, i) => {
      if (i === (captioned < 0 ? 0 : captioned)) return;
      let r = { text: x.c.text, entities: x.c.entities };
      if (h && r.text.startsWith(h)) r = sliceRich(r, Math.min(r.text.length, h.length + 2), r.text.length);
      if (f && r.text.endsWith(f)) r = sliceRich(r, 0, Math.max(0, r.text.length - f.length - 2));
      x.c = { ...x.c, text: r.text.trim() ? r.text : '', entities: r.entities };
    });
  }
  if (!src.length) return;
  const dp = OTHER[P.sp];
  const dc = chatOf(link, dp);
  const s = S(link);
  const reply = await replyTarget(link, P.sp, P.sc, msgs[0]);
  const out = await deliverAlbum(P.sp, dp, dc, src.map((x) => x.c), { reply, silent: s.silent, bigNote: s.bigNote });
  for (let i = 0; i < src.length; i++) {
    if (out[i]?.length) await saveMap(link.id, P.sp, P.sc, src[i].m.message_id, dp, dc, out[i]);
  }
  await bump(link, dir);
  await statInc('sync_' + dir);
}

// P: { link_id, sp, sc, sm, msg }
async function syncEdit(P) {
  const link = await getLink(P.link_id);
  if (!link || !S(link).edits) return;
  const dir = dirOf(P.sp);
  if (!allowed(link, dir)) return;
  const rows = await db.all(sql`SELECT dp, dc, dm FROM msgmap WHERE sp = ${P.sp} AND sc = ${P.sc} AND sm = ${P.sm} AND role = 'main'`);
  if (!rows.length) return;
  const content = extract(P.sp, P.msg);
  if (!content) return;
  const prepared = prepare(link, dir, content);
  if (!prepared) return;
  const rich = { text: prepared.text || '', entities: prepared.entities || [] };
  for (const r of rows) {
    const isText = content.kind === 'text';
    const max = isText ? LIMITS.text[r.dp] : LIMITS.caption[r.dp];
    const cut = rich.text.length > max ? sliceRich(rich, 0, max) : rich;
    try {
      if (isText) {
        await call(r.dp, 'editMessageText', r.dp === 'tg'
          ? { chat_id: r.dc, message_id: r.dm, text: cut.text, entities: tgEntities(cut.entities) }
          : { chat_id: r.dc, message_id: r.dm, text: renderBale(cut) });
      } else if (content.file) {
        await call(r.dp, 'editMessageCaption', r.dp === 'tg'
          ? { chat_id: r.dc, message_id: r.dm, caption: cut.text, caption_entities: tgEntities(cut.entities) }
          : { chat_id: r.dc, message_id: r.dm, caption: renderBale(cut) });
      }
    } catch (e) {
      if (!isNotModified(e)) throw e;
    }
  }
  await statInc('edits');
}

// P: { link_id, sp, sc, sm } — delete this post and every copy of it.
async function syncDelete(P) {
  const link = await getLink(P.link_id);
  const both = !link || S(link).deletes;
  const targets = new Map();
  const add = (p, c, m) => targets.set(`${p}:${c}:${m}`, { p, c, m });
  add(P.sp, P.sc, P.sm);
  if (both) {
    // Rows where it is the source, plus rows where it is itself a copy.
    const orig = await db.get(sql`SELECT sp, sc, sm FROM msgmap WHERE dp = ${P.sp} AND dc = ${P.sc} AND dm = ${P.sm} LIMIT 1`);
    const root = orig || { sp: P.sp, sc: P.sc, sm: P.sm };
    add(root.sp, root.sc, root.sm);
    const copies = await db.all(sql`SELECT dp, dc, dm FROM msgmap WHERE sp = ${root.sp} AND sc = ${root.sc} AND sm = ${root.sm}`);
    for (const r of copies) add(r.dp, r.dc, r.dm);
    await db.run(sql`DELETE FROM msgmap WHERE sp = ${root.sp} AND sc = ${root.sc} AND sm = ${root.sm}`);
  }
  for (const t of targets.values()) {
    try {
      await call(t.p, 'deleteMessage', { chat_id: t.c, message_id: t.m });
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }
  await statInc('deletes');
}

// P: { link_id, sp, sc, sm }
async function syncPin(P) {
  const link = await getLink(P.link_id);
  if (!link || !S(link).pins) return;
  const row = await db.get(sql`SELECT dp, dc, dm FROM msgmap WHERE sp = ${P.sp} AND sc = ${P.sc} AND sm = ${P.sm} AND role = 'main' LIMIT 1`);
  if (!row) return;
  await call(row.dp, 'pinChatMessage', { chat_id: row.dc, message_id: row.dm, disable_notification: true });
}

// Called when a job fails for good: record and tell the owners (at most every 6h).
export async function jobFailed(job, e) {
  let P;
  try { P = JSON.parse(job.payload); } catch { return; }
  if (!P.link_id) return;
  const link = await getLink(P.link_id);
  if (!link) return;
  await db.run(sql`UPDATE links SET err_count = err_count + 1, last_err = ${errText(e)} WHERE id = ${link.id}`);
  if (now() - (link.err_notified_at || 0) < 6 * 3600) return;
  await db.run(sql`UPDATE links SET err_notified_at = ${now()} WHERE id = ${link.id}`);
  const dir = P.sp ? `${PNAME[P.sp]} ➜ ${PNAME[OTHER[P.sp]]}` : '';
  const html = `⚠️ <b>خطا در همگام‌سازی</b>\n\nاتصال #${link.id}: ${esc(linkTitle(link))}\n${dir ? 'مسیر: ' + dir + '\n' : ''}خطا: <code>${esc(errText(e))}</code>\n\nمعمولاً یعنی ربات در یکی از کانال‌ها ادمین نیست یا دسترسی ارسال/ویرایش/حذف ندارد. از «📋 اتصال‌های من ← 🩺 بررسی دسترسی‌ها» وضعیت را چک کن.`;
  const kb = [[{ text: '⚙️ مدیریت اتصال', cb: 'lk:' + link.id }]];
  if (link.owner_tg) await trySend('tg', link.owner_tg, html, { kb });
  if (link.owner_bale) await trySend('bale', link.owner_bale, html, { kb });
}
