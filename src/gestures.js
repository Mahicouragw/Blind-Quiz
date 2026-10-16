// Swipe left and right to move between the choices on the screen.
//
// Blind players who use touch exploration or a switch device can move through a list with a single
// sideways swipe instead of hunting for the next button. The screen reader reads whatever receives
// the focus, so the swipe only moves the focus - it never writes to a live region, which would
// make a screen reader say the same thing twice.
//
// Rules that keep the gesture from getting in the way:
//  - a swipe must travel sideways further than it travels up or down (a vertical drag scrolls);
//  - a slow drag is a scroll, not a swipe;
//  - a swipe that starts inside a horizontally scrolling area is left to that area;
//  - the gesture can be switched off in Settings.
const MIN_TRAVEL = 55; // px of sideways travel
const MAX_TIME = 900; // ms; slower than this and the player was scrolling
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
  if (el.hidden) return false;
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
    for (const selector of GROUPS) if (node.matches?.(selector)) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * Starts the swipe gesture.
 * `onMove(element)` is called with the control that should receive the focus.
 * `enabled()` is asked before every gesture, so Settings can switch it off.
 */
export function initGestures({ onMove, enabled = () => true } = {}) {
  if (typeof document === 'undefined' || typeof onMove !== 'function') return () => {};
  let start = null;

  const onStart = event => {
    if (!enabled()) { start = null; return; }
    const touch = event.touches && event.touches[0];
    if (!touch) return;
    start = { x: touch.clientX, y: touch.clientY, at: Date.now(), target: event.target };
  };

  const onEnd = event => {
    const from = start;
    start = null;
    if (!from || !enabled()) return;
    const touch = event.changedTouches && event.changedTouches[0];
    if (!touch) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Date.now() - from.at > MAX_TIME) return;
    if (Math.abs(dx) < MIN_TRAVEL) return;
    if (Math.abs(dy) > Math.abs(dx) * SIDE_RATIO) return; // mostly up or down: that is a scroll
    if (scrollsSideways(from.target)) return;

    const active = document.activeElement;
    const group = groupFor(active) || groupFor(from.target);
    if (!group) return;
    const list = items(group);
    if (list.length < 2) return;
    const current = list.indexOf(active);
    const step = dx < 0 ? 1 : -1; // swipe left moves forward, swipe right moves back
    const next = current < 0 ? (step > 0 ? 0 : list.length - 1) : (current + step + list.length) % list.length;
    if (next === current) return;
    onMove(list[next], { direction: step > 0 ? 'forward' : 'back', group });
  };

  const onCancel = () => { start = null; };

  document.addEventListener('touchstart', onStart, { passive: true });
  document.addEventListener('touchend', onEnd, { passive: true });
  document.addEventListener('touchcancel', onCancel, { passive: true });

  return () => {
    document.removeEventListener('touchstart', onStart);
    document.removeEventListener('touchend', onEnd);
    document.removeEventListener('touchcancel', onCancel);
  };
}

export const gestureGroups = GROUPS;
