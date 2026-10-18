import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
const SESSION_KEY = 'blindquiz.session.v1';
const PERSISTENT_SESSION_KEY = 'blindquiz.persisted-session.v1';
const REQUEST_TIMEOUT_MS = 15_000;
let memorySession = null;
let persistentSession = false;

function usableSession(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  // A valid session has no fixed expiry. The server revokes it when the player signs out
  // or when account credentials change; the client-side storage choice is still opt-in.
  return typeof value.token === 'string' && value.token.length >= 35 && value.token.length <= 64;
}

function getStorage(name) {
  try { return globalThis[name] || null; } catch { return null; }
}

function readStoredSession(storage, key, persistent) {
  try {
    const stored = storage?.getItem(key);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!usableSession(parsed)) {
      storage.removeItem(key);
      return null;
    }
    memorySession = parsed;
    persistentSession = persistent;
    return parsed;
  } catch {
    // Storage can be disabled or contain malformed data; try the other store / memory fallback.
    return null;
  }
}

// By default, the token stays in this tab/app session. A player can explicitly opt in
// to local storage on this device so the server session can be restored after reopening.
export function getSession() {
  const tabSession = readStoredSession(getStorage('sessionStorage'), SESSION_KEY, false);
  if (tabSession) return tabSession;
  const savedSession = readStoredSession(getStorage('localStorage'), PERSISTENT_SESSION_KEY, true);
  if (savedSession) return savedSession;
  if (memorySession && !usableSession(memorySession)) {
    memorySession = null;
    persistentSession = false;
  }
  return memorySession;
}

export function setSession(value, { remember = persistentSession } = {}) {
  memorySession = value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  if (!memorySession) {
    persistentSession = false;
    try { globalThis.sessionStorage?.removeItem(SESSION_KEY); } catch {}
    try { globalThis.localStorage?.removeItem(PERSISTENT_SESSION_KEY); } catch {}
    return;
  }

  persistentSession = remember === true;
  if (persistentSession) {
    try {
      globalThis.localStorage?.setItem(PERSISTENT_SESSION_KEY, JSON.stringify(memorySession));
      globalThis.sessionStorage?.removeItem(SESSION_KEY);
    } catch {
      // If persistent storage is blocked, keep the player signed in for this tab only.
      persistentSession = false;
      try { globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(memorySession)); } catch {}
    }
    return;
  }

  try { globalThis.sessionStorage?.setItem(SESSION_KEY, JSON.stringify(memorySession)); } catch {
    // Authentication still works until this page is closed if storage is blocked.
  }
  try { globalThis.localStorage?.removeItem(PERSISTENT_SESSION_KEY); } catch {}
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
          ...(session?.token && action !== 'suggest-name' ? { Authorization: `Bearer ${session.token}` } : {}),
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
      && !['login', 'signup', 'recover-id', 'recover-answer', 'secret-question', 'check-name', 'suggest-name'].includes(action)) {
      setSession(null);
    }
    if (!response.ok || data.ok === false) throw new Error(data.code || 'request_failed');
    return data;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
