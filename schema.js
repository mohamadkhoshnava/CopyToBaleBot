import { table, integer, text, index, uniqueIndex, primaryKey } from 'sdk/db';

// Timestamps are unix seconds unless the column name says otherwise.

// Small key/value store: pump offset/locks, forced-join config, tickers, etc.
export const kv = table('kv', {
  k: text('k').primaryKey(),
  v: text('v'),
});

// Everyone who talked to the bot, on either platform.
export const users = table('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull(), // 'tg' | 'bale'
  uid: integer('uid').notNull(),
  firstName: text('first_name'),
  username: text('username'),
  joinedAt: integer('joined_at').notNull(),
  lastSeen: integer('last_seen').notNull(),
  blocked: integer('blocked').default(0), // user blocked the bot
  banned: integer('banned').default(0), // banned by an admin
  fjAt: integer('fj_at').default(0), // last successful forced-join check
}, (t) => ({
  pu: uniqueIndex('uq_users_pu').on(t.platform, t.uid),
  joined: index('idx_users_joined').on(t.joinedAt),
}));

// A Telegram channel <-> Bale channel pair.
export const links = table('links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tgChat: integer('tg_chat').notNull(),
  baleChat: integer('bale_chat').notNull(),
  tgTitle: text('tg_title'),
  tgUser: text('tg_user'),
  baleTitle: text('bale_title'),
  baleUser: text('bale_user'),
  ownerTg: integer('owner_tg'),
  ownerBale: integer('owner_bale'),
  settings: text('settings').default('{}'),
  createdAt: integer('created_at').notNull(),
  t2b: integer('t2b').default(0), // posts synced Telegram -> Bale
  b2t: integer('b2t').default(0), // posts synced Bale -> Telegram
  lastAt: integer('last_at').default(0),
  errCount: integer('err_count').default(0),
  lastErr: text('last_err'),
  errNotifiedAt: integer('err_notified_at').default(0),
}, (t) => ({
  tg: uniqueIndex('uq_links_tg').on(t.tgChat),
  bale: uniqueIndex('uq_links_bale').on(t.baleChat),
}));

// One-time codes that pair a channel on one platform with a channel on the other.
export const codes = table('codes', {
  code: text('code').primaryKey(),
  platform: text('platform').notNull(),
  chatId: integer('chat_id').notNull(),
  title: text('title'),
  username: text('username'),
  ownerUid: integer('owner_uid').notNull(),
  createdAt: integer('created_at').notNull(),
});

// Source message -> copied message, used for edits, deletes, replies and pins.
export const msgmap = table('msgmap', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  linkId: integer('link_id').notNull(),
  sp: text('sp').notNull(),
  sc: integer('sc').notNull(),
  sm: integer('sm').notNull(),
  dp: text('dp').notNull(),
  dc: integer('dc').notNull(),
  dm: integer('dm').notNull(),
  role: text('role').default('main'), // 'main' | 'extra' (overflow text parts)
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  src: index('idx_msgmap_src').on(t.sp, t.sc, t.sm),
  dst: index('idx_msgmap_dst').on(t.dp, t.dc, t.dm),
  link: index('idx_msgmap_link').on(t.linkId),
}));

// Dedupe for redelivered updates.
export const claims = table('claims', {
  k: text('k').primaryKey(),
  at: integer('at').notNull(),
});

// Album items waiting until the whole media group has arrived.
export const albums = table('albums', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platform: text('platform').notNull(),
  chatId: integer('chat_id').notNull(),
  gid: text('gid').notNull(),
  msgId: integer('msg_id').notNull(),
  payload: text('payload').notNull(),
  atMs: integer('at_ms').notNull(),
}, (t) => ({
  grp: index('idx_albums_grp').on(t.platform, t.chatId, t.gid),
  uq: uniqueIndex('uq_albums_msg').on(t.platform, t.chatId, t.msgId),
}));

// Work queue. Jobs sharing `lk` run strictly in id order.
export const jobs = table('jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  lk: text('lk').notNull(),
  payload: text('payload').notNull(),
  status: text('status').default('new'), // new | run | done | fail
  tries: integer('tries').default(0),
  lease: integer('lease').default(0),
  runAt: integer('run_at').default(0),
  createdAt: integer('created_at').notNull(),
  err: text('err'),
}, (t) => ({
  st: index('idx_jobs_status').on(t.status, t.id),
  lk: index('idx_jobs_lk').on(t.lk, t.status),
}));

// Multi-step conversations (waiting for a channel, a rule, a broadcast...).
export const sessions = table('sessions', {
  k: text('k').primaryKey(),
  state: text('state').notNull(),
  data: text('data'),
  at: integer('at').notNull(),
});

// Daily counters (Tehran day).
export const stats = table('stats', {
  day: text('day').notNull(),
  k: text('k').notNull(),
  n: integer('n').default(0),
}, (t) => ({
  pk: primaryKey({ columns: [t.day, t.k] }),
}));

export const errors = table('errors', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  at: integer('at').notNull(),
  src: text('src'),
  msg: text('msg'),
}, (t) => ({
  at: index('idx_errors_at').on(t.at),
}));

export const broadcasts = table('broadcasts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  target: text('target').notNull(), // tg | bale | all
  sp: text('sp').notNull(),
  sc: integer('sc').notNull(),
  sm: integer('sm').notNull(),
  text: text('text'),
  status: text('status').default('draft'), // draft | run | done | cancel
  cursor: integer('cursor').default(0),
  sent: integer('sent').default(0),
  failed: integer('failed').default(0),
  byUid: integer('by_uid'),
  createdAt: integer('created_at').notNull(),
});
