const REFRESH_MS = 30 * 1000;

const countText = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0
  ? Number(value).toLocaleString()
  : '—';

function clockTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Unknown' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function relativeTime(value) {
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return 'Last seen time unavailable';
  const elapsed = Math.max(0, Date.now() - stamp);
  if (elapsed < 60_000) return 'Last seen just now';
  if (elapsed < 3_600_000) return `Last seen ${Math.floor(elapsed / 60_000)} minute${Math.floor(elapsed / 60_000) === 1 ? '' : 's'} ago`;
  if (elapsed < 86_400_000) return `Last seen ${Math.floor(elapsed / 3_600_000)} hour${Math.floor(elapsed / 3_600_000) === 1 ? '' : 's'} ago`;
  return `Last seen ${new Date(stamp).toLocaleString()}`;
}

export function createAdminMonitor({ $, callApi, go, announce = () => {} }) {
  const view = $('#view-admin-monitor');
  const refreshButton = $('#admin-monitor-refresh');
  const status = $('#admin-monitor-status');
  const updated = $('#admin-monitor-updated');
  const listStatus = $('#admin-monitor-list-status');
  const activeList = $('#admin-active-list');
  let timer = null;
  let loading = false;
  let lastError = '';

  function render(snapshot, { quiet = false } = {}) {
    $('#monitor-registered').textContent = countText(snapshot.registeredAccounts);
    $('#monitor-online').textContent = countText(snapshot.onlineNow);
    $('#monitor-active-day').textContent = countText(snapshot.seenLast24Hours);
    $('#monitor-new-week').textContent = countText(snapshot.createdLast7Days);

    const players = Array.isArray(snapshot.onlinePlayers) ? snapshot.onlinePlayers : [];
    activeList.replaceChildren();
    if (!players.length) {
      const empty = document.createElement('li');
      empty.className = 'monitor-empty';
      empty.textContent = 'No accounts are currently online.';
      activeList.append(empty);
    } else {
      for (const player of players) {
        const item = document.createElement('li');
        item.className = 'monitor-player';
        const details = document.createElement('div');
        details.className = 'monitor-player-details';
        const name = document.createElement('strong');
        name.textContent = typeof player.name === 'string' && player.name ? player.name : 'Player';
        const activity = document.createElement('p');
        activity.className = 'monitor-player-activity';
        activity.textContent = typeof player.activity === 'string' ? player.activity : 'Online in Blind Quiz';
        const seen = document.createElement('small');
        seen.textContent = relativeTime(player.lastSeenAt);
        details.append(name, activity, seen);
        item.append(details);
        activeList.append(item);
      }
    }
    const returned = players.length;
    const total = Number(snapshot.onlineNow) || 0;
    listStatus.textContent = total > returned
      ? `Showing ${returned} most recently active of ${countText(total)} accounts online.`
      : `${countText(total)} account${total === 1 ? '' : 's'} online now.`;
    const updatedAt = snapshot.generatedAt ? clockTime(snapshot.generatedAt) : clockTime(new Date());
    if (updated) updated.textContent = `Last refreshed at ${updatedAt}. Auto-refreshes every 30 seconds while this page is open.`;
    if (!quiet) status.textContent = 'Snapshot refreshed.';
    else if (lastError) status.textContent = 'Automatic refresh has resumed.';
    lastError = '';
  }

  async function refresh({ quiet = false } = {}) {
    if (loading || !view || view.hidden) return;
    loading = true;
    if (refreshButton) refreshButton.disabled = true;
    if (!quiet) status.textContent = 'Loading account and activity information…';
    try {
      const snapshot = await callApi('admin-monitor');
      render(snapshot, { quiet });
    } catch (error) {
      const message = error?.message === 'forbidden'
        ? 'This monitor is available only to the game admin.'
        : error?.message === 'session_expired'
          ? 'Your sign-in has ended. Please sign in again.'
          : 'The monitor could not be refreshed. Please try again.';
      if (status.textContent !== message) status.textContent = message;
      if (listStatus.textContent !== 'Activity information is unavailable.') listStatus.textContent = 'Activity information is unavailable.';
      lastError = message;
      if (!quiet) announce(message, true);
    } finally {
      loading = false;
      if (refreshButton) refreshButton.disabled = false;
    }
  }

  function onViewChange(nextView) {
    if (timer !== null) clearInterval(timer);
    timer = null;
    if (nextView !== 'admin-monitor') return;
    refresh();
    timer = setInterval(() => {
      if (!document.hidden) refresh({ quiet: true });
    }, REFRESH_MS);
  }

  refreshButton?.addEventListener('click', () => refresh());
  $('#open-player-monitor')?.addEventListener('click', () => go('admin-monitor', { focus: '#admin-monitor-title' }));

  return { onViewChange, refresh };
}
