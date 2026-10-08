import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

const API = `${SUPABASE_URL}/functions/v1/blind-quiz-api`;
const SESSION_KEY = 'blindquiz.session.v1';
const REQUEST_TIMEOUT_MS = 15_000;
let memorySession = null;

export function getSession() {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch {
    // Fall back to an in-memory session when storage is blocked or malformed.
  }
  return memorySession;
}

export function setSession(value) {
  memorySession = value || null;
  try {
    if (memorySession) sessionStorage.setItem(SESSION_KEY, JSON.stringify(memorySession));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Authentication can still be used until this page is closed.
  }
}

export async function callApi(action, payload = {}) {
  const session = getSession();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
      },
      body: JSON.stringify({ ...payload, action }),
      signal: controller.signal,
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = null;
    }
    const data = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
    if (!response.ok || data.ok === false) throw new Error(data.code || 'request_failed');
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
