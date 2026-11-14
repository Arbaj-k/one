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
  style.textContent += "\n    .one-voice-overlay{position:fixed;inset:0;z-index:9998;display:grid;place-items:center;padding:24px;background:rgba(8,14,30,.48);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);opacity:0;visibility:hidden;transition:opacity .22s ease,visibility .22s ease}\n    .one-voice-overlay.open{opacity:1;visibility:visible}\n    .one-voice-panel{width:min(440px,100%);min-height:390px;border:1px solid rgba(255,255,255,.72);border-radius:30px;padding:30px 26px 24px;background:linear-gradient(155deg,#fff 0%,#f5f7ff 65%,#eef3ff 100%);box-shadow:0 28px 90px rgba(5,12,35,.28);display:flex;flex-direction:column;align-items:center;text-align:center;color:#17243a;position:relative}\n    .one-voice-close{position:absolute;right:17px;top:15px;width:38px;height:38px;border:0;border-radius:50%;background:#edf1f8;color:#56647b;font-size:22px;cursor:pointer}\n    .one-voice-kicker{font-size:11px;font-weight:800;letter-spacing:.16em;color:#61718d;margin:8px 0 7px}\n    .one-voice-title{font-size:23px;font-weight:700;letter-spacing:-.035em;margin:0}\n    .one-voice-subtitle{font-size:13px;color:#7b879b;margin:8px 0 0}\n    .one-voice-orb-wrap{height:176px;width:100%;display:grid;place-items:center;position:relative;margin:14px 0 5px}\n    .one-voice-orb{height:94px;width:94px;border-radius:50%;display:grid;place-items:center;color:#fff;background:linear-gradient(145deg,#6485ff,#4169e1 58%,#7659e8);box-shadow:0 12px 35px rgba(65,105,225,.34);position:relative;z-index:1;transition:transform .2s ease}\n    .one-voice-orb svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}\n    .one-voice-ring{position:absolute;width:116px;height:116px;border-radius:50%;border:1px solid rgba(76,112,232,.25);opacity:0}\n    .one-voice-overlay[data-state=\"listening\"] .one-voice-ring{animation:oneVoicePulse 1.8s ease-out infinite}\n    .one-voice-overlay[data-state=\"listening\"] .one-voice-ring:nth-child(2){animation-delay:.6s}\n    .one-voice-overlay[data-state=\"listening\"] .one-voice-ring:nth-child(3){animation-delay:1.2s}\n    .one-voice-overlay[data-state=\"listening\"] .one-voice-orb{transform:scale(1.04)}\n    @keyframes oneVoicePulse{0%{transform:scale(.82);opacity:.7}100%{transform:scale(1.85);opacity:0}}\n    .one-voice-live-text{min-height:46px;max-width:340px;width:100%;font-size:15px;line-height:1.5;color:#273650;display:grid;place-items:center;overflow-wrap:anywhere}\n    .one-voice-live-text.placeholder{color:#8b96a8}\n    .one-voice-footer{display:flex;align-items:center;justify-content:center;gap:10px;margin-top:auto;padding-top:18px}\n    .one-voice-stop{border:0;border-radius:999px;padding:12px 24px;background:#4169e1;color:#fff;font:700 13px inherit;cursor:pointer;box-shadow:0 7px 18px rgba(65,105,225,.22)}\n    .one-voice-stop.secondary{background:#e9edf5;color:#47566e;box-shadow:none}\n    .one-voice-overlay[data-state=\"error\"] .one-voice-orb{background:linear-gradient(145deg,#f08a8a,#d94f65)}\n    @media(max-width:600px){.one-voice-overlay{padding:14px;align-items:end}.one-voice-panel{width:100%;min-height:410px;border-radius:28px 28px 22px 22px;padding:28px 22px 22px}.one-voice-orb-wrap{height:170px;margin:12px 0}.one-voice-title{font-size:21px}}\n";
  document.head.appendChild(style);

  function status(message, state = 'idle') {
    const node = document.querySelector('#voice-status');
    if (node) {
      node.textContent = message;
      node.dataset.state = state;
    }
  }
  function ensureVoiceOverlay() {
    let overlay = document.querySelector('#one-voice-overlay');
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'one-voice-overlay';
    overlay.className = 'one-voice-overlay';
    overlay.dataset.state = 'idle';
    overlay.innerHTML = `
      <section class="one-voice-panel" role="dialog" aria-modal="true" aria-labelledby="one-voice-title">
        <button type="button" class="one-voice-close" aria-label="Close voice assistant">×</button>
        <div class="one-voice-kicker">ONE VOICE</div>
        <h2 class="one-voice-title" id="one-voice-title">Speak to One</h2>
        <p class="one-voice-subtitle" data-voice-hint>I'm listening. Say what's on your mind.</p>
        <div class="one-voice-orb-wrap" aria-hidden="true">
          <span class="one-voice-ring"></span><span class="one-voice-ring"></span><span class="one-voice-ring"></span>
          <div class="one-voice-orb"><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"></path></svg></div>
        </div>
        <div class="one-voice-live-text placeholder" data-voice-transcript aria-live="polite">Try: “Remind me tomorrow at 5”</div>
        <div class="one-voice-footer">
          <button type="button" class="one-voice-stop secondary" data-voice-cancel>Cancel</button>
          <button type="button" class="one-voice-stop" data-voice-stop>Done</button>
        </div>
      </section>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', event => {
      if (event.target === overlay || event.target.closest('[data-voice-cancel]') || event.target.closest('.one-voice-close')) {
        stopListening();
        closeVoiceOverlay();
      } else if (event.target.closest('[data-voice-stop]')) {
        stopListening();
      }
    });
    return overlay;
  }

  function updateVoiceOverlay(message, state = 'listening') {
    const overlay = document.querySelector('#one-voice-overlay');
    if (!overlay) return;
    overlay.dataset.state = state;
    const hint = overlay.querySelector('[data-voice-hint]');
    const transcript = overlay.querySelector('[data-voice-transcript]');
    if (hint) hint.textContent = message;
    if (transcript && state !== 'listening' && state !== 'processing') {
      transcript.textContent = message;
      transcript.classList.add('placeholder');
    }
  }

  function closeVoiceOverlay() {
    const overlay = document.querySelector('#one-voice-overlay');
    if (!overlay) return;
    overlay.classList.remove('open');
    window.setTimeout(() => overlay.remove(), 240);
  }

  function showVoiceOverlay() {
    const overlay = ensureVoiceOverlay();
    overlay.dataset.state = 'listening';
    overlay.querySelector('[data-voice-hint]').textContent = 'I’m listening. Say what’s on your mind.';
    overlay.querySelector('[data-voice-transcript]').textContent = 'Start speaking…';
    overlay.querySelector('[data-voice-transcript]').classList.add('placeholder');
    requestAnimationFrame(() => overlay.classList.add('open'));
  }


  function updateMic() {
    const mic = document.querySelector('#voice-mic');
    if (!mic) return;
    mic.classList.toggle('mic-on', listening);
    mic.querySelector('span').textContent = listening ? 'Stop' : 'Speak';
    mic.setAttribute('aria-pressed', String(listening));
  }

  function stopListening() {
    if (recognition && listening) { updateVoiceOverlay('Finishing up…', 'processing'); recognition.stop(); }
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
      showVoiceOverlay();
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
        updateVoiceOverlay('I’m listening. Speak naturally, then pause.', 'listening');
      };

      recognition.onresult = event => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const part = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) finalText += part + ' ';
          else interim += part;
        }
        const transcript = document.querySelector('#voice-transcript');
        if (transcript) {
          transcript.textContent = (finalText + interim).trim() || 'Listening…';
          transcript.classList.add('visible');
        }
        const overlayTranscript = document.querySelector('#one-voice-overlay [data-voice-transcript]');
        if (overlayTranscript) {
          overlayTranscript.textContent = (finalText + interim).trim() || 'I’m listening…';
          overlayTranscript.classList.toggle('placeholder', !(finalText + interim).trim());
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
        const errorMessage = messages[event.error] || 'Could not hear that. Please try again.';
        status(errorMessage, 'error');
        updateVoiceOverlay(errorMessage, 'error');
      };

      recognition.onend = () => {
        listening = false;
        updateMic();
        const phrase = finalText.replace(/\\s+/g, ' ').trim();
        if (phrase && !submitted) {
          submitted = true;
          status('Heard: “' + phrase + '” · processing…', 'processing');
          updateVoiceOverlay('Heard you. Processing…', 'processing');
          if (typeof window.submitStudentBrainVoiceText === 'function') {
            const accepted = window.submitStudentBrainVoiceText(phrase);
            if (accepted) { status('Command received: “' + phrase + '”', 'idle'); updateVoiceOverlay('Got it. Taking care of that…', 'processing'); window.setTimeout(closeVoiceOverlay, 900); }
            else { status('Could not process that command. Tap Speak and try again.', 'error'); updateVoiceOverlay('Could not process that. Please try again.', 'error'); }
          } else {
            status('Voice command handler is not ready. Refresh and try again.', 'error'); updateVoiceOverlay('One is still getting ready. Please try again.', 'error');
          }
          finalText = '';
        } else if (document.querySelector('#voice-status')?.dataset.state === 'listening') {
          status('No complete words were detected. Tap Speak and try again.', 'error');
          updateVoiceOverlay('I didn’t catch that. Tap Done and try again.', 'error');
        }
      };

      recognition.start();
    } catch (error) {
      listening = false;
      updateMic();
      status('Microphone is busy. Try again in a moment.', 'error');
      updateVoiceOverlay('Microphone is busy. Try again in a moment.', 'error');
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
      <div class="voice-tools">
        <button type="button" class="voice-btn" id="voice-mic" aria-label="Speak to One" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M5 11a7 7 0 0 0 14 0M12 18v3m-4 0h8"></path></svg><span>Speak</span></button>
        <label class="voice-language-wrap"><span class="sr-only">Voice language</span><select class="voice-language" id="voice-language" aria-label="Voice language">${languages.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
        <button type="button" class="voice-toggle" id="voice-replies" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4Z"></path><path d="M16 9a5 5 0 0 1 0 6m2-9a9 9 0 0 1 0 12"></path></svg><span>Read replies: Off</span></button>
      </div>
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
      toggle.querySelector('span').textContent = voiceReplies ? 'Read replies: On' : 'Read replies: Off';
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