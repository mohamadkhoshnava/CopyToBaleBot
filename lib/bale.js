// lib/bale — Bale Bot API client over the sdk's fetch. Mirrors the sdk `api`
// conventions: resolves to the unwrapped `result`, throws BaleError on failure.
import { fetch, FormData, InputFile } from 'sdk';
import { BALE_API, BALE_FILE, LIMITS } from 'lib/config';

export class BaleError extends Error {
  constructor(method, code, description, parameters) {
    super(`Bale ${method}: ${code} ${description}`);
    this.method = method;
    this.code = code;
    this.description = description;
    this.parameters = parameters || {};
  }
}

function hasFile(v) {
  if (v instanceof InputFile) return true;
  if (Array.isArray(v)) return v.some(hasFile);
  if (v && typeof v === 'object') return Object.values(v).some(hasFile);
  return false;
}

function clean(params) {
  const out = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

export async function bale(method, params = {}) {
  params = clean(params);
  let res;
  if (hasFile(params)) {
    // Multipart. Nested files (sendMediaGroup) are lifted to attach://fN parts.
    const form = new FormData();
    let n = 0;
    const lift = (v) => {
      if (v instanceof InputFile) {
        const name = 'f' + n++;
        form.append(name, v);
        return 'attach://' + name;
      }
      if (Array.isArray(v)) return v.map(lift);
      if (v && typeof v === 'object') {
        const o = {};
        for (const [k, x] of Object.entries(v)) if (x !== undefined && x !== null) o[k] = lift(x);
        return o;
      }
      return v;
    };
    for (const [k, v] of Object.entries(params)) {
      if (v instanceof InputFile) form.append(k, v);
      else if (typeof v === 'object') form.append(k, JSON.stringify(lift(v)));
      else form.append(k, String(v));
    }
    res = await fetch(BALE_API + method, { method: 'POST', body: form });
  } else {
    res = await fetch(BALE_API + method, { method: 'POST', body: fetch.body.json(params) });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw new BaleError(method, res.status, 'invalid response');
  }
  if (!data || !data.ok) {
    throw new BaleError(method, data?.error_code ?? res.status, data?.description ?? 'unknown error', data?.parameters);
  }
  return data.result;
}

export const baleFileUrl = (path) => BALE_FILE + path;

export async function readAll(body, max = LIMITS.download) {
  const chunks = [];
  let len = 0;
  for await (const c of body) {
    chunks.push(c);
    len += c.length;
    if (len > max) throw Object.assign(new Error('file too large'), { tooBig: true });
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export async function baleDownloadPath(path) {
  const res = await fetch(baleFileUrl(path));
  if (!res.ok) throw new BaleError('download', res.status, 'file download failed');
  return readAll(res.body);
}

export async function baleDownload(fileId) {
  const f = await bale('getFile', { file_id: fileId });
  return baleDownloadPath(f.file_path);
}
