/* Student Brain voice controller — browser-native speech APIs, no paid service. */
(() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let listening = false;
  let voiceReplies = false;
  let selectedLanguage = 'en-IN';
  let lastSpokenBubble = null;

  const languages = [
    ['en-IN', 'English (India)'],
    ['hi-IN', 'हिन्दी'],
    ['en-US', 'English (US)']
  ];

  window.isStudentBrainVoiceRepliesOn = () => voiceReplies;

  const style = document.createElement('style');
  style.textContent = `
    .voice-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:12px 0 3px}
    .voice-btn,.voice-toggle,.voice-language{border:1px solid #e4e9f2;background:#fff;color:#17243a;border-radius:11px;padding:10px 12px;font:600 12px 'DM Sans',sans-serif;cursor:pointer}
    .voice-btn{display:inline-flex;align-items:center;gap:7px}
    .voice-btn:disabled{opacity:.5;cursor:not-allowed}
    .voice-btn.mic-on{background:#4263eb;color:#fff;border-color:#4263eb}
    .voice-toggle{background:#edf1ff;color:#4560cc;border-color:#edf1ff}
    .voice-status{font-size:11px;color:#7a879a;flex:1;min-width:150px}
    .voice-status[data-state="error"]{color:#c24141}
    .voice-status[data-state="listening"],.voice-status[data-state="processing"]{color:#4263eb;font-weight:600}
    .voice-transcript{font-size:12px;color:#58677e;padding:7px 10px;background:#f6f8fc;border-radius:9px;margin-top:6px;display:none}
    .voice-transcript.visible{display:block}
    @media(max-width:600px){.voice-controls{gap:6px}.voice-status{flex-basis:100%;padding:2px 3px}}
  `;
  document.head.appendChild(style);

  function status(message, state = 'idle') {
    const node = document.querySelector('#voice-status');
    if (node) {
      node.textContent = message;
      node.dataset.state = state;
    }
  }

  function updateMic() {
    const mic = document.querySelector('#voice-mic');
    if (!mic) return;
    mic.classList.toggle('mic-on', listening);
    mic.textContent = listening ? '⏹ Stop' : '🎙 Speak';
    mic.setAttribute('aria-pressed', String(listening));
  }

  function stopListening() {
    if (recognition && listening) recognition.stop();
  }

  function startListening() {
    if (!Recognition) {
      status('Speech input is not supported here. Try Chrome or Edge.', 'error');
      return;
    }
    if (listening) {
      stopListening();
      return;
    }

    try {
      recognition = new Recognition();
      recognition.lang = selectedLanguage;
      recognition.interimResults = true;
      recognition.continuous = false;
      let finalText = '';
      let submitted = false;

      recognition.onstart = () => {
        listening = true;
        updateMic();
        status('Listening… speak clearly, then pause.', 'listening');
      };

      recognition.onresult = event => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const part = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) finalText += part;
          else interim += part;
        }
        const transcript = document.querySelector('#voice-transcript');
        if (transcript) {
          transcript.textContent = finalText || interim || 'Listening…';
          transcript.classList.add('visible');
        }
        if (finalText.trim() && !submitted) {
          submitted = true;
          const phrase = finalText.trim();
          status('Heard: “' + phrase + '” · processing…', 'processing');
          if (typeof window.submitStudentBrainVoiceText === 'function') {
            const accepted = window.submitStudentBrainVoiceText(phrase);
            if (accepted) status('Command received: “' + phrase + '”', 'idle');
            else status('Could not process that command. Tap Speak and try again.', 'error');
          } else {
            status('Voice command handler is not ready. Refresh and try again.', 'error');
          }
          finalText = '';
        }
      };

      recognition.onerror = event => {
        const messages = {
          'not-allowed': 'Microphone permission is blocked. Allow it in browser site settings.',
          'service-not-allowed': 'Speech service is blocked by the browser.',
          'no-speech': 'I didn’t hear anything. Tap Speak and try again.',
          'audio-capture': 'No microphone found. Check your mic connection.',
          'network': 'Speech recognition needs a network connection.'
        };
        status(messages[event.error] || 'Could not hear that. Please try again.', 'error');
      };

      recognition.onend = () => {
        listening = false;
        updateMic();
        if (document.querySelector('#voice-status')?.dataset.state === 'listening') {
          status('Ready when you are. Tap Speak to try again.');
        }
      };

      recognition.start();
    } catch (error) {
      listening = false;
      updateMic();
      status('Microphone is busy. Try again in a moment.', 'error');
    }
  }

  function speak(text) {
    if (!voiceReplies || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.lang = selectedLanguage;
    utterance.rate = 0.96;
    utterance.pitch = 1;
    const voices = window.speechSynthesis.getVoices();
    const voice = voices.find(v => v.lang.toLowerCase() === selectedLanguage.toLowerCase())
      || voices.find(v => v.lang.toLowerCase().startsWith(selectedLanguage.split('-')[0]));
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  }

  function addControls() {
    const form = document.querySelector('#chat-form');
    if (!form || form.dataset.voiceReady) return;
    form.dataset.voiceReady = '1';

    const controls = document.createElement('div');
    controls.className = 'voice-controls';
    controls.innerHTML = `
      <button type="button" class="voice-btn" id="voice-mic" aria-label="Speak to Student Brain" aria-pressed="false">🎙 Speak</button>
      <select class="voice-language" id="voice-language" aria-label="Voice language">
        ${languages.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}
      </select>
      <button type="button" class="voice-toggle" id="voice-replies" aria-pressed="false">🔇 Read replies: Off</button>
      <span class="voice-status" id="voice-status" role="status" aria-live="polite">Tap Speak to ask by voice</span>
      <div class="voice-transcript" id="voice-transcript" aria-live="polite"></div>
    `;
    form.insertAdjacentElement('afterend', controls);

    const mic = controls.querySelector('#voice-mic');
    const toggle = controls.querySelector('#voice-replies');
    const language = controls.querySelector('#voice-language');

    if (!Recognition) {
      mic.disabled = true;
      mic.title = 'Speech recognition is not supported in this browser.';
      status('Voice input is unavailable in this browser. Try Chrome or Edge.', 'error');
    }
    mic.addEventListener('click', startListening);
    language.addEventListener('change', () => {
      selectedLanguage = language.value;
      status('Voice language: ' + languages.find(x => x[0] === selectedLanguage)?.[1]);
    });
    toggle.addEventListener('click', () => {
      voiceReplies = !voiceReplies;
      toggle.textContent = voiceReplies ? '🔊 Read replies: On' : '🔇 Read replies: Off';
      toggle.setAttribute('aria-pressed', String(voiceReplies));
      if (!voiceReplies && window.speechSynthesis) window.speechSynthesis.cancel();
      status(voiceReplies ? 'Voice replies enabled.' : 'Voice replies disabled.');
    });
  }

  // The mobile navigation Speak shortcut uses the exact same controller.
  window.startStudentBrainListening = startListening;

  const observer = new MutationObserver(() => {
    addControls();
    const bubbles = document.querySelectorAll('#chat-messages .bubble.assistant');
    const latest = bubbles[bubbles.length - 1];
    if (!latest || latest === lastSpokenBubble) return;
    lastSpokenBubble = latest;
    const text = latest.innerText?.trim();
    if (text) speak(text);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  addControls();

  window.addEventListener('pagehide', () => {
    stopListening();
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  });
})();