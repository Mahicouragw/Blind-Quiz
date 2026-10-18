// Swipe to move between the choices on the screen.
//
// Blind players who use touch exploration or a switch device can move through a list with a
// sideways swipe instead of hunting for the next button. The screen reader reads whatever receives
// the focus, so the swipe only moves the focus - it never writes to a live region, which would
// make a screen reader say the same thing twice.
//
// Three ways to move, because a screen reader keeps the ordinary one:
//  - one finger: the usual sideways swipe. Android TalkBack takes single-finger swipes for its
//    own navigation, so this one only reaches the game when the screen reader is off, or when the
//    player is not touching the screen (a mouse, a keyboard, a switch device).
//  - two fingers: a sideways swipe with two fingers. TalkBack does not use that gesture, so it
//    reaches the game even with the screen reader on. The game cancels the browser's pinch zoom
//    while the two fingers are down, so the gesture never turns into a zoom.
//  - the arrow keys, and the Previous / Next buttons on the game screen.
//
// Rules that keep the gesture from getting in the way:
//  - a swipe must travel sideways further than it travels up or down (a vertical drag scrolls);
//  - a slow drag is a scroll, not a swipe;
//  - a swipe that starts inside a horizontally scrolling area is left to that area;
//  - the gesture can be switched off in Settings.
const MIN_TRAVEL = 36; // px of sideways travel (responsive on phones and Lenovo tablets)
const MAX_TIME = 1200; // ms; slower than this and the player was scrolling
const SIDE_RATIO = 0.9; // sideways travel must beat vertical travel by this factor

// The lists a swipe moves through, in the order they are looked for.
const GROUPS = [
  '#category-list', '#mode-list', '.answer-list', '#sm-grid', '#letters-tiles', '#letters-found',
  '.letters-tools', '.game-tools', '.room-games', '#room-people', '.player-list', '.watch-scores',
  '.watch-log', '.room-chat', '.chat-log', '#sound-choice-rows',
];

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

const isVisible = el => {
  if (!el || !el.isConnected) return false;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    if (n.hidden || n.hasAttribute?.('inert')) return false;
  }
  const style = el.ownerDocument.defaultView?.getComputedStyle?.(el);
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  return true;
};

const items = group => [...group.querySelectorAll(FOCUSABLE)].filter(isVisible);

/** The name of a control, as a screen reader would say it. */
const labelOf = el => (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();

/** True when the element sits inside something that scrolls sideways. */
function scrollsSideways(el) {
  let node = el;
  while (node && node.nodeType === 1) {
    if (node.scrollWidth > node.clientWidth + 4) {
      const style = node.ownerDocument.defaultView?.getComputedStyle?.(node);
      if (!style || (style.overflowX !== 'visible' && style.overflowX !== 'clip')) return true;
    }
    node = node.parentElement;
  }
  return false;
}

function groupFor(el) {
  if (!el) return null;
  let node = el;
  while (node && node.nodeType === 1) {
    for (const selector of GROUPS) if (node.matches?.(selector) && isVisible(node)) return node;
    node = node.parentElement;
  }
  return null;
}

// The last control the player touched that belongs to a list, so the Previous / Next buttons and
// the arrow keys know which list to move through even when the focus is on the button itself.
let lastGrouped = null;

/** The list the focus is in, the last one the player touched, or the active visible list on screen. */
function currentGroup() {
  if (typeof document === 'undefined') return null;
  const active = document.activeElement;
  const direct = groupFor(active) || groupFor(lastGrouped);
  if (direct && items(direct).length >= 2) return direct;
  for (const selector of GROUPS) {
    for (const g of document.querySelectorAll(selector)) {
      if (isVisible(g) && items(g).length >= 2) return g;
    }
  }
  return direct;
}

/**
 * The control before or after `from` in its list.
 * Returns null when there is nothing to move to.
 */
function step(direction, from) {
  const group = groupFor(from) || currentGroup();
  if (!group) return null;
  const list = items(group);
  if (list.length < 2) return null;
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  const current = list.indexOf(active);
  const dir = direction === 'back' ? -1 : 1;
  const next = current < 0 ? (dir > 0 ? 0 : list.length - 1) : (current + dir + list.length) % list.length;
  if (next === current) return null;
  return list[next];
}

/**
 * Moves the focus one step forward or back in the current list.
 * Used by the Previous / Next buttons, the arrow keys and the swipe gesture.
 * Returns the control that received the focus, or null when nothing moved.
 */
export function moveFocus(direction) {
  if (typeof document === 'undefined') return null;
  const el = step(direction, document.activeElement);
  if (!el) return null;
  el.focus();
  try { el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); } catch { /* ignore */ }
  return el;
}

/** The name of the control that has the focus, as a screen reader would say it. */
export function focusedLabel() {
  if (typeof document === 'undefined') return '';
  return labelOf(document.activeElement);
}

/**
 * Starts the swipe gesture.
 * `onMove(element)` is called with the control that should receive the focus.
 * `enabled()` is asked before every gesture, so Settings can switch it off.
 */
export function initGestures({ onMove, enabled = () => true } = {}) {
  if (typeof document === 'undefined' || typeof onMove !== 'function') return () => {};
  // The touches of the gesture in progress, each with the point where it started.
  const touches = new Map();
  let multi = false; // true when the gesture used more than one finger
  let target = null;

  const onStart = event => {
    if (!enabled()) { touches.clear(); multi = false; return; }
    // A browser reports the new touches in changedTouches; older WebViews only fill in touches.
    const changed = event.changedTouches && event.changedTouches.length ? event.changedTouches : (event.touches || []);
    for (const t of changed) {
      touches.set(t.identifier, { x: t.clientX, y: t.clientY, at: Date.now(), target: event.target });
    }
    if ((event.touches || []).length > 1) multi = true;
    if (event.target) {
      target = event.target;
      if (groupFor(event.target)) lastGrouped = event.target;
    }
  };

  // Two fingers: the screen reader does not use a two-finger sideways swipe, so it reaches the
  // game even with the screen reader on. Cancelling the default keeps the browser from turning
  // the gesture into a pinch zoom.
  const onMoveEvent = event => {
    if (!enabled() || !multi || touches.size < 2) return;
    let dx = 0, dy = 0, n = 0;
    for (const t of event.touches || []) {
      const from = touches.get(t.identifier);
      if (!from) continue;
      dx += t.clientX - from.x;
      dy += t.clientY - from.y;
      n++;
    }
    if (!n) return;
    dx /= n;
    dy /= n;
    if (Math.abs(dx) < MIN_TRAVEL) return;
    if (Math.abs(dy) > Math.abs(dx) * SIDE_RATIO) return;
    if (event.cancelable) event.preventDefault();
  };

  const onEnd = event => {
    let best = null;
    for (const t of event.changedTouches || []) {
      const from = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (!from || !enabled()) continue;
      const dx = t.clientX - from.x;
      const dy = t.clientY - from.y;
      if (Date.now() - from.at > MAX_TIME) continue;
      if (Math.abs(dx) < MIN_TRAVEL) continue;
      if (Math.abs(dy) > Math.abs(dx) * SIDE_RATIO) continue; // mostly up or down: that is a scroll
      if (scrollsSideways(from.target)) continue;
      if (!best || Math.abs(dx) > Math.abs(best.dx)) best = { dx, dy, from };
    }
    // A two-finger swipe counts once, not once per finger.
    if (touches.size > 0) return;
    multi = false;
    if (!best) return;
    const direction = best.dx < 0 ? 'forward' : 'back'; // swipe left moves forward, swipe right moves back
    const el = step(direction, best.from.target || target);
    if (!el) return;
    onMove(el, { direction, group: groupFor(el) });
  };

  const onCancel = () => { touches.clear(); multi = false; };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchmove', onMoveEvent, { passive: false });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onCancel, { passive: true });

  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchmove', onMoveEvent);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
  };
}

export const gestureGroups = GROUPS;
