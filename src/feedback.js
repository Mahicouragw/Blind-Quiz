// Settings > Send feedback, and the admin feedback inbox (Migration 017).
// Step 1 asks for the player's name and checks it against the signed-in account (the server checks again).
// Step 2 takes the message; for a problem report the player is asked to add a screenshot, which is shrunk
// to a JPEG data URL in the browser before sending. Feedback goes to the admin inbox, read by Goldfish.

const CONTACT = 'numbersareplaying@gmail.com';
const KIND_LABEL = { feedback: 'Feedback', problem: 'Problem report', idea: 'Idea' };
const MAX_SHOT = 850000; // characters of data URL; the server allows up to 900000
const norm = s => String(s || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

// Turns an image file into a JPEG data URL small enough to send, shrinking the size and quality step by step.
export async function shrinkImage(file, { doc = document, limit = MAX_SHOT } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('not_image');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; });
    let max = 1600, quality = 0.82;
    for (let step = 0; step < 7; step++) {
      const scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas = doc.createElement('canvas');
      canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale));
      canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const out = canvas.toDataURL('image/jpeg', quality);
      if (out.startsWith('data:image/jpeg;base64,') && out.length <= limit) return out;
      max = Math.round(max * 0.75); quality = Math.max(0.5, quality - 0.08);
    }
    throw new Error('too_big');
  } finally { URL.revokeObjectURL(url); }
}

export function createFeedback({ $, announce, callApi, getSession, go, openSignIn }) {
  const box = $('#feedback-box');
  if (!box) return { refresh() {} };
  const nameForm = $('#feedback-name-form'), form = $('#feedback-form'), status = $('#feedback-status');
  const signin = $('#feedback-signin'), shotBox = $('#feedback-shot-box'), shotInput = $('#feedback-shot');
  const shotStatus = $('#feedback-shot-status'), preview = $('#feedback-shot-preview'), send = $('#feedback-send');
  const inboxBox = $('#admin-inbox-box');
  let shot = null, verifiedName = '', adminFor = null, isAdminNow = false;

  const say = (el, text, urgent = false) => { el.textContent = text; if (text) announce(text, urgent); };
  const profile = () => getSession()?.profile || null;
  const kind = () => form.querySelector('input[name="feedback-kind"]:checked')?.value || 'feedback';

  function clearShot() { shot = null; shotInput.value = ''; preview.hidden = true; preview.removeAttribute('src'); shotStatus.textContent = ''; }
  function toNameStep({ keepStatus = false } = {}) {
    verifiedName = ''; form.hidden = true; form.reset(); clearShot(); shotBox.hidden = true;
    nameForm.hidden = false; $('#feedback-name').value = '';
    if (!keepStatus) status.textContent = '';
  }

  async function refreshAdmin() {
    const p = profile();
    if (!p) { isAdminNow = false; inboxBox.hidden = true; return; }
    if (adminFor !== p.loginId) {
      try { const d = await callApi('profile'); isAdminNow = d.profile?.isAdmin === true; adminFor = p.loginId; }
      catch { isAdminNow = p.isAdmin === true; }
    }
    inboxBox.hidden = !isAdminNow;
  }

  function refresh() {
    const signedIn = !!profile();
    signin.hidden = signedIn;
    if (!signedIn) { nameForm.hidden = true; form.hidden = true; inboxBox.hidden = true; adminFor = null; return; }
    if (form.hidden) nameForm.hidden = false;
    refreshAdmin();
  }

  nameForm.addEventListener('submit', e => {
    e.preventDefault();
    const typed = $('#feedback-name').value.trim(), p = profile();
    if (!p) { refresh(); return; }
    if (norm(typed).length < 2) { say(status, 'Please type your name.', true); $('#feedback-name').focus(); return; }
    if (norm(typed) !== norm(p.name)) {
      say(status, 'That name does not match your account. Please type the name you signed in with.', true);
      $('#feedback-name').focus(); return;
    }
    verifiedName = typed; nameForm.hidden = true; form.hidden = false;
    say(status, `Thanks, ${p.name}. Name checked. Now choose what it is about and write your feedback.`);
    setTimeout(() => form.querySelector('input[name="feedback-kind"]:checked')?.focus(), 40);
  });

  form.addEventListener('change', e => {
    if (e.target.name !== 'feedback-kind') return;
    const problem = kind() === 'problem';
    shotBox.hidden = !problem;
    if (problem) announce('Facing a problem? Please add a screenshot so we can see what went wrong.');
    else clearShot();
  });

  shotInput.addEventListener('change', async () => {
    const file = shotInput.files?.[0];
    if (!file) { clearShot(); return; }
    say(shotStatus, 'Preparing the screenshot…');
    try {
      shot = await shrinkImage(file);
      preview.src = shot; preview.alt = 'Your screenshot'; preview.hidden = false;
      say(shotStatus, 'Screenshot added.');
    } catch (err) {
      shot = null; preview.hidden = true; shotInput.value = '';
      say(shotStatus, err.message === 'not_image' ? 'Please choose an image file, such as a screenshot.' : 'That image could not be used. Please try another screenshot.', true);
    }
  });
  $('#feedback-cancel')?.addEventListener('click', () => { toNameStep(); $('#feedback-name').focus(); });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const message = $('#feedback-message').value.trim();
    if (message.length < 5) { say(status, 'Please write a little more, at least 5 characters.', true); $('#feedback-message').focus(); return; }
    send.disabled = true; say(status, 'Sending your feedback…');
    try {
      await callApi('submit-feedback', { name: verifiedName, kind: kind(), message, ...(shot && kind() === 'problem' ? { screenshot: shot } : {}) });
      toNameStep({ keepStatus: true });
      say(status, 'Thank you! Your feedback was sent to the Blind Quiz developer.');
    } catch (err) {
      const code = err.message;
      const text = code === 'name_mismatch' ? 'That name does not match your account. Please type the name you signed in with.'
        : code === 'rate_limited' ? `You have sent a lot of feedback today. Please try again tomorrow, or email ${CONTACT}.`
        : code === 'network' ? 'No internet connection. Please check it and try again.'
        : code === 'invalid_request' ? 'Please check your message and screenshot, then try again.'
        : getSession() ? `Something went wrong. Please try again, or email ${CONTACT}.` : 'Your session has ended. Please sign in again to send feedback.';
      if (code === 'name_mismatch') toNameStep({ keepStatus: true });
      say(status, text, true);
      if (!getSession()) refresh();
    } finally { send.disabled = false; }
  });
  $('#feedback-signin-button')?.addEventListener('click', () => openSignIn());

  // ---- Admin inbox -----------------------------------------------------------------------------
  const list = $('#inbox-list'), summary = $('#inbox-summary');
  const fmt = iso => { try { return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; } };
  function renderItem(f) {
    const li = document.createElement('li'); li.className = `inbox-item${f.read ? '' : ' unread'}`; li.dataset.id = String(f.id);
    const h = document.createElement('h2'); h.textContent = `${KIND_LABEL[f.kind] || 'Feedback'} from ${f.name}`;
    const meta = document.createElement('p'); meta.className = 'inbox-meta';
    meta.textContent = `${fmt(f.createdAt)}${f.read ? '' : ' · New'}${f.hasScreenshot ? ' · Screenshot attached' : ''}`;
    const msg = document.createElement('p'); msg.className = 'inbox-message'; msg.textContent = f.message;
    li.append(h, meta, msg);
    if (f.hasScreenshot || !f.read) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'button button-quiet';
      b.textContent = f.hasScreenshot ? 'Show screenshot' : 'Mark as read';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const d = await callApi('feedback-item', { id: f.id });
          f.read = true; li.classList.remove('unread'); meta.textContent = meta.textContent.replace(' · New', '');
          if (typeof d.screenshot === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d.screenshot)) {
            const img = document.createElement('img'); img.className = 'inbox-shot'; img.src = d.screenshot; img.alt = `Screenshot sent by ${f.name}`;
            b.replaceWith(img); announce('Screenshot shown.');
          } else { b.remove(); announce('Marked as read.'); }
          updateSummary();
        } catch { b.disabled = false; announce('Something went wrong. Please try again.', true); }
      });
      li.append(b);
    }
    li.append(replyBox(f, li, meta));
    return li;
  }
  // Admin reply (Migration 019): the player sees it in Settings > My feedback and gets a notification.
  function replyBox(f, li, meta) {
    const wrap = document.createElement('div'); wrap.className = 'inbox-reply';
    const shown = document.createElement('p'); shown.className = 'feedback-reply';
    const showReply = text => { shown.textContent = `Your reply: ${text}`; shown.hidden = false; };
    if (f.reply) showReply(f.reply); else shown.hidden = true;
    const form = document.createElement('form'); form.noValidate = true;
    const id = `reply-${f.id}`, label = document.createElement('label'); label.htmlFor = id; label.textContent = f.reply ? `Change your reply to ${f.name}` : `Reply to ${f.name}`;
    const area = document.createElement('textarea'); area.id = id; area.rows = 3; area.maxLength = 2000;
    const send = document.createElement('button'); send.type = 'submit'; send.className = 'button button-outline'; send.textContent = 'Send reply';
    form.append(label, area, send);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const text = area.value.trim(); if (!text) { announce('Write a reply first.', true); area.focus(); return; }
      send.disabled = true;
      try {
        await callApi('admin-feedback-reply', { id: f.id, reply: text });
        f.reply = text; f.read = true; li.classList.remove('unread'); meta.textContent = meta.textContent.replace(' · New', '');
        showReply(text); area.value = ''; label.textContent = `Change your reply to ${f.name}`;
        announce(`Reply sent to ${f.name}.`); updateSummary();
      } catch { announce('The reply could not be sent. Please try again.', true); }
      finally { send.disabled = false; }
    });
    wrap.append(shown, form);
    return wrap;
  }
  let items = [];
  function updateSummary() {
    const unread = items.filter(f => !f.read).length;
    summary.textContent = items.length ? `${items.length} message${items.length === 1 ? '' : 's'}, ${unread} new.` : 'No feedback yet.';
    const btn = $('#open-inbox'); if (btn) btn.textContent = unread ? `Open feedback inbox (${unread} new)` : 'Open feedback inbox';
  }
  async function loadInbox() {
    summary.textContent = 'Loading feedback…'; list.innerHTML = '';
    try {
      const d = await callApi('feedback-inbox');
      items = d.items || []; list.append(...items.map(renderItem)); updateSummary(); announce(summary.textContent);
    } catch (err) {
      summary.textContent = err.message === 'forbidden' ? 'Only the game admin can open the feedback inbox.' : 'The inbox could not be loaded. Please try again.';
      announce(summary.textContent, true);
    }
  }
  $('#open-inbox')?.addEventListener('click', () => { go('inbox'); loadInbox(); });
  $('#inbox-refresh')?.addEventListener('click', loadInbox);
  // Admin announcement to every player, for example when a new game is added.
  $('#announce-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const area = $('#announce-text'), out = $('#announce-status'), text = area.value.trim();
    if (text.length < 3) { say(out, 'Write the announcement first.', true); area.focus(); return; }
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { const d = await callApi('admin-announce', { text }); area.value = ''; say(out, `Announcement sent to ${d.sent} players.`); }
    catch (err) { say(out, err.message === 'forbidden' ? 'Only the game admin can send announcements.' : 'The announcement could not be sent. Please try again.', true); }
    finally { btn.disabled = false; }
  });

  return { refresh, loadInbox };
}
