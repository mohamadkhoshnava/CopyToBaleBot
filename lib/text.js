// lib/text — "rich text" = { text, entities } with Telegram-style entities
// (UTF-16 offsets, which is what JS string indices are). All rewriting keeps
// entity offsets consistent, then renders to Telegram entities or Bale markdown.
import { escRe } from 'lib/util';

// Replace every match of `re` (global) with `repl` and remap entities.
export function rewrite(rich, re, repl) {
  const text = rich.text || '';
  const edits = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(text))) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    const r = typeof repl === 'function' ? repl(m) : repl;
    edits.push({ s: m.index, e: m.index + m[0].length, r: r ?? '' });
  }
  if (!edits.length) return rich;

  let out = '';
  let pos = 0;
  for (const ed of edits) {
    out += text.slice(pos, ed.s) + ed.r;
    pos = ed.e;
  }
  out += text.slice(pos);

  const mapPos = (p, isEnd) => {
    let delta = 0;
    for (const ed of edits) {
      if (ed.e <= p) { delta += ed.r.length - (ed.e - ed.s); continue; }
      if (ed.s < p) { const ns = ed.s + delta; return isEnd ? ns + ed.r.length : ns; }
      break;
    }
    return p + delta;
  };

  const entities = [];
  for (const e of rich.entities || []) {
    const s = mapPos(e.offset, false);
    const en = mapPos(e.offset + e.length, true);
    if (en > s) entities.push({ ...e, offset: s, length: en - s });
  }
  return { text: out, entities };
}

// rules: [{ from, to, word }] — applied simultaneously, case-insensitive.
// `word` stops "@chan" from matching inside "@chan_backup".
export function replaceRules(rich, rules) {
  rules = rules.filter((r) => r.from);
  if (!rules.length) return rich;
  rules.sort((a, b) => b.from.length - a.from.length);
  const re = new RegExp(rules.map((r) => escRe(r.from) + (r.word ? '(?![A-Za-z0-9_])' : '')).join('|'), 'gi');
  const pick = (s) => rules.find((r) => r.from.toLowerCase() === s.toLowerCase())?.to ?? s;
  const out = rewrite(rich, re, (m) => pick(m[0]));
  out.entities = out.entities.map((e) => (e.url ? { ...e, url: e.url.replace(re, (s) => pick(s)) } : e));
  return out;
}

const LINK_RE = /(?:https?:\/\/|www\.)\S+|(?<![\w.])(?:t\.me|telegram\.me|ble\.ir)\/\S+/gi;
export function stripLinks(rich) {
  const out = rewrite(rich, LINK_RE, '');
  out.entities = out.entities.filter((e) => e.type !== 'text_link' && e.type !== 'url');
  return out;
}

export function stripMentions(rich) {
  return rewrite(rich, /(?<![\w@])@[A-Za-z][A-Za-z0-9_]{3,}/g, '');
}

export function tidy(rich) {
  let r = rewrite(rich, /[ \t]+\n/g, '\n');
  r = rewrite(r, /\n{3,}/g, '\n\n');
  return rewrite(r, /^\s+|\s+$/g, '');
}

export function appendPlain(rich, s) {
  if (!s) return rich;
  return { text: rich.text ? rich.text + '\n\n' + s : s, entities: rich.entities || [] };
}

export function prependPlain(rich, s) {
  if (!s) return rich;
  if (!rich.text) return { text: s, entities: [] };
  const shift = s.length + 2;
  return {
    text: s + '\n\n' + rich.text,
    entities: (rich.entities || []).map((e) => ({ ...e, offset: e.offset + shift })),
  };
}

export function sliceRich(rich, a, b) {
  const entities = [];
  for (const e of rich.entities || []) {
    const s = Math.max(e.offset, a);
    const en = Math.min(e.offset + e.length, b);
    if (en > s) entities.push({ ...e, offset: s - a, length: en - s });
  }
  return { text: rich.text.slice(a, b), entities };
}

// Split into chunks of at most `max` UTF-16 units, preferring line breaks.
export function splitRich(rich, max) {
  const text = rich.text || '';
  const out = [];
  let base = 0;
  while (text.length - base > max) {
    let cut = text.lastIndexOf('\n', base + max);
    if (cut <= base + max * 0.5) cut = text.lastIndexOf(' ', base + max);
    if (cut <= base + max * 0.5) cut = base + max;
    const c = text.charCodeAt(cut - 1);
    if (c >= 0xd800 && c <= 0xdbff) cut--;
    out.push(sliceRich(rich, base, cut));
    base = cut;
    while (text[base] === '\n' || text[base] === ' ') base++;
  }
  out.push(sliceRich(rich, base, text.length));
  return out.filter((r) => r.text.length);
}

const TG_TYPES = new Set([
  'bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'code', 'pre',
  'text_link', 'blockquote', 'expandable_blockquote',
]);

// Entities safe to send to Telegram from another platform.
export function tgEntities(entities) {
  const out = [];
  for (const e of entities || []) {
    if (!TG_TYPES.has(e.type) || !(e.length > 0)) continue;
    if (e.type === 'text_link' && !/^https?:\/\//i.test(e.url || '')) continue;
    const x = { type: e.type, offset: e.offset, length: e.length };
    if (e.url) x.url = e.url;
    if (e.language) x.language = e.language;
    out.push(x);
  }
  return out.length ? out : undefined;
}

// Rich text -> Bale markdown. Bale understands *bold*, _italic_, [text](url).
export function renderBale(rich) {
  const text = rich.text || '';
  let ents = (rich.entities || [])
    .filter((e) => e.type === 'bold' || e.type === 'italic' || (e.type === 'text_link' && e.url))
    .map((e) => ({ ...e }));
  for (const e of ents) {
    while (e.length > 0 && /\s/.test(text[e.offset])) { e.offset++; e.length--; }
    while (e.length > 0 && /\s/.test(text[e.offset + e.length - 1])) e.length--;
  }
  ents = ents.filter((e) => e.length > 0).sort((a, b) => a.offset - b.offset || b.length - a.length);

  // Keep only properly nested entities.
  const kept = [];
  for (const e of ents) {
    const ok = kept.every((k) => {
      const ke = k.offset + k.length;
      const ee = e.offset + e.length;
      return ee <= k.offset || e.offset >= ke || (e.offset >= k.offset && ee <= ke);
    });
    if (ok) kept.push(e);
  }
  if (!kept.length) return text;

  const opens = new Map();
  const closes = new Map();
  const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
  for (const e of kept) {
    const [o, c] = e.type === 'bold' ? ['*', '*'] : e.type === 'italic' ? ['_', '_'] : ['[', `](${e.url})`];
    push(opens, e.offset, { tok: o, len: e.length });
    push(closes, e.offset + e.length, { tok: c, start: e.offset });
  }
  let out = '';
  for (let i = 0; i <= text.length; i++) {
    const cl = closes.get(i);
    if (cl) out += cl.sort((a, b) => b.start - a.start).map((x) => x.tok).join('');
    const op = opens.get(i);
    if (op) out += op.sort((a, b) => b.len - a.len).map((x) => x.tok).join('');
    if (i < text.length) out += text[i];
  }
  return out;
}

// Fallback for Bale messages that arrive with raw markdown and no entities.
const BALE_MD = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(^|[\s(])\*([^*\n]+?)\*(?=$|[\s.,:;!?؟،)])|(^|[\s(])_([^_\n]+?)_(?=$|[\s.,:;!?؟،)])/g;
export function parseBaleMarkdown(text) {
  let out = '';
  const entities = [];
  let last = 0;
  let m;
  BALE_MD.lastIndex = 0;
  while ((m = BALE_MD.exec(text))) {
    out += text.slice(last, m.index);
    if (m[1] !== undefined) {
      entities.push({ type: 'text_link', offset: out.length, length: m[1].length, url: m[2] });
      out += m[1];
    } else if (m[4] !== undefined) {
      out += m[3];
      entities.push({ type: 'bold', offset: out.length, length: m[4].length });
      out += m[4];
    } else {
      out += m[5];
      entities.push({ type: 'italic', offset: out.length, length: m[6].length });
      out += m[6];
    }
    last = m.index + m[0].length;
  }
  out += text.slice(last);
  return { text: out, entities };
}
