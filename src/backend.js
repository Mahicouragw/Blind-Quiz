import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
const SESSION_KEY = 'blindquiz.session.v1';
const REQUEST_TIMEOUT_MS = 15_000;
let memorySession = null;

// The opaque session token is kept in sessionStorage (tab/app session), with an in-memory
// fallback for browsers or WebViews that block storage. Expired sessions are discarded.
export function getSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.expiresAt && Date.parse(parsed.expiresAt) <= Date.now()) {
          sessionStorage.removeItem(SESSION_KEY);
          memorySession = null;
          return null;
        }
        memorySession = parsed;
        return parsed;
      }
      sessionStorage.removeItem(SESSION_KEY);
    }
  } catch {
    // Fall back to the page-lifetime session when storage is blocked or malformed.
  }
  if (memorySession?.expiresAt && Date.parse(memorySession.expiresAt) <= Date.now()) {
    memorySession = null;
  }
  return memorySession;
}

export function setSession(value) {
  memorySession = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  try {
    if (memorySession) sessionStorage.setItem(SESSION_KEY, JSON.stringify(memorySession));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Authentication still works until this page is closed.
  }
}

export async function callApi(action, payload = {}) {
  const session = getSession();
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    let response;
    try {
      response = await fetch(API, {
        method: 'POST',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_PUBLISHABLE_KEY,
          ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
        },
        // Put action last so a caller-supplied payload cannot replace the API action.
        body: JSON.stringify({ ...payload, action }),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      throw new Error(error?.name === 'AbortError' ? 'timeout' : 'network');
    }

    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const data = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    // A rejected authenticated token is discarded so the player is asked to sign in again.
    if (response.status === 401 && session?.token
      && !['login', 'signup', 'recover-id', 'secret-question', 'check-name'].includes(action)) {
      setSession(null);
    }
    if (!response.ok || data.ok === false) throw new Error(data.code || 'request_failed');
    return data;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
