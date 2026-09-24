// lib/config — static configuration. Secrets live in lib/secrets (generated
// from .env by scripts/gen-secrets.mjs, never committed).
import { BALE_TOKEN } from 'lib/secrets';

export const ADMINS = { tg: [463152143], bale: [606376358] };
export const BOT_ID = { tg: 8924596352, bale: 205022121 };
export const BOT_USERNAME = { tg: 'CopyToBaleBot', bale: 'CopyToBaleBot' };

export const PNAME = { tg: 'تلگرام', bale: 'بله' };
export const PICON = { tg: '✈️', bale: '🟢' };
export const OTHER = { tg: 'bale', bale: 'tg' };

export const BALE_API = 'https://tapi.bale.ai/bot' + BALE_TOKEN + '/';
export const BALE_FILE = 'https://tapi.bale.ai/file/bot' + BALE_TOKEN + '/';

export const channelUrl = (p, username) =>
  p === 'tg' ? `https://t.me/${username}` : `https://ble.ir/${username}`;

// Questions of the self-trigger polls (see lib/pump). Only polls sent by this
// bot produce `poll` updates, so these can't be spoofed.
export const TICK_Q = { pump: '⏱ ctb-pump', job: '⚙️ ctb-job' };

export const LIMITS = {
  text: { tg: 4096, bale: 3900 },
  caption: { tg: 1024, bale: 1000 },
  download: 20 * 1024 * 1024, // getFile cap on both platforms
  photo: 10 * 1024 * 1024,
};

// Invocations are killed at ~30s, so every loop keeps a margin.
export const PUMP = { budgetMs: 20000, lockMs: 32000, pollTimeout: 5, staleMs: 45000 };
export const WORKER = { budgetMs: 16000, leaseSec: 30, slots: 3, maxTries: 3 };

export const CODE_RE = /^CTB-[A-Z0-9]{6}$/;
export const CODE_TTL = 3600;

export const isAdmin = (p, uid) => ADMINS[p].includes(Number(uid));
