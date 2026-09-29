// Single-owner auth for the CMS portal: one password (from .env), a signed,
// expiring, HttpOnly cookie, and a simple per-IP login rate limit.
import crypto from 'node:crypto';

const COOKIE = 'pcms_session';
const TTL_MS = 1000 * 60 * 60 * 24 * 7;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

export function createAuth({ password, secret, secure = false }) {
  const sign = (v) => crypto.createHmac('sha256', secret).update(v).digest('base64url');
  const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();

  function issue() {
    const v = `${Date.now() + TTL_MS}.${crypto.randomBytes(9).toString('base64url')}`;
    return `${v}.${sign(v)}`;
  }

  function verify(token) {
    if (!token) return false;
    const i = token.lastIndexOf('.');
    if (i < 0) return false;
    const value = token.slice(0, i);
    const exp = Number(value.split('.')[0]);
    if (!exp || exp < Date.now()) return false;
    const a = Buffer.from(token.slice(i + 1));
    const b = Buffer.from(sign(value));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  const attempts = new Map();
  function recent(ip) {
    const now = Date.now();
    const list = (attempts.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    attempts.set(ip, list);
    return list;
  }

  const flags = `HttpOnly; Path=/; SameSite=Strict${secure ? '; Secure' : ''}`;

  return {
    isAuthed: (req) => verify(cookies(req)[COOKIE]),
    isLimited: (ip) => recent(ip).length >= MAX_ATTEMPTS,
    recordFailure: (ip) => recent(ip).push(Date.now()),
    checkPassword: (input) => crypto.timingSafeEqual(digest(input), digest(password)),
    login: (res) => res.setHeader('Set-Cookie', `${COOKIE}=${issue()}; ${flags}; Max-Age=${TTL_MS / 1000}`),
    logout: (res) => res.setHeader('Set-Cookie', `${COOKIE}=; ${flags}; Max-Age=0`),
  };
}
