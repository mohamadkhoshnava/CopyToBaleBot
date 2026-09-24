// lib/content — turn a platform message into a neutral "content" object and
// apply a link's settings (filters, replacements, header/footer) to it.
import { S } from 'lib/links';
import {
  replaceRules, stripLinks, stripMentions, tidy, appendPlain, prependPlain, parseBaleMarkdown,
} from 'lib/text';

function file(f, name, mime) {
  return { id: f.file_id, size: f.file_size || 0, name: f.file_name || name, mime: f.mime_type || mime };
}

// -> { kind, typeKey, text, entities, file?, extra? } or null for service/unsupported messages.
export function extract(sp, m) {
  let text = m.text ?? m.caption ?? '';
  let entities = m.entities ?? m.caption_entities ?? [];
  if (sp === 'bale' && text && !entities.length) ({ text, entities } = parseBaleMarkdown(text));
  const base = { text, entities };

  if (m.photo?.length) {
    const ph = m.photo[m.photo.length - 1];
    return { ...base, kind: 'photo', typeKey: 'photo', file: file(ph, 'photo.jpg', 'image/jpeg') };
  }
  if (m.animation) return { ...base, kind: 'animation', typeKey: 'animation', file: file(m.animation, 'animation.mp4', 'video/mp4') };
  if (m.video) return { ...base, kind: 'video', typeKey: 'video', file: file(m.video, 'video.mp4', 'video/mp4') };
  if (m.video_note) return { ...base, kind: 'video', typeKey: 'video', file: file(m.video_note, 'video_note.mp4', 'video/mp4') };
  if (m.audio) return { ...base, kind: 'audio', typeKey: 'audio', file: file(m.audio, 'audio.mp3', 'audio/mpeg') };
  if (m.voice) return { ...base, kind: 'voice', typeKey: 'voice', file: file(m.voice, 'voice.ogg', 'audio/ogg') };
  if (m.document) return { ...base, kind: 'document', typeKey: 'document', file: file(m.document, 'file', 'application/octet-stream') };
  if (m.sticker) {
    if (m.sticker.is_animated) return null; // .tgs has no equivalent on Bale
    const ext = m.sticker.is_video ? 'webm' : 'webp';
    return { kind: 'sticker', typeKey: 'sticker', text: '', entities: [], file: file(m.sticker, 'sticker.' + ext, 'image/' + ext) };
  }
  if (m.location) {
    const v = m.venue;
    return {
      kind: 'location', typeKey: 'location', text: v ? [v.title, v.address].filter(Boolean).join('\n') : '', entities: [],
      extra: { latitude: m.location.latitude, longitude: m.location.longitude },
    };
  }
  if (m.contact) {
    return {
      kind: 'contact', typeKey: 'contact', text: '', entities: [],
      extra: { phone_number: m.contact.phone_number, first_name: m.contact.first_name, last_name: m.contact.last_name },
    };
  }
  if (m.poll) {
    const lines = ['📊 ' + m.poll.question, '', ...m.poll.options.map((o) => '▫️ ' + o.text)];
    return { kind: 'text', typeKey: 'poll', text: lines.join('\n'), entities: [] };
  }
  if (m.dice) return { kind: 'text', typeKey: 'text', text: m.dice.emoji, entities: [] };
  if (text) return { ...base, kind: 'text', typeKey: 'text' };
  return null;
}

function autoRules(link, dir) {
  const tu = link.tg_user;
  const bu = link.bale_user;
  if (!tu || !bu || tu.toLowerCase() === bu.toLowerCase()) return [];
  if (dir === 't2b') {
    return [
      { from: '@' + tu, to: '@' + bu, word: true },
      { from: 't.me/' + tu, to: 'ble.ir/' + bu, word: true },
      { from: 'telegram.me/' + tu, to: 'ble.ir/' + bu, word: true },
    ];
  }
  return [
    { from: '@' + bu, to: '@' + tu, word: true },
    { from: 'ble.ir/' + bu, to: 't.me/' + tu, word: true },
  ];
}

// Returns null when the post must not be synced (filtered out).
export function prepare(link, dir, content, { manual = false } = {}) {
  const s = S(link);
  const plain = (content.text || '').toLowerCase();
  if (!manual) {
    if (!s.types[content.typeKey]) return null;
    if (s.nosync && plain.includes('#nosync')) return null;
    if (s.block.some((w) => w && plain.includes(String(w).toLowerCase()))) return null;
  }
  let rich = { text: content.text || '', entities: s.fmt ? content.entities || [] : [] };

  const rules = s.autoUser ? autoRules(link, dir) : [];
  for (const r of s.rules) if (r.d === 'both' || r.d === dir) rules.push({ from: r.f, to: r.t });
  rich = replaceRules(rich, rules);
  if (s.stripLinks) rich = stripLinks(rich);
  if (s.stripMentions) rich = stripMentions(rich);
  rich = tidy(rich);
  // Header/footer only on posts that carry text or media captions.
  if (content.kind !== 'sticker' && content.kind !== 'contact') {
    rich = prependPlain(rich, s['header_' + dir]);
    rich = appendPlain(rich, s['footer_' + dir]);
  }
  return { ...content, text: rich.text, entities: rich.entities };
}
