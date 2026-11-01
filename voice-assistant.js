/* Student Brain browser voice assistant (Web Speech API) */
(() => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null, listening = false, voiceReplies = true;
  const style = document.createElement('style');
  style.textContent = `
    .voice-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:10px 0 4px}
    .voice-btn{border:1px solid #e7ebf1;background:#fff;color:#17243a;border-radius:10px;padding:9px 12px;font:600 12px 'DM Sans',sans-serif;cursor:pointer}
    .voice-btn.mic-on{background:#4263eb;color:#fff;border-color:#4263eb}
    .voice-status{font-size:11px;color:#7a879a}
    .voice-toggle{font-size:11px;color:#4560cc;background:#edf1ff;border:0;border-radius:8px;padding:8px 10px;cursor:pointer}
  `;
  document.head.appendChild(style);

  function speak(text) {
    if (!voiceReplies || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-IN';
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  }

  function addControls() {
    const form = document.querySelector('#chat-form');
    if (!form || form.dataset.voiceReady) return;
    form.dataset.voiceReady = '1';
    const controls = document.createElement('div');
    controls.className = 'voice-controls';
    controls.innerHTML = '<button type="button" class="voice-btn" id="voice-mic">🎙️ Speak</button><button type="button" class="voice-toggle" id="voice-replies">🔊 Voice replies: On</button><span class="voice-status" id="voice-status">Use your voice to ask a question</span>';
    form.insertAdjacentElement('afterend', controls);
    const mic = controls.querySelector('#voice-mic');
    const status = controls.querySelector('#voice-status');
    const toggle = controls.querySelector('#voice-replies');

    if (!SpeechRecognition) {
      mic.disabled = true;
      mic.title = 'Speech recognition is not supported in this browser. Try Chrome.';
      status.textContent = 'Voice input works best in Chrome.';
      mic.style.opacity = '.55';
    } else {
      mic.addEventListener('click', () => {
        if (listening && recognition) { recognition.stop(); return; }
        recognition = new SpeechRecognition();
        recognition.lang = 'en-IN';
        recognition.interimResults = false;
        recognition.continuous = false;
        recognition.onstart = () => {
          listening = true; mic.classList.add('mic-on'); mic.textContent = '⏹ Stop listening';
          status.textContent = 'Listening… speak now';
        };
        recognition.onresult = event => {
          const phrase = event.results?.[0]?.[0]?.transcript?.trim();
          if (phrase) {
            const input = document.querySelector('#chat-input');
            if (input) { input.value = phrase; status.textContent = 'Heard: “' + phrase + '”'; form.requestSubmit(); }
          }
        };
        recognition.onerror = event => { status.textContent = event.error === 'not-allowed' ? 'Please allow microphone access.' : 'Could not hear that. Try again.'; };
        recognition.onend = () => {
          listening = false; mic.classList.remove('mic-on'); mic.textContent = '🎙️ Speak';
          if (status.textContent === 'Listening… speak now') status.textContent = 'Use your voice to ask a question';
        };
        try { recognition.start(); } catch (_) { status.textContent = 'Microphone is busy. Try again.'; }
      });
    }
    toggle.addEventListener('click', () => {
      voiceReplies = !voiceReplies;
      toggle.textContent = voiceReplies ? '🔊 Voice replies: On' : '🔇 Voice replies: Off';
      if (!voiceReplies && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    });
  }

  let lastAssistantText = '';
  const observer = new MutationObserver(() => {
    addControls();
    const bubbles = document.querySelectorAll('#chat-messages .bubble.assistant');
    const latest = bubbles[bubbles.length - 1];
    if (latest) {
      const text = latest.innerText.trim();
      if (text && text !== lastAssistantText) {
        lastAssistantText = text;
        // Speak only responses added after the user has entered a prompt.
        if (document.querySelector('#chat-messages .bubble.user')) speak(text);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  addControls();
})();