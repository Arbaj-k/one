/* Ask One assistant reply actions: copy or share each answer. */
(() => {
  'use strict';
  const STYLE_ID = 'one-ask-reply-actions-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #page-content #chat-messages .chat-message-row.from-one .bubble.assistant .source{display:block!important;width:100%!important;margin:12px 0 0!important;padding:10px 12px!important;border:1px solid #777!important;border-radius:9px!important;background:#24262b!important;color:#f5f6f8!important;-webkit-text-fill-color:#f5f6f8!important;font:600 12px/1.55 inherit!important;overflow-wrap:anywhere!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-actions{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:7px!important;margin:8px 0 2px!important;padding:0!important;flex-wrap:wrap!important;width:100%!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action{appearance:none!important;-webkit-appearance:none!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:6px!important;min-width:78px!important;min-height:34px!important;padding:6px 10px!important;border:1px solid #777!important;border-radius:10px!important;background:#f7f7f8!important;color:#17191e!important;-webkit-text-fill-color:#17191e!important;font-family:inherit!important;font-size:12px!important;font-weight:700!important;line-height:1.2!important;cursor:pointer!important;opacity:1!important;box-shadow:0 1px 2px rgba(0,0,0,.12)!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action span{display:inline!important;color:#17191e!important;-webkit-text-fill-color:#17191e!important;font-size:12px!important;font-weight:700!important;line-height:1.2!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action.icon-only{width:36px!important;height:36px!important;min-width:36px!important;min-height:36px!important;padding:0!important;background:#292d35!important;border:1px solid #697180!important;color:#fff!important;-webkit-text-fill-color:#fff!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-glyph{position:relative!important;display:block!important;width:19px!important;height:19px!important;min-width:19px!important;min-height:19px!important;flex:0 0 19px!important;color:#fff!important;background-color:transparent!important}
      #page-content #chat-messages .chat-message-row.from-one .copy-glyph:before,#page-content #chat-messages .chat-message-row.from-one .copy-glyph:after{content:''!important;position:absolute!important;width:11px!important;height:12px!important;border:1.8px solid #fff!important;border-radius:2px!important;background:#292d35!important;box-sizing:border-box!important}
      #page-content #chat-messages .chat-message-row.from-one .copy-glyph:before{left:6px!important;top:2px!important}
      #page-content #chat-messages .chat-message-row.from-one .copy-glyph:after{left:2px!important;top:6px!important}
      #page-content #chat-messages .chat-message-row.from-one .share-glyph{background:radial-gradient(circle at 4px 9px,#fff 0 2.5px,transparent 2.8px),radial-gradient(circle at 15px 3px,#fff 0 2.5px,transparent 2.8px),radial-gradient(circle at 15px 16px,#fff 0 2.5px,transparent 2.8px),linear-gradient(151deg,transparent 44%,#fff 46% 53%,transparent 55%) 5px 3px/10px 7px no-repeat,linear-gradient(29deg,transparent 44%,#fff 46% 53%,transparent 55%) 5px 10px/10px 7px no-repeat!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action:hover{background:#3a414d!important;border-color:#aab3c2!important}
      #page-content #chat-messages .chat-message-row.from-one .one-reply-action:focus-visible{outline:2px solid #8298ff!important;outline-offset:3px!important}
      @media(max-width:600px){#page-content #chat-messages .chat-message-row.from-one .bubble.assistant .source{margin-top:10px!important;padding:9px 10px!important}#page-content #chat-messages .chat-message-row.from-one .one-reply-actions{margin-top:8px!important;gap:7px!important}#page-content #chat-messages .chat-message-row.from-one .one-reply-action{min-height:34px!important;min-width:78px!important;padding:6px 10px!important}}
    `;
    document.head.appendChild(style);
  }
  const icons = {
    copy: '<span class="one-reply-glyph copy-glyph" aria-hidden="true"></span>',
    share: '<span class="one-reply-glyph share-glyph" aria-hidden="true"></span>'
  };
  function install(root = document) {
    root.querySelectorAll('#chat-messages .chat-message-row.from-one').forEach(row => {
      const bubble = row.querySelector('.bubble.assistant');
      if (!bubble || bubble.querySelector('.one-reply-actions')) return;
      const actions = document.createElement('div');
      actions.className = 'one-reply-actions';
      actions.innerHTML = '<button type="button" class="one-reply-action icon-only" data-one-reply-action="copy" aria-label="Copy this answer" title="Copy answer">' + icons.copy + '</button>' +
        '<button type="button" class="one-reply-action icon-only" data-one-reply-action="share" aria-label="Share this answer" title="Share answer">' + icons.share + '</button>';
      // Set important inline styles so global button/span theme rules cannot hide labels.
      actions.style.setProperty('display','flex','important');
      actions.style.setProperty('align-items','center','important');
      actions.style.setProperty('gap','7px','important');
      actions.style.setProperty('flex-wrap','wrap','important');
      actions.style.setProperty('margin','8px 0 2px','important');
      actions.querySelectorAll('button').forEach(button => {
        button.style.setProperty('display','inline-flex','important');
        button.style.setProperty('align-items','center','important');
        button.style.setProperty('justify-content','center','important');
        button.style.setProperty('gap','0','important');
        button.style.setProperty('width','36px','important');
        button.style.setProperty('height','36px','important');
        button.style.setProperty('min-height','36px','important');
        button.style.setProperty('min-width','36px','important');
        button.style.setProperty('padding','0','important');
        button.style.setProperty('border','1px solid #8b8f98','important');
        button.style.setProperty('border-radius','8px','important');
        button.style.setProperty('background-color','#292d35','important');
        button.style.setProperty('color','#ffffff','important');
        button.style.setProperty('-webkit-text-fill-color','#ffffff','important');
        button.style.setProperty('font-family','Arial,sans-serif','important');
        button.style.setProperty('font-size','0','important');
        button.style.setProperty('font-weight','700','important');
        button.style.setProperty('line-height','1.2','important');
        button.style.setProperty('opacity','1','important');
        button.style.setProperty('visibility','visible','important');
        button.style.setProperty('box-shadow','0 1px 2px rgba(0,0,0,.12)','important');
        const glyph = button.querySelector('.one-reply-glyph');
        if (glyph) {
          glyph.style.setProperty('display','block','important');
          glyph.style.setProperty('visibility','visible','important');
          glyph.style.setProperty('opacity','1','important');
          glyph.style.setProperty('width','19px','important');
          glyph.style.setProperty('height','19px','important');
          glyph.style.setProperty('min-width','19px','important');
          glyph.style.setProperty('min-height','19px','important');
          glyph.style.setProperty('flex','0 0 19px','important');
          glyph.style.setProperty('background-color','transparent','important');
        }
        const svg = button.querySelector('svg');
        if (svg) {
          svg.setAttribute('width','18');
          svg.setAttribute('height','18');
          svg.setAttribute('viewBox','0 0 24 24');
          svg.setAttribute('fill','none');
          svg.setAttribute('stroke','#17191e');
          svg.setAttribute('stroke-width','2');
          svg.setAttribute('stroke-linecap','round');
          svg.setAttribute('stroke-linejoin','round');
          svg.style.setProperty('display','block','important');
          svg.style.setProperty('visibility','visible','important');
          svg.style.setProperty('opacity','1','important');
          svg.style.setProperty('width','18px','important');
          svg.style.setProperty('height','18px','important');
          svg.style.setProperty('min-width','18px','important');
          svg.style.setProperty('min-height','18px','important');
          svg.style.setProperty('flex','0 0 18px','important');
          svg.style.setProperty('overflow','visible','important');
          svg.style.setProperty('stroke','#17191e','important');
          svg.style.setProperty('color','#17191e','important');
        }
      });
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