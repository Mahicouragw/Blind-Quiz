// Account self-erasure and the separate admin-only account directory.
// Every deletion is reauthenticated on the server; this module never retains secret answers.
const PAGE_SIZE = 50;
const normalizeName = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');

function deletionError(code, admin = false) {
  if (code === 'wrong_answer') return 'The secret answer is incorrect. Nothing was deleted.';
  if (code === 'confirmation_required') return 'The typed account name did not match. Nothing was deleted.';
  if (code === 'last_admin') return 'The last admin account cannot be deleted. Keep at least one admin account.';
  if (code === 'account_unavailable') return 'That account is no longer available. Refresh and try again.';
  if (code === 'rate_limited') return 'Too many attempts. Please wait before trying again.';
  if (code === 'session_expired') return 'Your sign-in has ended. Please sign in again.';
  if (code === 'forbidden') return 'The account directory is available only to the game admin.';
  if (code === 'network' || code === 'timeout') return 'No connection. Nothing was deleted; please try again.';
  if (code === 'invalid_request') return 'Check the account name and secret answer, then try again.';
  return admin ? 'The account could not be deleted. Please try again.' : 'Your account could not be deleted. Please try again.';
}

function registeredDate(value) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? `Registered ${new Date(stamp).toLocaleDateString()}.` : 'Registration date unavailable.';
}

export function createAccountManagement({ $, callApi, getSession, go, announce = () => {}, onDeleted = async () => {} }) {
  const selfBox = $('#delete-account-box');
  const selfForm = $('#delete-account-form');
  const selfQuestion = $('#delete-account-question');
  const selfStatus = $('#delete-account-status');
  const searchForm = $('#admin-account-search-form');
  const searchInput = $('#admin-account-search');
  const list = $('#admin-account-list');
  const status = $('#admin-account-status');
  const pageStatus = $('#admin-account-page-status');
  const previous = $('#admin-account-previous');
  const next = $('#admin-account-next');
  const refreshButton = $('#admin-account-refresh');
  let page = 0, search = '', total = 0, items = [], openTargetId = null, loading = false;

  function onSessionChange(session = getSession()) {
    const profile = session?.profile;
    if (selfBox) selfBox.hidden = !profile;
    if (!profile) {
      selfForm?.reset();
      if (selfStatus) selfStatus.textContent = '';
      return;
    }
    if (selfQuestion) selfQuestion.textContent = profile.secretQuestion
      ? `Re-enter the answer to your secret question: ${profile.secretQuestion}`
      : 'Re-enter your current secret answer to confirm your identity.';
  }

  function pageCount() { return Math.max(1, Math.ceil(total / PAGE_SIZE)); }

  function render() {
    if (!list) return;
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'monitor-empty';
      empty.textContent = search ? 'No account records match this search.' : 'No account records were returned.';
      list.append(empty);
    }
    for (const account of items) {
      const item = document.createElement('li');
      item.className = 'admin-account-item';
      const details = document.createElement('div');
      details.className = 'admin-account-details';
      const name = document.createElement('strong');
      name.textContent = account.name || 'Unnamed account';
      const date = document.createElement('small');
      date.textContent = registeredDate(account.createdAt);
      details.append(name, date);

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'button button-outline admin-account-delete-toggle';
      toggle.dataset.accountAction = 'toggle';
      toggle.dataset.targetId = account.id;
      toggle.setAttribute('aria-expanded', String(openTargetId === account.id));
      toggle.setAttribute('aria-label', `Delete account ${account.name || 'unnamed account'}`);
      toggle.textContent = openTargetId === account.id ? 'Close delete form' : 'Delete account';
      item.append(details, toggle);

      if (openTargetId === account.id) {
        const form = document.createElement('form');
        form.className = 'admin-account-delete-form';
        form.dataset.accountDeleteForm = 'true';
        form.dataset.targetId = account.id;
        form.noValidate = true;
        const warning = document.createElement('p');
        warning.className = 'muted';
        warning.textContent = `Permanently delete ${account.name || 'this account'} and its active app data. Type the exact display name and re-enter your own secret answer.`;
        const nameLabel = document.createElement('label');
        nameLabel.textContent = `Type ${account.name || 'the display name'} to confirm`;
        const nameInput = document.createElement('input');
        nameInput.name = 'confirmName';
        nameInput.type = 'text';
        nameInput.autocomplete = 'off';
        nameInput.maxLength = 40;
        nameInput.required = true;
        nameInput.spellcheck = false;
        nameLabel.append(nameInput);
        const answerPrompt = document.createElement('p');
        answerPrompt.className = 'muted';
        const question = getSession()?.profile?.secretQuestion;
        answerPrompt.textContent = question ? `Re-enter the answer to your secret question: ${question}` : 'Re-enter your current secret answer to confirm your identity.';
        const answerLabel = document.createElement('label');
        answerLabel.textContent = 'Your current secret answer';
        const answerInput = document.createElement('input');
        answerInput.name = 'currentAnswer';
        answerInput.type = 'password';
        answerInput.autocomplete = 'off';
        answerInput.maxLength = 120;
        answerInput.required = true;
        answerLabel.append(answerInput);
        const formStatus = document.createElement('p');
        formStatus.className = 'muted account-delete-form-status';
        formStatus.setAttribute('role', 'status');
        formStatus.setAttribute('aria-live', 'polite');
        const actions = document.createElement('div');
        actions.className = 'account-delete-actions';
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'button button-danger';
        submit.textContent = 'Permanently delete account';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'button button-quiet';
        cancel.dataset.accountAction = 'cancel';
        cancel.textContent = 'Cancel';
        actions.append(submit, cancel);
        form.append(warning, nameLabel, answerPrompt, answerLabel, actions, formStatus);
        item.append(form);
      }
      list.append(item);
    }
    const pages = pageCount();
    if (pageStatus) pageStatus.textContent = `Page ${page + 1} of ${pages}.`;
    if (previous) previous.disabled = loading || page <= 0;
    if (next) next.disabled = loading || page + 1 >= pages;
    if (refreshButton) refreshButton.disabled = loading;
    if (searchInput) searchInput.disabled = loading;
    if (status && !loading) {
      if (!total) status.textContent = search ? 'No matching account records.' : 'No account records.';
      else {
        const first = page * PAGE_SIZE + 1;
        const last = Math.min(page * PAGE_SIZE + items.length, total);
        status.textContent = `Showing ${first}–${last} of ${total} ${search ? 'matching ' : ''}account records. These are accounts, not counts of verified or active people.`;
      }
    }
  }

  async function loadPage({ reset = false } = {}) {
    if (loading) return;
    if (reset) {
      page = 0;
      search = searchInput?.value.trim().slice(0, 40) || '';
    }
    loading = true;
    if (status) status.textContent = 'Loading account records…';
    if (refreshButton) refreshButton.disabled = true;
    if (previous) previous.disabled = true;
    if (next) next.disabled = true;
    try {
      const result = await callApi('admin-account-directory', { page, search });
      items = Array.isArray(result.items) ? result.items.filter(x => x && typeof x.id === 'string') : [];
      total = Number.isSafeInteger(Number(result.totalAccounts)) && Number(result.totalAccounts) >= 0 ? Number(result.totalAccounts) : items.length;
      const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
      if (page > lastPage) {
        page = lastPage;
        loading = false;
        return loadPage();
      }
      openTargetId = items.some(x => x.id === openTargetId) ? openTargetId : null;
      loading = false;
      render();
    } catch (error) {
      items = [];
      total = 0;
      loading = false;
      render();
      const message = deletionError(error?.message, true);
      if (status) status.textContent = message;
      if (error?.message === 'session_expired') onSessionChange(null);
    }
  }

  function reportDeleteError(targetStatus, error, admin = false) {
    const message = deletionError(error?.message, admin);
    if (targetStatus) targetStatus.textContent = message;
    announce(message, true);
    if (error?.message === 'session_expired') onSessionChange(null);
  }

  async function submitDelete(form, { self = false } = {}) {
    const session = getSession();
    const profile = session?.profile;
    const name = form.querySelector('[name="confirmName"]')?.value.trim() || '';
    const answer = form.querySelector('[name="currentAnswer"]')?.value || '';
    const targetStatus = self ? selfStatus : form.querySelector('.account-delete-form-status');
    const expectedName = self ? profile?.name || profile?.displayName || '' : items.find(x => x.id === form.dataset.targetId)?.name || '';
    if (!expectedName || normalizeName(name) !== normalizeName(expectedName)) {
      if (targetStatus) targetStatus.textContent = 'Type the exact account name shown above. Nothing was deleted.';
      (form.querySelector('[name="confirmName"]'))?.focus();
      return;
    }
    if (answer.trim().length < 2) {
      if (targetStatus) targetStatus.textContent = 'Enter the current secret answer to reauthenticate.';
      form.querySelector('[name="currentAnswer"]')?.focus();
      return;
    }
    const buttons = [...form.querySelectorAll('button')];
    buttons.forEach(button => { button.disabled = true; });
    if (targetStatus) targetStatus.textContent = 'Verifying and deleting account data…';
    try {
      const result = self
        ? await callApi('delete-account', { confirmName: name, currentAnswer: answer })
        : await callApi('admin-delete-account', { targetId: form.dataset.targetId, confirmName: name, currentAnswer: answer });
      const answerField = form.querySelector('[name="currentAnswer"]');
      if (answerField) answerField.value = '';
      if (result.deletedSelf === true || self) {
        await onDeleted({ profile });
        return;
      }
      const deletedName = expectedName;
      items = items.filter(x => x.id !== form.dataset.targetId);
      total = Math.max(0, total - 1);
      openTargetId = null;
      if (status) status.textContent = `Account ${deletedName} was deleted.`;
      announce(`Account ${deletedName} was deleted. Its active app data was removed.`, true);
      render();
      await loadPage();
      refreshButton?.focus();
    } catch (error) {
      if (targetStatus) targetStatus.textContent = '';
      reportDeleteError(targetStatus, error, !self);
      buttons.forEach(button => { button.disabled = false; });
      const answerField = form.querySelector('[name="currentAnswer"]');
      if (answerField) answerField.value = '';
    }
  }

  selfForm?.addEventListener('submit', event => {
    event.preventDefault();
    submitDelete(selfForm, { self: true });
  });

  searchForm?.addEventListener('submit', event => {
    event.preventDefault();
    openTargetId = null;
    loadPage({ reset: true });
  });
  refreshButton?.addEventListener('click', () => loadPage());
  previous?.addEventListener('click', () => { if (page > 0) { page--; loadPage(); } });
  next?.addEventListener('click', () => { if (page + 1 < pageCount()) { page++; loadPage(); } });
  list?.addEventListener('click', event => {
    const button = event.target.closest('[data-account-action]');
    if (!button) return;
    if (button.dataset.accountAction === 'cancel') {
      openTargetId = null;
      render();
      return;
    }
    const id = button.dataset.targetId;
    openTargetId = openTargetId === id ? null : id;
    render();
    if (openTargetId) list.querySelector('.admin-account-delete-form [name="confirmName"]')?.focus();
  });
  list?.addEventListener('submit', event => {
    const form = event.target.closest('form[data-account-delete-form]');
    if (!form) return;
    event.preventDefault();
    submitDelete(form, { self: false });
  });
  $('#open-account-directory')?.addEventListener('click', () => go('admin-accounts', { focus: '#admin-accounts-title' }));

  function onViewChange(view) {
    if (view === 'admin-accounts') {
      page = 0;
      search = searchInput?.value.trim().slice(0, 40) || '';
      loadPage();
    }
  }

  onSessionChange();
  return { onSessionChange, onViewChange, refresh: loadPage };
}
