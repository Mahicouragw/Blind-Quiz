const REASONS = { harassment: 'Harassment or bullying', spam: 'Spam or unwanted promotion', inappropriate: 'Inappropriate behavior or content', cheating: 'Cheating or match manipulation', other: 'Other concern' };
const timeOf = value => { const stamp = Date.parse(value); return Number.isFinite(stamp) ? new Date(stamp).toLocaleString() : 'Time unavailable'; };

export function createModeration({ $, callApi, go, announce = () => {} }) {
  const view = $('#view-admin-reports'), list = $('#admin-report-list'), status = $('#admin-report-status');
  const filter = $('#admin-report-filter'), refresh = $('#admin-report-refresh');
  let loading = false;

  function errorText(code) {
    if (code === 'forbidden') return 'This report inbox is available only to the game admin.';
    if (code === 'session_expired') return 'Your sign-in has ended. Please sign in again.';
    if (code === 'rate_limited') return 'Too many requests. Wait a moment and refresh.';
    if (code === 'report_unavailable') return 'That report is no longer available. Refresh the inbox.';
    if (code === 'account_restricted') return 'This account is restricted after admin review.';
    if (code === 'network' || code === 'timeout') return 'No connection. The review action was not confirmed; refresh before trying again.';
    return 'The report inbox could not be loaded. Please try again.';
  }
  const el = (tag, cls, text) => { const item = document.createElement(tag); if (cls) item.className = cls; if (text != null) item.textContent = String(text); return item; };
  const button = (label, onClick, cls = 'button button-outline') => { const item = el('button', cls, label); item.type = 'button'; item.addEventListener('click', onClick); return item; };

  function renderReport(report) {
    const item = el('li', 'admin-report-item');
    const reason = REASONS[report.reason] || report.reason || 'Unspecified concern';
    item.append(el('h2', '', `${report.target || 'Player'} · ${reason}`));
    item.append(el('p', 'inbox-meta', `Reported by ${report.reporter || 'a player'} · ${timeOf(report.createdAt)} · Status: ${report.status}${report.restricted ? ' · Account restricted' : ''}`));
    if (report.details) item.append(el('p', 'admin-report-details', report.details));
    if (report.reviewNote) item.append(el('p', 'muted', `Last admin note: ${report.reviewNote}`));
    if (report.restricted && report.restrictedAt) item.append(el('p', 'muted', `Restricted at ${timeOf(report.restrictedAt)}.`));

    const note = document.createElement('textarea'); note.className = 'admin-report-note'; note.maxLength = 500; note.rows = 2; note.autocomplete = 'off';
    note.setAttribute('aria-label', `Optional private admin note for report ${report.id}`); note.placeholder = 'Optional private admin note (up to 500 characters)';
    const actions = el('div', 'admin-report-actions');
    const result = el('p', 'admin-report-status'); result.setAttribute('role', 'status'); result.setAttribute('aria-live', 'polite');
    const runAction = async (action, control) => {
      if (action === 'restrict' && !globalThis.confirm?.(`Restrict ${report.target || 'this account'} after reviewing the report? This is an explicit admin decision and prevents the account from signing in or using the service until restored.`)) return;
      if (action === 'restore' && !globalThis.confirm?.(`Restore access for ${report.target || 'this account'}?`)) return;
      actions.querySelectorAll('button').forEach(button => { button.disabled = true; });
      note.disabled = true; result.textContent = 'Saving the admin review decision…';
      try {
        const response = await callApi('admin-player-report-action', { id: report.id, decision: action, note: note.value.trim() });
        result.textContent = action === 'restrict' ? 'Account restricted after your review. No automatic action was taken.'
          : action === 'restore' ? (response.restricted ? 'This report was reviewed. The account remains restricted because of another active admin restriction.' : 'Account access restored after your review.')
            : action === 'dismiss' ? 'Report dismissed. No account restriction was applied by this action.' : 'Report marked as reviewed. No account restriction was applied by this action.';
        announce(result.textContent);
        await loadReports({ quiet: true });
      } catch (error) {
        result.textContent = errorText(error?.message); announce(result.textContent, true);
        actions.querySelectorAll('button').forEach(button => { button.disabled = false; }); note.disabled = false;
        if (error?.message === 'session_expired') status.textContent = errorText(error.message);
      }
    };
    if (report.status === 'open') actions.append(button('Mark reviewed', event => runAction('review', event.currentTarget)));
    if (report.status !== 'dismissed') actions.append(button('Dismiss report', event => runAction('dismiss', event.currentTarget), 'button button-quiet'));
    if (!report.restricted) actions.append(button('Restrict account', event => runAction('restrict', event.currentTarget), 'button button-danger'));
    else actions.append(button('Restore account access', event => runAction('restore', event.currentTarget), 'button button-outline'));
    item.append(note, actions, result);
    return item;
  }

  async function loadReports({ quiet = false } = {}) {
    if (loading || !view || view.hidden) return;
    loading = true; refresh.disabled = true;
    if (!quiet) status.textContent = 'Loading the private admin report queue…';
    try {
      const data = await callApi('admin-player-reports', { status: filter.value || 'open' });
      const reports = Array.isArray(data.items) ? data.items : [];
      list.replaceChildren(...reports.map(renderReport));
      if (!reports.length) list.append(el('li', 'muted', 'No reports match this filter.'));
      status.textContent = `${reports.length} report${reports.length === 1 ? '' : 's'} shown. Reports do not automatically restrict accounts.`;
    } catch (error) {
      list.replaceChildren(); status.textContent = errorText(error?.message); if (!quiet) announce(status.textContent, true);
    } finally { loading = false; refresh.disabled = false; }
  }

  $('#open-player-reports')?.addEventListener('click', () => go('admin-reports', { focus: '#admin-reports-title' }));
  filter?.addEventListener('change', () => loadReports());
  refresh?.addEventListener('click', () => loadReports());
  function onViewChange(nextView) { if (nextView === 'admin-reports') loadReports(); }
  return { onViewChange, refresh: loadReports };
}
