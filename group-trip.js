(function(){
'use strict';
const KEY='one-group-trip-member-v1';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=p=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format((Number(p)||0)/100);
const client=()=>window.getOneSupabaseClient?.();
const tokenKey=code=>KEY+':'+code;
const getToken=code=>{try{return localStorage.getItem(tokenKey(code))||''}catch(_){return ''}};
const setToken=(code,token)=>{try{localStorage.setItem(tokenKey(code),token)}catch(_){}};
const randomToken=()=>{const b=new Uint8Array(32);crypto.getRandomValues(b);return [...b].map(x=>x.toString(16).padStart(2,'0')).join('')};
const invite=()=>new URL(location.href).searchParams.get('trip')||'';
let state=null,loading=false,error='';
async function rpc(name,args){const c=client();if(!c)throw new Error('One cloud connection is not ready');const {data,error}=await c.rpc(name,args);if(error)throw error;return data}
function settlement(s){
 const net=new Map((s.members||[]).map(m=>[m.id,0]));
 for(const e of s.expenses||[]){const ids=[...new Set(e.split_member_ids||[])];if(!ids.length)continue;const base=Math.floor(Number(e.amount_paise)/ids.length),rem=Number(e.amount_paise)%ids.length;net.set(e.payer_member_id,(net.get(e.payer_member_id)||0)+Number(e.amount_paise));ids.forEach((id,i)=>net.set(id,(net.get(id)||0)-base-(i<rem?1:0)));}
 for(const x of s.transfers||[])if(x.status==='confirmed'){net.set(x.from_member_id,(net.get(x.from_member_id)||0)+Number(x.amount_paise));net.set(x.to_member_id,(net.get(x.to_member_id)||0)-Number(x.amount_paise));}
 const creditors=[],debtors=[];for(const [id,n] of net){if(n>0)creditors.push({id,amount:n});if(n<0)debtors.push({id,amount:-n});}
 creditors.sort((a,b)=>b.amount-a.amount);debtors.sort((a,b)=>b.amount-a.amount);
 const moves=[];let i=0,j=0;while(i<debtors.length&&j<creditors.length){const amount=Math.min(debtors[i].amount,creditors[j].amount);if(amount>0)moves.push({from:debtors[i].id,to:creditors[j].id,amount});debtors[i].amount-=amount;creditors[j].amount-=amount;if(!debtors[i].amount)i++;if(!creditors[j].amount)j++;}
 return {net,moves};
}
function memberName(s,id){return s.members.find(m=>m.id===id)?.display_name||'Member'}
function memberOptions(s,selected){return s.members.map(m=>'<option value="'+m.id+'" '+(m.id===selected?'selected':'')+'>'+esc(m.display_name)+'</option>').join('')}
function dashboard(s,code){
 const calc=settlement(s),me=s.me,owner=me.is_owner;
 const total=(s.expenses||[]).reduce((n,e)=>n+Number(e.amount_paise||0),0);
 const transfers=(s.transfers||[]).map(x=>'<div class="gt-row"><div><b>'+esc(memberName(s,x.from_member_id))+' → '+esc(memberName(s,x.to_member_id))+'</b><small>'+money(x.amount_paise)+' · '+(x.status==='confirmed'?'Confirmed':'Awaiting receiver confirmation')+'</small></div>'+(x.status==='pending'&&x.to_member_id===me.id?'<button class="btn small primary" data-trip-action="confirm" data-id="'+x.id+'">Confirm received</button>':'<span class="tag '+(x.status==='confirmed'?'green':'amber')+'">'+(x.status==='confirmed'?'Paid':'Pending')+'</span>')+'</div>').join('');
 const moves=calc.moves.map(x=>'<div class="gt-row"><div><b>'+esc(memberName(s,x.from))+' pays '+esc(memberName(s,x.to))+'</b><small>'+money(x.amount)+' · suggested settlement</small></div>'+(x.from===me.id?'<button class="btn small primary" data-trip-action="pay" data-to="'+x.to+'" data-amount="'+x.amount+'">I paid</button>':'')+'</div>').join('');
 const expenses=(s.expenses||[]).map(e=>'<div class="gt-row"><div><b>'+esc(e.description)+'</b><small>'+esc(memberName(s,e.payer_member_id))+' paid · split '+(e.split_member_ids||[]).length+' ways</small></div><strong>'+money(e.amount_paise)+'</strong></div>').join('')||'<p class="muted">No expenses yet. Add the first one below.</p>';
 const people=s.members.map(m=>'<span class="gt-person">'+esc(m.display_name)+(m.is_owner?' · creator':'')+'</span>').join('');
 const link=location.origin+location.pathname+'?trip='+encodeURIComponent(code);
 return '<section class="card gt-card" id="group-trip-root"><div class="gt-head"><div><span class="eyebrow">SHARED TRIP LEDGER</span><h2>'+esc(s.trip.title)+'</h2><p class="muted">Add every payment as it happens. One calculates who pays whom.</p></div><span class="tag '+(s.trip.status==='active'?'green':'amber')+'">'+(s.trip.status==='active'?'Active':'Closed')+'</span></div><div class="gt-stats"><div><small>Total expenses</small><b>'+money(total)+'</b></div><div><small>Members</small><b>'+s.members.length+'</b></div><div><small>Suggested transfers</small><b>'+calc.moves.length+'</b></div></div><div class="gt-section"><div class="gt-label">Invite your group</div><div class="gt-share"><input readonly value="'+esc(link)+'" id="gt-invite-link"><button class="btn primary" data-trip-action="copy">Copy link</button></div><small class="muted">Guests can join without a One account. Keep this invite link within your group.</small></div><div class="gt-section"><div class="gt-label">Members</div><div class="gt-people">'+people+'</div></div>'+(s.trip.status==='active'?'<form class="gt-form" id="gt-expense-form"><h3>Add an expense</h3><div class="gt-grid"><label>Description<input name="description" required maxlength="100" placeholder="Hotel, fuel, food…"></label><label>Amount (₹)<input name="amount" type="number" min="0.01" max="10000000" step="0.01" required placeholder="1200"></label></div><label>Paid by<select name="payer">'+memberOptions(s,me.id)+'</select></label><div class="gt-label">Split between</div><div class="gt-checks">'+s.members.map(m=>'<label><input type="checkbox" name="split" value="'+m.id+'" checked><span>'+esc(m.display_name)+'</span></label>').join('')+'</div><button class="btn primary" type="submit">Add to trip ledger</button></form>':'<p class="muted">This trip is closed. Expenses can no longer be added.</p>')+'<div class="gt-section"><div class="gt-label">Expense history</div>'+expenses+'</div><div class="gt-section"><div class="gt-label">Settlement plan</div><p class="muted">Minimum transfers based on all expenses and receiver-confirmed payments.</p>'+(moves||'<p class="tag green">Everyone is settled</p>')+'</div><div class="gt-section"><div class="gt-label">Payment confirmations</div>'+(transfers||'<p class="muted">No transfers recorded yet.</p>')+'</div>'+(owner&&s.trip.status==='active'?'<button class="btn" data-trip-action="close">Close trip and lock expenses</button>':'')+'</section>';
}
function render(){
 const code=invite();if(!code)return '<section class="card gt-card"><div class="gt-head"><div><span class="eyebrow">TRAVEL TOGETHER</span><h2>Group Trip</h2><p class="muted">One shared link for the whole trip. Everyone adds what they paid; One works out the fairest settlement.</p></div><span class="gt-icon">↗</span></div><form id="gt-create-form" class="gt-form"><h3>Create a trip</h3><label>Trip name<input name="title" required maxlength="80" placeholder="Manali weekend"></label><label>Your name<input name="name" required maxlength="60" placeholder="Your name"></label><div class="gt-grid"><label>UPI ID (optional)<input name="upi" maxlength="100" placeholder="name@upi"></label><label>UPI phone (optional)<input name="phone" maxlength="20" placeholder="98xxxxxxxx"></label></div><button class="btn primary" type="submit">Create trip & get invite link</button><small class="muted">Creating a trip requires your One account. Friends join using the link without signing up.</small></form><div class="gt-divider"></div><div class="gt-section"><b>Already have an invite?</b><p class="muted">Open the trip link shared by your friend to join with your name and UPI details.</p></div></section>';
 const token=getToken(code);
 if(!token)return '<section class="card gt-card"><span class="eyebrow">YOU’RE INVITED</span><h2>Join this group trip</h2><p class="muted">Enter your name and optional UPI details. No One account required.</p><form id="gt-join-form" class="gt-form"><label>Your name<input name="name" required maxlength="60" placeholder="Your name"></label><div class="gt-grid"><label>UPI ID<input name="upi" maxlength="100" placeholder="name@upi"></label><label>UPI phone<input name="phone" maxlength="20" placeholder="98xxxxxxxx"></label></div><label>UPI QR image (optional)<input name="qr" type="file" accept="image/png,image/jpeg,image/webp"></label><button class="btn primary" type="submit">Join trip</button></form></section>';
 if(!state||state.code!==code)return '<section class="card gt-card"><p class="muted">Loading your shared trip…</p></section>';
 return dashboard(state,code);
}
async function load(){const code=invite(),token=getToken(code);if(!code||!token)return;try{state=await rpc('one_trip_get',{p_invite_code:code,p_member_token:token});state.code=code;error='';}catch(e){error=e.message||'Could not load trip';state=null;}}
function notify(msg){const el=document.getElementById('toast');if(el){el.textContent=msg;el.classList.add('show');setTimeout(()=>el.classList.remove('show'),2600)}else alert(msg)}
async function handleSubmit(e){
 const form=e.target;if(!['gt-create-form','gt-join-form','gt-expense-form'].includes(form.id))return;e.preventDefault();if(loading)return;loading=true;
 try{
  const fd=new FormData(form),code=invite();
  if(form.id==='gt-create-form'){
   const token=randomToken(),auth=await client().auth.getUser();if(!auth.data.user)throw new Error('Sign in to One before creating a trip');
   const result=await rpc('one_trip_create',{p_title:fd.get('title'),p_name:fd.get('name'),p_upi_id:fd.get('upi')||null,p_upi_phone:fd.get('phone')||null,p_qr_data:null,p_member_token:token});
   setToken(result.invite_code,result.member_token);const url=new URL(location.href);url.searchParams.set('trip',result.invite_code);history.pushState({},'',url);await load();window.render?.();const root=document.getElementById('page-content');if(root)root.innerHTML=window.OneGroupTrips.render();notify('Trip created. Share the invite link with your group.');
  }else if(form.id==='gt-join-form'){
   const token=randomToken(),file=fd.get('qr');let qr=null;if(file&&file.size){if(file.size>250000)throw new Error('QR image must be under 250 KB');qr=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(file)})}
   const result=await rpc('one_trip_join',{p_invite_code:code,p_name:fd.get('name'),p_upi_id:fd.get('upi')||null,p_upi_phone:fd.get('phone')||null,p_qr_data:qr,p_member_token:token});setToken(code,result.member_token);await load();const root=document.getElementById('page-content');if(root)root.innerHTML=window.OneGroupTrips.render();notify('You joined the trip.');
  }else{
   const ids=fd.getAll('split').map(String);if(!ids.length)throw new Error('Select at least one person to split this expense');
   const paise=Math.round(Number(fd.get('amount'))*100);if(!Number.isSafeInteger(paise)||paise<=0)throw new Error('Enter a valid amount');
   await rpc('one_trip_add_expense',{p_invite_code:code,p_member_token:getToken(code),p_description:fd.get('description'),p_amount_paise:paise,p_split_member_ids:ids});
   await load();const root=document.getElementById('page-content');if(root)root.innerHTML=window.OneGroupTrips.render();notify('Expense added to the shared ledger.');
  }
 }catch(err){notify(err.message||'Something went wrong');}finally{loading=false;}
}
async function handleClick(e){
 const b=e.target.closest('[data-trip-action]');if(!b)return;const action=b.dataset.tripAction,code=invite(),token=getToken(code);
 try{
  if(action==='copy'){await navigator.clipboard.writeText(document.getElementById('gt-invite-link')?.value||'');notify('Invite link copied');return}
  if(action==='close'){if(!confirm('Close this trip? No new expenses can be added.'))return;await rpc('one_trip_close',{p_invite_code:code,p_member_token:token});}
  if(action==='pay'){const upi=state.members.find(m=>m.id===b.dataset.to);const amount=Number(b.dataset.amount);await rpc('one_trip_record_transfer',{p_invite_code:code,p_member_token:token,p_to_member_id:b.dataset.to,p_amount_paise:amount});if(upi?.upi_id){const url='upi://pay?pa='+encodeURIComponent(upi.upi_id)+'&am='+(amount/100).toFixed(2)+'&cu=INR';window.open(url,'_blank','noopener');}notify('Payment marked as sent. Ask the receiver to confirm.');}
  if(action==='confirm'){await rpc('one_trip_confirm_transfer',{p_invite_code:code,p_member_token:token,p_transfer_id:b.dataset.id});notify('Payment confirmed as received.');}
  await load();const root=document.getElementById('page-content');if(root)root.innerHTML=window.OneGroupTrips.render();
 }catch(err){notify(err.message||'Action failed')}
}
document.addEventListener('submit',handleSubmit);document.addEventListener('click',handleClick);
window.OneGroupTrips={render,refresh:async()=>{await load();const root=document.getElementById('page-content');if(root&&invite())root.innerHTML=render();}};
document.addEventListener('DOMContentLoaded',()=>{if(invite()){const nav=document.querySelector('[data-page="expenses"]');if(nav){window.moneyTab='split';nav.click();setTimeout(()=>{const tab=document.querySelector('[data-money-tab="split"]');if(tab)tab.click();window.OneGroupTrips.refresh()},80)}}});
window.addEventListener('popstate',()=>{state=null;window.OneGroupTrips.refresh()});
const style=document.createElement('style');style.textContent=`.gt-card{margin:18px 0;padding:22px;border-radius:20px}.gt-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.gt-head h2{font-size:22px;margin:0 0 7px}.gt-icon{font-size:28px}.gt-form{display:grid;gap:13px;margin-top:20px}.gt-form label{display:grid;gap:6px;font-size:12px;font-weight:650;color:var(--ink,#17243a)}.gt-form input,.gt-form select{width:100%;min-width:0;padding:11px 12px;border:1px solid var(--line,#e7ebf1);border-radius:10px;background:var(--surface,#fff);color:inherit}.gt-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.gt-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.gt-stats>div{background:var(--bg,#f7f9fc);padding:14px;border-radius:12px;display:grid;gap:5px}.gt-stats small,.gt-row small{color:var(--muted,#7a879a);font-size:11px}.gt-stats b{font-size:19px}.gt-section{margin-top:20px}.gt-label{font-size:12px;font-weight:800;margin-bottom:10px}.gt-share{display:flex;gap:8px}.gt-share input{flex:1;min-width:0;padding:10px;border:1px solid var(--line);border-radius:9px}.gt-people,.gt-checks{display:flex;gap:8px;flex-wrap:wrap}.gt-person{padding:7px 10px;border-radius:30px;background:var(--bg,#f7f9fc);font-size:11px}.gt-checks label{display:flex;align-items:center;gap:6px;padding:8px 10px;border:1px solid var(--line);border-radius:9px}.gt-checks input{width:auto}.gt-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line,#e7ebf1)}.gt-row>div{display:grid;gap:4px;min-width:0}.gt-row strong{white-space:nowrap}.gt-divider{height:1px;background:var(--line);margin:20px 0}.gt-card .muted{font-size:12px;line-height:1.5}@media(max-width:600px){.gt-card{padding:16px}.gt-grid{grid-template-columns:1fr}.gt-stats b{font-size:15px}.gt-share{flex-wrap:wrap}.gt-share input{width:100%;flex-basis:100%}.gt-row{align-items:flex-start}}`;document.head.appendChild(style);
})();