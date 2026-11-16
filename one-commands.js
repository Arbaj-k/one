/* one-commands.js — Command-based chat + voice adapter for One.
   Uses the existing local command engine so app data, validation and storage stay intact.
   No network calls, backend, or third-party libraries. */
(function (global) {
  'use strict';
  const legacy = global.OneCommands;
  if (!legacy || typeof legacy.executeCommand !== 'function') {
    console.warn('OneCommands: load commands.js before one-commands.js');
    return;
  }

  const ACTION_FOR = {
    add: { tasks: 'addTask', notes: 'addNote', projects: 'addProject', routines: 'addRoutine', money: 'addExpense' },
    show: { tasks: 'show', notes: 'show', projects: 'show', routines: 'show', money: 'show', files: 'show' },
    complete: { tasks: 'completeTask' },
    delete: { tasks: 'remove', notes: 'remove', projects: 'remove', routines: 'remove', money: 'remove' },
    edit: { tasks: 'editTask', notes: 'editNote', projects: 'editProject', routines: 'editRoutine' }
  };

  function create(config) {
    const cfg = config || {};
    let recognition = null;
    let listening = false;
    const reply = (message, ok = true) => {
      if (typeof cfg.onReply === 'function') cfg.onReply(String(message), !!ok);
      if (cfg.speak && 'speechSynthesis' in global && typeof global.SpeechSynthesisUtterance === 'function') {
        const utterance = new global.SpeechSynthesisUtterance(String(message).replace(/[✅🗑️📂📝⏰]/gu, ''));
        utterance.lang = cfg.lang || 'hi-IN';
        global.speechSynthesis.cancel();
        global.speechSynthesis.speak(utterance);
      }
    };

    function canHandle(text) {
      const query = String(text || '').trim();
      if (!query) return false;
      const explicitTaskCommand = /^\\s*(?:please\\s+)?(?:add|create|make)\\s+(?:(?:a|an|new)\\s+)?(?:task|todo)\\b|(?:^|\\s)(?:(?:please|kindly)\\s+)?(?:can|could|would)\\s+you\\s+(?:please\\s+)?(?:add|create|make)\\s+(?:(?:a|an|new)\\s+)?(?:task|todo)\\b|\\b(?:task|todo)\\s+(?:add|bana|create|make)\\s+(?:kar\\s+do|karo|do)\\b|\\b(?:task bana do|task add kar do|todo bana do)\\b/i.test(query);
      const questionLike = /[?？]\\s*$/.test(query) || /^\\s*(?:what|what's|whats|which|who|when|where|why|how|can|could|would|should|do|does|did|is|are|was|were|kya|kaise|kyun|kyu|kab|kahan|kitna|kitne|kitni|kaun|kis|क्या|कैसे|क्यों|कब|कहाँ|कितना|कितने|कितनी|कौन)\\b/i.test(query);
      if (questionLike && !explicitTaskCommand) return false;
      const parsed = legacy.parseCommand(query);
      const reminder = /\b(?:remind(?:er)?|yaad\s+(?:dila|dilana|dila do|dila dena|rakhna)|set\s+(?:a\s+)?reminder|reminder\s+(?:set|laga)|briefing)\b/i.test(query);
      const actionCue = Object.values(legacy.KEYWORDS?.action || {}).flat().some(word => query.toLowerCase().includes(word));
      return !!(reminder || legacy.hasPending?.() || legacy.hasPendingReminder?.() || parsed?.ambiguous || parsed?.section || actionCue);
    }

    async function run(input) {
      const text = String(input || '').trim();
      if (!text) return false;
      if (!canHandle(text)) {
        if (typeof cfg.fallback === 'function') await cfg.fallback(text);
        return false;
      }
      try {
        const parsed = legacy.parseCommand(text);
        let result;
        if (parsed?.ambiguous) {
          const names = { tasks: 'Tasks', notes: 'Notes', projects: 'Projects', routines: 'Routines', money: 'Money', files: 'Files', scan: 'Scan' };
          result = { answer: 'Aap ' + parsed.matched.map(key => names[key] || key).join(' ya ') + ' ke baare mein pooch rahe ho?', sources: ['Ask One'] };
        } else {
          let actionName = ACTION_FOR[parsed?.action]?.[parsed?.section];
          if (parsed?.section === 'money' && parsed?.action === 'add' && /\b(income|salary|kamai|received|credited|aayi|aaya)\b/i.test(text)) actionName = 'addIncome';
          const callback = actionName && cfg.actions && cfg.actions[actionName];
          if (typeof callback === 'function') {
            const args = {
              title: parsed.title, text: parsed.title, amount: parsed.amount,
              label: parsed.title, due: parsed.date, time: parsed.time,
              kind: parsed.section, query: text
            };
            result = await callback(args);
            if (!result) result = legacy.executeCommand(text);
          } else {
            result = legacy.executeCommand(text);
          }
        }
        if (result && typeof result.then === 'function') result = await result;
        if (result?.answer) reply(result.answer, true);
        return !!result;
      } catch (error) {
        console.error('Ask One command failed:', error);
        reply('Command complete nahi ho payi. Dobara try karo.', false);
        return true;
      }
    }

    function startVoice() {
      const SpeechRecognition = global.SpeechRecognition || global.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        reply('Is browser mein voice support nahi hai. Type karke command dein.', false);
        return false;
      }
      if (listening) return true;
      try {
        recognition = new SpeechRecognition();
        recognition.lang = cfg.lang || 'hi-IN';
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => { listening = true; cfg.onListening?.(true); };
        recognition.onresult = event => {
          const transcript = Array.from(event.results).map(item => item[0]?.transcript || '').join(' ').trim();
          cfg.onHeard?.(transcript);
          const last = event.results[event.results.length - 1];
          if (last?.isFinal && transcript) {
            if (typeof cfg.onVoiceSubmit === 'function') cfg.onVoiceSubmit(transcript);
            else run(transcript);
          }
        };
        recognition.onerror = event => {
          const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'Mic permission nahi mili. Browser settings mein microphone allow karo.'
            : 'Mic error: ' + event.error;
          reply(message, false);
        };
        recognition.onend = () => { listening = false; cfg.onListening?.(false); };
        recognition.start();
        return true;
      } catch (error) {
        listening = false;
        reply('Voice start nahi ho payi. Mic permission check karo.', false);
        return false;
      }
    }

    function stopVoice() {
      if (recognition && listening) recognition.stop();
    }

    return { run, startVoice, stopVoice, isListening: () => listening, canHandle, setLanguage: value => { cfg.lang = value || 'hi-IN'; } };
  }

  global.OneCommands.create = create;
})(window);
