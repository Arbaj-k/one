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

      // Continue only an action that the user already explicitly started.
      // This includes YES/NO replies and the follow-up details for a reminder.
      if (legacy.hasPending?.() || legacy.hasPendingReminder?.()) return true;

      // Local query commands remain routable even when phrased as questions.
      const parsed = legacy.parseCommand(query);
      const localSection = !!parsed?.section;
      const readOnly = /^\s*(?:what|what's|whats|which|who|when|where|why|how|explain|describe|help me understand|can you explain|kya|kaise|kyun|kyu|kab|kahan|samjhao|समझाओ|क्या|कैसे|क्यों|कब|कहाँ)\b/i.test(query);
      if (readOnly && !localSection && !legacy.hasPending?.() && !legacy.hasPendingReminder?.()) return false;

      // Natural-language task intent: no special syntax or slash commands.
      const explicitTaskCommand = /^\s*(?:(?:please|kindly)\s+)?(?:add|create|make)\s+(?:(?:a|an|new|ek)\s+)?(?:task|todo|assignment|homework|exam)\b|^\s*(?:can|could|would)\s+you\s+(?:please\s+)?(?:add|create|make)\s+(?:(?:a|an|new|ek)\s+)?(?:task|todo|assignment|homework|exam)\b|^\s*(?:task|todo)\s+(?:add|bana|create|make)\s+(?:kar\s+do|karo|do)\b|^\s*(?:task bana do|task add kar do|todo bana do|assignment add kar do|homework add kar do)\b|^\s*(?:mujhe|mere liye)\s+(?:ek\s+)?(?:task|todo|assignment)\s+(?:add|bana)\s+(?:kar\s+do|karo|do)\b/i.test(query);
      const explicitAction = /^\s*(?:(?:please|kindly)\s+)?(?:add|create|make|save|record|log|track|delete|remove|edit|update|change|complete|finish|mark|remember)\b/i.test(query)
        || /^\s*(?:can|could|would)\s+you\s+(?:please\s+)?(?:add|create|make|save|record|log|track|delete|remove|edit|update|change|complete|finish|mark)\b/i.test(query)
        || /^\s*(?:task|todo|note|project|routine|habit|expense|income)\s+(?:add|bana|create|make|save|delete|remove|update|edit)\b/i.test(query)
        || /^\s*(?:i\s+)?(?:spent|paid|received|earned|lent|borrowed)\b/i.test(query);
      const explicitReminder = /^\s*(?:(?:please|kindly)\s+)?(?:remind(?:er)?\b|set (?:a )?reminder\b|yaad dila(?:na| do)?|yaad rakhna|brief me)\b/i.test(query)
        || /\b(?:set|create|add|schedule)\s+(?:a\s+)?reminder\b/i.test(query)
        || /\breminder\s+(?:set|laga|lagao|kar|karo|karna)\b/i.test(query);
      const taskManagement = /^\s*(?:(?:show|list|display)\s+(?:me\s+)?(?:my\s+)?(?:all\s+)?tasks\b|(?:mere\s+)?tasks?\s+(?:dikhao|batao|list|show)\b|(?:mark|complete|finish|done)\s+(?:the\s+)?(?:task\s+)?(.+?)\s+(?:as\s+)?(?:done|complete|completed)\b|(?:delete|remove|hatao)\s+(?:the\s+)?(?:task|todo)?\s*.+)/i.test(query);
      const implicitTaskIntent = /^(?=.*(?:\b(?:kal|tomorrow|today|aaj|parso|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?|subah|shaam|sham|raat)\b))(?=.*\b(?:jaana hai|jana hai|karna hai|karni hai|karne hain|submit karna|call karna|need to|have to|got to|should|must|remind me to)\b).+/i.test(query)
        || /^\s*(?:i need to|i have to|i should|i must|mujhe .+\b(?:karna|karni|jana|jaana) hai)\b/i.test(query);
      return localSection || explicitTaskCommand || explicitAction || explicitReminder || taskManagement || implicitTaskIntent;
    }
    async function run(input) {
      const text = String(input || '').trim();
      if (!text) return false;
      if (!canHandle(text)) {
        if (typeof cfg.fallback === 'function') await cfg.fallback(text);
        return false;
      }
      try {
        // Convert an unambiguous natural-language commitment into the existing
        // local task command shape. Questions are filtered in canHandle first.
        const taskIntent = /^(?=.*(?:\b(?:kal|tomorrow|today|aaj|parso|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2})?\s*(?:am|pm|baje)?|subah|shaam|sham|raat)\b))(?=.*\b(?:jaana hai|jana hai|karna hai|karni hai|karne hain|submit karna|call karna|need to|have to|got to|should|must)\b).+/i.test(text)
          || /^\s*(?:i need to|i have to|i should|i must|mujhe .+\b(?:karna|karni|jana|jaana) hai)\b/i.test(text);
        const explicitReminder = /^\s*(?:(?:please|kindly)\s+)?(?:remind(?:er)?\b|set (?:a )?reminder\b|yaad dila(?:na| do)?|yaad rakhna|brief me)\b/i.test(text)
          || /\b(?:set|create|add|schedule)\s+(?:a\s+)?reminder\b/i.test(text)
          || /\breminder\s+(?:set|laga|lagao|kar|karo|karna)\b/i.test(text);
        const commandText = !explicitReminder && taskIntent && !/^\s*(?:add|create|make)\b/i.test(text)
          ? 'add task ' + text : text;
        let result;
        // Reminder commands must go through the reminder-aware legacy handler.
        // Calling the generic addTask callback here silently turns reminders into tasks.
        if (explicitReminder) {
          result = legacy.executeCommand(commandText);
        } else {
          const parsed = legacy.parseCommand(commandText);
          if (parsed?.ambiguous) {
          const names = { tasks: 'Tasks', notes: 'Notes', projects: 'Projects', routines: 'Routines', money: 'Money', files: 'Files', scan: 'Scan' };
          result = { answer: 'Aap ' + parsed.matched.map(key => names[key] || key).join(' ya ') + ' ke baare mein pooch rahe ho?', sources: ['Ask One'] };
        } else {
          let actionName = ACTION_FOR[parsed?.action]?.[parsed?.section];
          if (parsed?.section === 'money' && parsed?.action === 'add' && /\b(income|salary|kamai|received|credited|aayi|aaya)\b/i.test(text)) actionName = 'addIncome';
          // One authoritative executor owns all local mutations and persistence.
          result = legacy.executeCommand(commandText);
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
