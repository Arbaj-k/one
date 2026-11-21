/* Private account profile for One. Profile fields live in the signed-in user's Supabase auth metadata. */
(() => {
  'use strict';
  const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const currentUser = () => window.OneAuth?.getUser?.() || null;
  const initials = value => String(value || 'O').trim().split(/\s+/).slice(0,2).map(x=>x[0]||'').join('').toUpperCase() || 'O';
  function page() {
    const user = currentUser();
    if (!user) return '<section class="card one-profile-locked"><div class="eyebrow">PRIVATE ACCOUNT</div><h1>Sign in to view your profile</h1><p class="muted">Your profile is private and only available inside your signed-in One account.</p><button class="btn primary" type="button" id="one-profile-signin">Sign in</button></section>';
    const meta = user.user_metadata || {};
    const name = meta.full_name || meta.name || user.email?.split('@')[0] || '';
    return `
      <section class="one-profile-page">
        <header class="one-profile-page-head"><div><div class="eyebrow">YOUR ACCOUNT</div><h1>My profile</h1><p class="subtitle">Manage the personal details and preferences connected to your private One account.</p></div><span class="one-private-pill"><span>●</span> Private</span></header>
        <section class="one-profile-hero card">
          <div class="one-profile-large-avatar" aria-hidden="true">${escapeHTML(initials(name))}</div>
          <div class="one-profile-hero-copy"><h2>${escapeHTML(name || 'One user')}</h2><p>${escapeHTML(user.email || '')}</p><small>Only you can access this profile.</small></div>
        </section>
        <form id="one-profile-form" class="card one-profile-form">
          <div class="one-profile-section-title"><div><h2>Personal information</h2><p class="muted">These details stay with your signed-in account.</p></div></div>
          <label class="one-profile-field"><span>Display name</span><input name="display_name" maxlength="80" autocomplete="name" value="${escapeHTML(name)}" placeholder="Your name" required></label>
          <label class="one-profile-field"><span>Email address</span><input type="email" value="${escapeHTML(user.email || '')}" readonly aria-readonly="true"><small>Email is managed by your sign-in provider.</small></label>
          <label class="one-profile-field"><span>Phone number <em>Optional</em></span><input name="phone" type="tel" maxlength="30" autocomplete="tel" value="${escapeHTML(meta.phone || '')}" placeholder="Add a phone number"></label>
          <label class="one-profile-field"><span>About me <em>Optional</em></span><textarea name="about" rows="3" maxlength="240" placeholder="A little about you…">${escapeHTML(meta.about || '')}</textarea></label>
          <label class="one-profile-field"><span>Preferred language</span><select name="preferred_language"><option value="hi-IN" ${(meta.preferred_language || 'hi-IN') === 'hi-IN' ? 'selected' : ''}>Hindi / Hinglish</option><option value="en-IN" ${meta.preferred_language === 'en-IN' ? 'selected' : ''}>English (India)</option></select></label>
          <div class="one-profile-save-row"><span id="one-profile-status" role="status" aria-live="polite"></span><button class="btn primary" type="submit">Save changes</button></div>
        </form>
        <section class="card one-profile-privacy"><div class="one-profile-section-title"><div><h2>Privacy & account</h2><p class="muted">Your profile is not a public page and cannot be browsed by other One users.</p></div><span class="one-private-pill">Private by default</span></div>
          <div class="one-profile-privacy-row"><span class="one-profile-privacy-icon">⌑</span><div><b>Account-specific data</b><small>Tasks, notes, projects, files and money records remain in your account workspace.</small></div></div>
          <div class="one-profile-privacy-row"><span class="one-profile-privacy-icon">♧</span><div><b>Sign-in & security</b><small>Your password and recovery options are managed securely by your sign-in provider.</small></div></div>
          <button type="button" class="btn" data-page="settings">Open account settings</button>
        </section>
      </section>`;
  }
  document.addEventListener('click', event => {
    if (event.target.closest('#one-profile-signin')) window.OneAuth?.open?.('login');
  });
  document.addEventListener('submit', async event => {
    const form = event.target;
    if (form.id !== 'one-profile-form') return;
    event.preventDefault();
    const user = currentUser();
    if (!user) { window.OneAuth?.open?.('login'); return; }
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector('#one-profile-status');
    const values = new FormData(form);
    const displayName = String(values.get('display_name') || '').trim();
    if (!displayName) { status.textContent = 'Please enter your display name.'; return; }
    button.disabled = true; button.textContent = 'Saving…'; status.textContent = '';
    try {
      const client = window.getOneSupabaseClient?.();
      if (!client) throw new Error('Account service is unavailable. Refresh and try again.');
      const { error } = await client.auth.updateUser({ data: {
        full_name: displayName,
        phone: String(values.get('phone') || '').trim(),
        about: String(values.get('about') || '').trim(),
        preferred_language: String(values.get('preferred_language') || 'hi-IN')
      }});
      if (error) throw error;
      status.textContent = 'Profile saved securely.';
      window.dispatchEvent(new CustomEvent('one:profile-updated'));
      setTimeout(() => { if (document.querySelector('#one-profile-form') === form) window.dispatchEvent(new CustomEvent('one:profile-refresh')); }, 0);
      const heading = document.querySelector('.one-profile-hero-copy h2');
      if (heading) heading.textContent = displayName;
      const avatar = document.querySelector('.one-profile-large-avatar');
      if (avatar) avatar.textContent = initials(displayName);
    } catch (error) {
      status.textContent = error?.message || 'Could not save your profile. Please try again.';
    } finally {
      button.disabled = false; button.textContent = 'Save changes';
    }
  });
  window.addEventListener('one:profile-refresh', () => {
    if (document.querySelector('#one-profile-form')) {
      const scrollY = window.scrollY;
      const content = document.querySelector('#page-content');
      if (content && window.OneProfile) { content.innerHTML = window.OneProfile.page(); window.scrollTo(0, scrollY); }
    }
  });
  window.OneProfile = { page };
})();
