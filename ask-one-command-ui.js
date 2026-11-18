/* Ask One command-first interaction layer. Uses existing chat submit pipeline. */
(() => {
  const commandGroups = {
    task:{label:'/task',name:'Tasks',actions:[['Add a task','add task'],['Show open tasks','show my pending tasks'],['Completed tasks','show my completed tasks'],['Delete a task','delete task'],["Today's plan","what should I work on today?"]]},
    expense:{label:'/expense',name:'Expenses',actions:[['Add expense','add expense'],['Show this month','how much did I spend this month?'],['Show today','show my expenses today'],['Search expenses','search my expenses'],['Delete an expense','delete expense']]},
    reminder:{label:'/reminder',name:'Reminders',actions:[['Set reminder','remind me'],['Show all reminders','show all my reminders'],['Edit reminder','edit reminder'],['Delete reminder','delete reminder'],['Pause reminders','pause reminder']]},
    note:{label:'/note',name:'Notes',actions:[['Save a note','save note'],['Search notes','search my notes'],['Show notes','list all notes'],['Edit note','edit note'],['Delete note','delete note']]},
    file:{label:'/file',name:'Files & PDFs',actions:[['Show uploaded files','show my PDFs'],['Read a PDF','read my PDF'],['Read an image','read my image'],['Summarize a file','summarize my file'],['Ask about a file','ask about my uploaded file']]},
    money:{label:'/money',name:'Money & Udhaar',actions:[['Who owes me?','who owes me money?'],['Whom do I owe?','how much do I owe others?'],['Add lending','add lending'],['Add borrowing','add borrowing'],['Show repayments','show repayments']]},
    project:{label:'/project',name:'Projects',actions:[['Create project','create project'],['List projects','show my projects'],['Project progress','show project progress'],['Deadlines','show project deadlines'],['Add milestone','add project milestone']]},
    memory:{label:'/memory',name:'Personal Memory',actions:[['Remember something','remember this'],['Recall saved memory','what do you remember about me?'],['View saved memory','show my saved memories'],['Update memory','update my memory'],['Forget something','forget this']]}
  };
  let selected=null, lastHost=null;
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function panelMarkup(key){
    const group=key&&commandGroups[key];
    return '<div class="one-command-picker" id="one-command-picker" aria-label="Ask One commands"><div class="one-command-picker-head"><span>Commands</span><span class="one-command-picker-hint">Choose an action</span></div><div class="one-command-picker-categories">'+Object.keys(commandGroups).map(k=>'<button type="button" class="one-command-category'+(k===key?' active':'')+'" data-one-command-category="'+k+'">'+esc(commandGroups[k].label)+'</button>').join('')+'</div>'+(group?'<div class="one-command-picker-actions" aria-label="'+esc(group.name)+' actions">'+group.actions.map(([label,query])=>'<button type="button" class="one-command-action" data-one-command-query="'+esc(query)+'">'+esc(label)+' <span aria-hidden="true">›</span></button>').join('')+'</div>':'<div class="one-command-picker-empty">Select a command to see available actions.</div>')+'<div class="one-command-picker-footer">You can also type normally, or enter <code>/</code> for commands.</div></div>';
  }
  function install(){
    const shell=document.querySelector('.chat-shell');
    if(!shell){lastHost=null;return;}
    const form=shell.querySelector('#chat-form');if(!form)return;
    if(shell===lastHost&&shell.querySelector('#one-command-picker'))return;
    lastHost=shell;shell.querySelector('.one-command-history')?.remove();shell.querySelector('.chat-welcome .suggestions')?.remove();shell.querySelector('#one-command-picker')?.remove();
    form.insertAdjacentHTML('beforebegin',panelMarkup(selected));
  }
  const observer=new MutationObserver(install);observer.observe(document.getElementById('page-content')||document.body,{childList:true,subtree:true});
  document.addEventListener('click',e=>{
    const cat=e.target.closest('[data-one-command-category]');
    if(cat){selected=cat.dataset.oneCommandCategory;lastHost=null;install();return;}
    const action=e.target.closest('[data-one-command-query]');
    if(action){const input=document.querySelector('#chat-input'),form=document.querySelector('#chat-form');if(input&&form){input.value=action.dataset.oneCommandQuery||'';form.requestSubmit();}}
  });
  document.addEventListener('input',e=>{
    if(e.target.id!=='chat-input')return;
    const match=e.target.value.trim().match(/^\/(task|expense|reminder|note|file|money|project|memory)(?:\s+(.*))?$/i);
    if(match){selected=match[1].toLowerCase();lastHost=null;install();}
  });
  document.addEventListener('submit',e=>{
    if(e.target.id!=='chat-form')return;const input=document.querySelector('#chat-input');
    if(input&&/^\/(task|expense|reminder|note|file|money|project|memory)$/i.test(input.value.trim())){e.preventDefault();selected=input.value.trim().slice(1).toLowerCase();lastHost=null;install();input.value='';}
  });
  install();
})();