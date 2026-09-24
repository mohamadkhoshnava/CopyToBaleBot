// lib/platform — one interface over Telegram (sdk `api`) and Bale (lib/bale).
// UI text is written in a tiny HTML subset (<b>, <i>, <a>, <code>) and
// converted to Bale's markdown on the fly.
import { api } from 'sdk';
import { bale } from 'lib/bale';
import { markBlocked } from 'lib/store';

export function call(p, method, params) {
  return p === 'tg' ? api[method](params) : bale(method, params);
}

export const isNotModified = (e) => /not modified/i.test(e?.description || e?.message || '');
export const isGone = (e) => e?.code === 400 || e?.code === 404;

// Minimal HTML -> Bale markdown (*bold*, _italic_, [text](url)).
export function htmlToBale(html) {
  const wrap = (m) => (_, x) => {
    const lead = x.match(/^\s*/)[0];
    const tail = x.match(/\s*$/)[0];
    const core = x.trim();
    return core ? lead + m + core + m + tail : x;
  };
  return String(html)
    .replace(/<b>([\s\S]*?)<\/b>/g, wrap('*'))
    .replace(/<i>([\s\S]*?)<\/i>/g, wrap('_'))
    .replace(/<a href="([^"]+)">([\s\S]*?)<\/a>/g, '[$2]($1)')
    .replace(/<\/?[a-z][^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

// rows: [[{ text, cb } | { text, url } | { text, copy }]]
export function inlineKb(rows) {
  return {
    inline_keyboard: rows.filter((r) => r && r.length).map((r) => r.map((b) => {
      if (b.url) return { text: b.text, url: b.url };
      if (b.copy) return { text: b.text, copy_text: { text: b.copy } };
      return { text: b.text, callback_data: b.cb };
    })),
  };
}

export async function send(p, chatId, html, opt = {}) {
  const reply_markup = opt.kb ? inlineKb(opt.kb) : opt.markup;
  try {
    if (p === 'tg') {
      return await api.sendMessage({
        chat_id: chatId, text: html, parse_mode: 'HTML', reply_markup,
        link_preview_options: { is_disabled: true },
      });
    }
    return await bale('sendMessage', { chat_id: chatId, text: htmlToBale(html), reply_markup });
  } catch (e) {
    if (e?.code === 403 && chatId > 0) await markBlocked(p, chatId);
    throw e;
  }
}

export async function trySend(p, chatId, html, opt) {
  try { return await send(p, chatId, html, opt); } catch { return null; }
}

// Edit a bot message in place; falls back to sending a new one.
export async function edit(p, chatId, messageId, html, opt = {}) {
  const reply_markup = opt.kb ? inlineKb(opt.kb) : opt.markup;
  try {
    if (p === 'tg') {
      return await api.editMessageText({
        chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', reply_markup,
        link_preview_options: { is_disabled: true },
      });
    }
    return await bale('editMessageText', { chat_id: chatId, message_id: messageId, text: htmlToBale(html), reply_markup });
  } catch (e) {
    if (isNotModified(e)) return null;
    return send(p, chatId, html, opt);
  }
}

export async function answer(p, id, text, alert = false) {
  try {
    await call(p, 'answerCallbackQuery', { callback_query_id: id, text, show_alert: alert || undefined });
  } catch { /* expired queries are harmless */ }
}

export async function del(p, chatId, messageId) {
  try { await call(p, 'deleteMessage', { chat_id: chatId, message_id: messageId }); return true; } catch { return false; }
}

export async function getChat(p, ref) {
  return call(p, 'getChat', { chat_id: ref });
}

export async function getMember(p, chatId, userId) {
  return call(p, 'getChatMember', { chat_id: chatId, user_id: userId });
}
