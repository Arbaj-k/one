/* Ask One assistant reply actions: copy or share each answer. */
(() => {
  'use strict';
  const STYLE_ID = 'one-ask-reply-actions-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #page-content #chat-messages .chat-message-row.from-one .bubble.assistant .source{display:block!important;width:100%!important;margin:12px 0 0!important;padding:10px 12px!important;border:1px solid #777!important;border-radius:9px!important;background:#24262b!important;color:#f5f6f8!important;-webkit-text-fill-color:#f5f6f8!important;font:600 12px/1.55 inherit!important;overflow-wrap:anywhere!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-actions{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:9px!important;margin:10px 0 2px!important;padding:0!important;flex-wrap:wrap!important;width:100%!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action{appearance:none!important;-webkit-appearance:none!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:8px!important;min-width:92px!important;min-height:42px!important;padding:9px 14px!important;border:1px solid #777!important;border-radius:10px!important;background:#f7f7f8!important;color:#17191e!important;-webkit-text-fill-color:#17191e!important;font-family:inherit!important;font-size:13px!important;font-weight:750!important;line-height:1.2!important;cursor:pointer!important;opacity:1!important;box-shadow:0 1px 2px rgba(0,0,0,.12)!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action span{display:inline!important;color:#17191e!important;-webkit-text-fill-color:#17191e!important;font-size:13px!important;font-weight:750!important;line-height:1.2!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action svg{display:block!important;width:16px!important;height:16px!important;flex:0 0 16px!important;color:#17191e!important;stroke:#17191e!important;opacity:1!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action:hover{background:#e9ebef!important;border-color:#454b55!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action:focus-visible{outline:2px solid #8298ff!important;outline-offset:3px!important}
      @media(max-width:600px){#page-content #chat-messages .chat-message-row.from-one .bubble.assistant .source{margin-top:10px!important;padding:9px 10px!important}#page-content #chat-messages .chat-message-row.from-one .one-reply-actions{margin-top:9px!important;gap:8px!important}#page-content #chat-messages .chat-message-row.from-one .one-reply-action{min-height:42px!important;min-width:96px!important}}
    `;
    document.head.appendChild(style);
  }
  const icons = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.7 10.7 6.6-4.4m-6.6 7 6.6 4.4"/></svg>'
  };
  function install(root = document) {
    root.querySelectorAll('#chat-messages .chat-message-row.from-one').forEach(row => {
      const bubble = row.querySelector('.bubble.assistant');
      if (!bubble || bubble.querySelector('.one-reply-actions')) return;
      const actions = document.createElement('div');
      actions.className = 'one-reply-actions';
      actions.innerHTML = '<button type="button" class="one-reply-action" data-one-reply-action="copy" aria-label="Copy this answer" title="Copy answer">' + icons.copy + '<span>Copy</span></button>' +
        '<button type="button" class="one-reply-action" data-one-reply-action="share" aria-label="Share this answer" title="Share answer">' + icons.share + '<span>Share</span></button>';
      bubble.appendChild(actions);
    });
  }
  async function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const area = document.createElement('textarea');
    area.value = text; area.setAttribute('readonly', '');
    area.style.position = 'fixed'; area.style.opacity = '0';
    document.body.appendChild(area); area.select();
    const ok = document.execCommand('copy'); area.remove();
    if (!ok) throw new Error('Copy is not available in this browser.');
  }
  function toast(message) {
    const node = document.getElementById('toast');
    if (node) { node.textContent = message; node.classList.add('show'); setTimeout(() => node.classList.remove('show'), 1800); }
  }
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-one-reply-action]');
    if (!button) return;
    const row = button.closest('.chat-message-row.from-one');
    const content = row?.querySelector('.bubble-content');
    if (!content) return;
    const text = content.innerText.trim();
    if (!text) return;
    const action = button.dataset.oneReplyAction;
    try {
      if (action === 'copy') {
        await copyText(text); toast('Answer copied');
      } else if (action === 'share') {
        if (navigator.share) await navigator.share({ title: 'One · Ask One answer', text });
        else { await copyText(text); toast('Sharing is not supported here — answer copied'); }
      }
    } catch (error) {
      if (error?.name !== 'AbortError') toast(action === 'copy' ? 'Could not copy answer' : 'Could not share answer');
    }
  });
  const observer = new MutationObserver(() => install());
  observer.observe(document.getElementById('page-content') || document.body, { childList: true, subtree: true });
  install();
})();