/* Ask One voice capture with a Google-style listening overlay. */
(() => {
 const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
 let lang='hi-IN',speakReplies=false,overlay=null,transcriptNode=null,statusNode=null,micNode=null;
 try{const p=JSON.parse(localStorage.getItem('one-voice-preferences-v1')||'{}');lang=p.language||lang;speakReplies=!!p.speakReplies}catch{}
 const save=()=>localStorage.setItem('one-voice-preferences-v1',JSON.stringify({language:lang,speakReplies}));
 const speak=t=>{if(!speakReplies||!window.speechSynthesis)return;window.speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(String(t||'').replace(/\s+/g,' ').slice(0,900));u.lang=lang;window.speechSynthesis.speak(u)};
 function buildOverlay(){
  if(overlay)return;
  overlay=document.createElement('div');overlay.id='one-voice-overlay';overlay.hidden=true;
  overlay.innerHTML='<section class="one-voice-dialog" role="dialog" aria-modal="true" aria-label="Ask One voice input"><button type="button" class="one-voice-close" aria-label="Close voice input">×</button><div class="one-voice-orb"><span class="one-voice-orb-mic">🎙</span><span class="one-voice-bars"><i></i><i></i><i></i><i></i><i></i></span></div><h2 class="one-voice-title">Listening…</h2><p class="one-voice-hint">Speak now. One is listening.</p><div class="one-voice-transcript" aria-live="polite">Boliye…</div><button type="button" class="one-voice-stop">Done</button></section>';
  document.body.appendChild(overlay);
  transcriptNode=overlay.querySelector('.one-voice-transcript');statusNode=overlay.querySelector('.one-voice-title');
  overlay.querySelector('.one-voice-close').onclick=closeOverlay;
  overlay.querySelector('.one-voice-stop').onclick=()=>{window.ensureOneCommandCenter?.()?.stopVoice();setListening(false)};
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeOverlay()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!overlay.hidden)closeOverlay()});
  const style=document.createElement('style');style.textContent=`
  #one-voice-overlay{position:fixed;inset:0;z-index:100000;background:rgba(5,10,22,.82);backdrop-filter:blur(14px);display:grid;place-items:center;padding:22px}
  #one-voice-overlay[hidden]{display:none}
  .one-voice-dialog{position:relative;width:min(430px,100%);min-height:390px;border:1px solid #34496d;border-radius:30px;background:linear-gradient(155deg,#1b2c49,#101a2c 70%);color:#f4f7ff;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:38px 25px 28px;text-align:center;box-shadow:0 25px 90px #0008}
  .one-voice-close{position:absolute;right:18px;top:14px;width:42px;height:42px;border:0;border-radius:50%;background:#ffffff12;color:#eaf0ff;font-size:28px;line-height:1}
  .one-voice-orb{position:relative;width:116px;height:116px;border-radius:50%;display:grid;place-items:center;background:radial-gradient(circle at 35% 28%,#7d9cff,#4168e8 60%,#2446b7);box-shadow:0 0 0 13px #5478ef18,0 0 55px #4569e766;margin:12px 0 28px}
  .one-voice-orb-mic{font-size:38px;z-index:2}
  .one-voice-bars{position:absolute;inset:-14px;border:2px solid #7895ff55;border-radius:50%;animation:oneVoiceRing 1.8s ease-out infinite}
  .one-voice-bars i{display:none}
  .one-voice-dialog.is-listening .one-voice-orb{animation:oneVoicePulse 1.15s ease-in-out infinite}
  .one-voice-dialog.is-listening .one-voice-bars{animation:oneVoiceRing 1.8s ease-out infinite}
  .one-voice-title{font:700 24px system-ui;margin:0 0 8px}
  .one-voice-hint{font:14px system-ui;color:#aebcda;margin:0 0 22px}
  .one-voice-transcript{width:100%;min-height:58px;padding:14px;border:1px solid #34496b;border-radius:15px;background:#ffffff09;color:#e8efff;font:16px/1.5 system-ui;overflow-wrap:anywhere}
  .one-voice-stop{margin-top:24px;min-width:120px;padding:12px 24px;border:0;border-radius:24px;background:#edf1ff;color:#263e9e;font:700 14px system-ui}
  @keyframes oneVoicePulse{50%{transform:scale(1.07);box-shadow:0 0 0 20px #5478ef14,0 0 65px #4569e788}}
  @keyframes oneVoiceRing{0%{transform:scale(.9);opacity:.9}100%{transform:scale(1.35);opacity:0}}
  @media(max-width:600px){.one-voice-dialog{min-height:370px;border-radius:26px;padding:34px 20px 24px}.one-voice-title{font-size:22px}}
  `;document.head.appendChild(style);
 }
 function openOverlay(){buildOverlay();overlay.hidden=false;overlay.querySelector('.one-voice-dialog').classList.add('is-listening');statusNode.textContent='Listening…';transcriptNode.textContent='Boliye…';}
 function closeOverlay(){if(!overlay||overlay.hidden)return;overlay.hidden=true;overlay.querySelector('.one-voice-dialog').classList.remove('is-listening');}
 function setTranscript(value){if(transcriptNode&&value)transcriptNode.textContent=value}
 function setListening(active){if(!overlay||overlay.hidden)return;const dialog=overlay.querySelector('.one-voice-dialog');dialog.classList.toggle('is-listening',!!active);statusNode.textContent=active?'Listening…':'Processing…';if(!active){setTimeout(()=>{if(overlay&&!overlay.hidden)closeOverlay()},800)}}
 window.OneVoice={speak,open:openOverlay,close:closeOverlay,setTranscript,setListening};
 function attach(){
  const form=document.querySelector('#chat-form');if(!form||form.dataset.voiceBound)return;form.dataset.voiceBound='1';
  const mic=document.createElement('button');mic.type='button';mic.id='one-voice-mic';mic.className='btn chat-send';mic.textContent='🎙';mic.setAttribute('aria-label','Speak to One');mic.title='Speak to One';
  const status=document.createElement('span');status.id='one-voice-status';status.className='voice-status';status.setAttribute('role','status');
  if(!SR){mic.disabled=true;mic.title='Voice input is not supported in this browser';status.textContent='Voice support nahi hai. Type karke bhejein.';form.insertBefore(mic,form.querySelector('button[type=submit]'));form.after(status);return}
  form.insertBefore(mic,form.querySelector('button[type=submit]'));form.after(status);micNode=mic;
  mic.onclick=()=>{const center=window.ensureOneCommandCenter?.();if(!center){status.textContent='Ask One load ho raha hai. Dobara try karein.';return}if(center.isListening()){center.stopVoice();closeOverlay();return}openOverlay();status.textContent='Listening…';if(!center.startVoice()){closeOverlay();status.textContent='Mic start nahi hua. Permission check karein.'}};
 }
 window.startStudentBrainListening=()=>document.querySelector('#one-voice-mic')?.click();window.isStudentBrainVoiceRepliesOn=()=>speakReplies;window.speakVoiceConfirmation=speak;window.submitStudentBrainVoiceText=raw=>{const q=String(raw||'').trim();if(!q||typeof sendChat!=='function')return false;sendChat(q);return true};
 const obs=new MutationObserver(attach);obs.observe(document.body,{childList:true,subtree:true});attach();
 document.addEventListener('change',e=>{if(e.target.id==='one-voice-language'){lang=e.target.value;window.OneCommandCenter?.setLanguage?.(lang);save()}if(e.target.id==='one-voice-speak'){speakReplies=e.target.checked;save()}});
 const spoken=new MutationObserver(()=>{const n=document.querySelectorAll('#chat-messages .bubble.assistant'),last=n[n.length-1];if(last&&!last.dataset.voiceSpoken){last.dataset.voiceSpoken='1';speak(last.innerText)}});spoken.observe(document.body,{childList:true,subtree:true});
})();
