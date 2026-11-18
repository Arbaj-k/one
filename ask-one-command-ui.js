/* Ask One command chips: insert a prefix into the chat input; user writes the rest. */
(() => {
  const commands=['/task','/expense','/reminder','/note','/file','/money','/project','/memory'];
  let host=null;
  const panel='<div class="one-command-picker" id="one-command-picker" aria-label="Ask One commands"><div class="one-command-picker-head"><span>Commands</span></div><div class="one-command-picker-categories">'+commands.map(c=>'<button type="button" class="one-command-category" data-one-command-prefix="'+c+'">'+c+'</button>').join('')+'</div></div>';
  function install(){
    const shell=document.querySelector('.chat-shell');if(!shell){host=null;return;}
    const form=shell.querySelector('#chat-form');if(!form)return;
    if(shell===host&&shell.querySelector('#one-command-picker'))return;
    host=shell;shell.querySelector('.one-command-history')?.remove();shell.querySelector('.chat-welcome .suggestions')?.remove();shell.querySelector('#one-command-picker')?.remove();
    form.insertAdjacentHTML('beforebegin',panel);
  }
  const observer=new MutationObserver(install);observer.observe(document.getElementById('page-content')||document.body,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    const chip=e.target.closest('[data-one-command-prefix]');if(!chip)return;
    const input=document.querySelector('#chat-input');if(!input)return;
    const prefix=chip.dataset.oneCommandPrefix;
    input.value=input.value.trim()?input.value.trimEnd()+' '+prefix+' ':prefix+' ';
    input.focus();try{input.setSelectionRange(input.value.length,input.value.length)}catch(_){}
  });
  document.addEventListener('submit',e=>{
    if(e.target.id!=='chat-form')return;
    const input=document.querySelector('#chat-input');
    if(input&&/^\/(task|expense|reminder|note|file|money|project|memory)$/i.test(input.value.trim()))e.preventDefault();
  });
  install();
})();