// lib/deliver — send prepared content to the destination platform, moving file
// bytes across when needed. Returns the destination message ids.
import { api, InputFile, BotApiError } from 'sdk';
import { bale, baleFileUrl, baleDownloadPath } from 'lib/bale';
import { call } from 'lib/platform';
import { LIMITS } from 'lib/config';
import { splitRich, tgEntities, renderBale } from 'lib/text';

const METHOD = {
  photo: ['sendPhoto', 'photo'],
  video: ['sendVideo', 'video'],
  animation: ['sendAnimation', 'animation'],
  audio: ['sendAudio', 'audio'],
  voice: ['sendVoice', 'voice'],
  document: ['sendDocument', 'document'],
  sticker: ['sendSticker', 'sticker'],
};

const tooBig = () => Object.assign(new Error('file too large'), { tooBig: true });

function baseParams(dp, chatId, opt) {
  const p = { chat_id: chatId };
  if (dp === 'tg') {
    if (opt.reply) p.reply_parameters = { message_id: opt.reply, allow_sending_without_reply: true };
    if (opt.silent) p.disable_notification = true;
  } else if (opt.reply) {
    p.reply_to_message_id = opt.reply;
  }
  return p;
}

function textParams(dp, rich) {
  return dp === 'tg' ? { text: rich.text, entities: tgEntities(rich.entities) } : { text: renderBale(rich) };
}

function captionParams(dp, rich) {
  if (!rich.text) return {};
  return dp === 'tg'
    ? { caption: rich.text, caption_entities: tgEntities(rich.entities) }
    : { caption: renderBale(rich) };
}

async function sendRich(dp, chatId, rich, params) {
  return call(dp, 'sendMessage', { ...params, ...textParams(dp, rich) });
}

// Bytes of a source file. Bale's info is returned too so callers can reuse the path.
async function fetchBytes(sp, f) {
  if (f.size > LIMITS.download) throw tooBig();
  try {
    if (sp === 'tg') return await api.getFileContent(f.id);
    const info = await bale('getFile', { file_id: f.id });
    return await baleDownloadPath(info.file_path);
  } catch (e) {
    if (e.tooBig || /too big|too large/i.test(e.description || e.message || '')) throw tooBig();
    throw e;
  }
}

// Bale -> Telegram: let Telegram pull the file by URL first (no bytes through the
// isolate). Falls back to uploading bytes.
async function tgFromBaleUrl(kind, f, params) {
  if (!['photo', 'video', 'animation'].includes(kind)) return null;
  if (f.size > (kind === 'photo' ? 5 : 20) * 1024 * 1024) return null;
  try {
    const info = await bale('getFile', { file_id: f.id });
    const [method, field] = METHOD[kind];
    return await api[method]({ ...params, [field]: baleFileUrl(info.file_path) });
  } catch (e) {
    if (e instanceof BotApiError && (e.code === 429 || e.code === 403)) throw e;
    return null;
  }
}

async function sendFile(sp, dp, kind, f, params) {
  if (dp === 'tg' && sp === 'bale') {
    const m = await tgFromBaleUrl(kind, f, params);
    if (m) return m;
  }
  const bytes = await fetchBytes(sp, f);
  let k = kind;
  if (k === 'photo' && bytes.length > LIMITS.photo) k = 'document';
  const input = () => new InputFile(bytes, f.name, { type: f.mime });
  const [method, field] = METHOD[k];
  try {
    return await call(dp, method, { ...params, [field]: input() });
  } catch (e) {
    if (e.code === 429 || e.code === 403 || k === 'document') throw e;
    if (k === 'sticker') return null; // unsupported sticker format on the other side
    // Unsupported format for a specialised method (e.g. a voice codec): send as a file.
    return call(dp, 'sendDocument', { ...params, document: input() });
  }
}

// opt.onSent(message) runs right after every destination message is created.
export async function deliver(sp, dp, chatId, c, opt = {}) {
  const ids = [];
  const emit = async (m) => {
    if (!m) return;
    ids.push(m.message_id);
    if (opt.onSent) await opt.onSent(m, ids.length === 1 ? 'main' : 'extra');
  };
  const first = baseParams(dp, chatId, opt);
  const rest = baseParams(dp, chatId, { silent: opt.silent });
  const rich = { text: c.text || '', entities: c.entities || [] };
  const sendTail = async (r, params) => {
    for (const part of splitRich(r, LIMITS.text[dp])) await emit(await sendRich(dp, chatId, part, ids.length ? rest : params));
  };

  if (c.kind === 'text') {
    await sendTail(rich, first);
    return ids;
  }
  if (c.kind === 'location') {
    await emit(await call(dp, 'sendLocation', { ...first, ...c.extra }));
    if (rich.text) await sendTail(rich, rest);
    return ids;
  }
  if (c.kind === 'contact') {
    await emit(await call(dp, 'sendContact', { ...first, ...c.extra }));
    return ids;
  }

  // Media with caption. Over-long captions go into follow-up text messages.
  const capFits = rich.text.length <= LIMITS.caption[dp];
  let m;
  try {
    m = await sendFile(sp, dp, c.kind, c.file, { ...first, ...(capFits ? captionParams(dp, rich) : {}) });
  } catch (e) {
    if (!e.tooBig) throw e;
    const note = '📎 فایل این پست بیش از ۲۰ مگابایت است و قابل انتقال خودکار نبود.';
    const r = opt.bigNote ? { text: rich.text ? rich.text + '\n\n' + note : note, entities: rich.entities } : rich;
    if (r.text) await sendTail(r, first);
    return ids;
  }
  await emit(m);
  if (!capFits && rich.text) await sendTail(rich, m ? rest : first);
  return ids;
}

const ALBUM_KINDS = new Set(['photo', 'video', 'document', 'audio']);

// Album: one destination media group. Returns ids per source item.
// opt.onSent(message, role, itemIndex) runs as each destination message is created.
export async function deliverAlbum(sp, dp, chatId, items, opt = {}) {
  const groupable = items.length > 1 && items.length <= 10 && items.every((c) => ALBUM_KINDS.has(c.kind) && c.file && c.file.size <= LIMITS.download);
  if (groupable) {
    try {
      return await sendGroup(sp, dp, chatId, items, opt);
    } catch (e) {
      if (e.code === 429 || e.code === 403 || e.sentPartially) throw e;
      console.warn('album send failed, falling back to single posts', e.description || e.message);
    }
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const onSent = opt.onSent ? (m, role) => opt.onSent(m, role, i) : undefined;
    out.push(await deliver(sp, dp, chatId, items[i], { ...opt, reply: i === 0 ? opt.reply : undefined, onSent }));
  }
  return out;
}

async function sendGroup(sp, dp, chatId, items, opt) {
  const capMax = LIMITS.caption[dp];
  const tails = [];
  const media = [];
  for (const c of items) {
    const rich = { text: c.text || '', entities: c.entities || [] };
    const fits = rich.text.length <= capMax;
    if (!fits) tails.push(rich);
    let src;
    if (dp === 'tg' && sp === 'bale' && c.kind === 'photo' && c.file.size <= 5 * 1024 * 1024) {
      const info = await bale('getFile', { file_id: c.file.id });
      src = baleFileUrl(info.file_path);
    } else {
      const bytes = await fetchBytes(sp, c.file);
      if (c.kind === 'photo' && bytes.length > LIMITS.photo) throw new Error('photo too large for album');
      src = new InputFile(bytes, c.file.name, { type: c.file.mime });
    }
    media.push({ type: c.kind, media: src, ...(fits ? captionParams(dp, rich) : {}) });
  }
  const msgs = await call(dp, 'sendMediaGroup', { ...baseParams(dp, chatId, opt), media });
  const list = Array.isArray(msgs) ? msgs : [msgs];
  const out = items.map(() => []);
  for (let i = 0; i < items.length; i++) {
    if (!list[i]) continue;
    out[i].push(list[i].message_id);
    if (opt.onSent) await opt.onSent(list[i], 'main', i);
  }
  try {
    for (const r of tails) {
      for (const part of splitRich(r, LIMITS.text[dp])) {
        const m = await sendRich(dp, chatId, part, baseParams(dp, chatId, { silent: opt.silent }));
        out[0].push(m.message_id);
        if (opt.onSent) await opt.onSent(m, 'extra', 0);
      }
    }
  } catch (e) {
    e.sentPartially = true; // the album itself is out; never resend it as singles
    throw e;
  }
  return out;
}
