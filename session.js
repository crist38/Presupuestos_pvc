const crypto = require('crypto');

const COOKIE_NAME = 'odoo_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours
const MIN_SECRET_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

function getKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return crypto.createHash('sha256').update(secret).digest();
}

function isSessionConfigured() {
  return Boolean(getKey());
}

// The session holds the user's Odoo password, so the cookie is encrypted, not just signed.
function setSession(res, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv, { authTagLength: AUTH_TAG_LENGTH });
  const payload = JSON.stringify({ ...data, exp: Date.now() + MAX_AGE_MS });
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const token = [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.');

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production',
    maxAge: MAX_AGE_MS,
    path: '/',
  });
}

// Returns the session data, or null if the cookie is missing, altered or expired.
function readSession(req) {
  const key = getKey();
  if (!key) return null;

  const match = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  try {
    const [iv, authTag, encrypted] = decodeURIComponent(match[1]).split('.').map((part) => Buffer.from(part, 'base64url'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    const data = JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function clearSession(res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

module.exports = { isSessionConfigured, setSession, readSession, clearSession };
