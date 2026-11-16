/* One privacy-conscious usage analytics */
(() => {
  'use strict';
  const URL='https://tcthrfpkydcmenxwajfg.supabase.co';
  const KEY='sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT';
  const VISITOR_KEY='one-analytics-visitor-v1';
  const allowedPages=new Set(['overview','ask','memory','knowledge','planner','study','projects','expenses','backup','analytics']);
  const allowedEvents=new Set(['page_view','ask_one_message','task_created','note_created','project_created','expense_created','document_uploaded','memory_created']);
  let client=null,visitorId=null,lastPage='';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function getClient(){if(!client){if(typeof window.getOneSupabaseClient!=='function')throw Error('Shared Supabase client unavailable');client=window.getOneSupabaseClient()}return client}
  function getVisitor(){if(visitorId)return visitorId;try{visitorId=localStorage.getItem(VISITOR_KEY);if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem(VISITOR_KEY,visitorId)}}catch(_){visitorId=crypto.randomUUID()}return visitorId}
  async function trackEvent(eventName,pageKey='overview'){if(!allowedEvents.has(eventName))return;try{const {error}=await getClient().from('one_analytics_events').insert({visitor_id:getVisitor(),event_name:eventName,page_key:allowedPages.has(pageKey)?pageKey:'overview'});if(error)console.warn("Operation failed; diagnostic details redacted.")}catch(error){console.warn("Operation failed; diagnostic details redacted.")}}
  function trackPage(page){if(!allowedPages.has(page)||lastPage===page)return;lastPage=page;trackEvent('page_view',page)}
  async function isAdmin(){try{const {data,error}=await getClient().auth.getSession();if(error)throw error;return data.session?.user?.app_metadata?.analytics_admin===true}catch(_){return false}}
  function dashboardHTML(){
    return '<section class="one-analytics"><div class="row"><div><div class="eyebrow">PRODUCT INSIGHTS</div><h1>Usage analytics</h1><p class="subtitle">Anonymous usage totals. Message contents, notes and financial records are never collected.</p></div><select id="one-analytics-days" class="search" aria-label="Date range"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select></div><div id="one-analytics-results" class="card"><p class="muted">Loading analytics…</p></div></section>';
  }
  function getWorkspaceSnapshot(){
    try{const current=window.getOneWorkspaceData?.()||window.data;if(current&&typeof current==='object')return current}catch(_){}
    try{const ids=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key==='student-brain-data-v1-guest'||/^student-brain-data-v1-user-/.test(key))ids.push(key)}for(const key of ids.reverse()){try{const value=JSON.parse(localStorage.getItem(key)||'{}');if(value&&typeof value==='object')return value}catch(_){}}}catch(_){}
    return {};
  }
  function renderPersonalSummary(root){
    const d=getWorkspaceSnapshot(),tasks=Array.isArray(d.tasks)?d.tasks:[],notes=Array.isArray(d.notes)?d.notes:[],docs=Array.isArray(d.documents)?d.documents:[],expenses=Array.isArray(d.expenses)?d.expenses:[];
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
    const completed=tasks.filter(t=>t.done||t.completedAt).length,overdue=tasks.filter(t=>!t.done&&t.due&&t.due<today).length;
    const spending=expenses.reduce((sum,e)=>sum+Math.max(0,Number(e.amount)||0),0);
    const metric=(label,value,note)=>'<article class="card"><span class="stat-label">'+label+'</span><div class="stat-number">'+(typeof value==='number'?value.toLocaleString('en-IN'):value)+'</div><span class="stat-note">'+note+'</span></article>';
    root.innerHTML='<div class="eyebrow">YOUR WORKSPACE</div><h2>Personal Workspace Analysis</h2><p class="muted">A private summary calculated from data saved in this workspace. No admin permission is needed.</p><div class="grid stats one-analytics-stats">'+metric('Tasks completed',completed,'Completed tasks')+metric('Overdue tasks',overdue,'Open tasks past their due date')+metric('Notes',notes.length,'Saved notes')+metric('Uploaded documents',docs.length,'Files in your workspace')+metric('Total spending','₹'+spending.toLocaleString('en-IN'),'Recorded expense amounts')+'</div><p class="muted" style="font-size:11px;margin-top:14px">Personal insights are calculated on this device from your workspace records. Admin product analytics remain restricted to authorized administrators.</p>';
  }
  async function loadDashboard(days=30){
    const root=document.querySelector('#one-analytics-results');if(!root)return;
    if(!(await isAdmin())){renderPersonalSummary(root);return}
    try{
      const {data,error}=await getClient().rpc('get_one_analytics_summary',{p_days:Number(days)});
      if(error)throw error;
      const summary=data||{},types=summary.events_by_type||{},daily=summary.daily||[];
      const metric=(label,value,note)=>'<article class="card"><span class="stat-label">'+label+'</span><div class="stat-number">'+Number(value||0).toLocaleString('en-IN')+'</div><span class="stat-note">'+note+'</span></article>';
      const rows=[['Ask One messages','ask_one_message'],['Tasks created','task_created'],['Notes created','note_created'],['Projects created','project_created'],['Money entries','expense_created'],['Documents uploaded','document_uploaded'],['Memories created','memory_created']];
      root.innerHTML='<div class="grid stats one-analytics-stats">'+metric('Unique visitors',summary.unique_visitors,'Pseudonymous browser IDs')+metric('Page views',summary.page_views,'Total page visits')+metric('Ask One usage',summary.ask_one_messages,'Messages sent (count only)')+metric('Tracked events',summary.total_events,'All events in selected range')+'</div><h2>Feature activity</h2><div class="card"><div class="list">'+rows.map(([label,key])=>'<div class="list-item"><div class="list-copy"><b>'+label+'</b></div><strong>'+Number(types[key]||0).toLocaleString('en-IN')+'</strong></div>').join('')+'</div></div><h2 style="margin-top:24px">Daily visitors &amp; page views</h2><div class="card"><div class="list">'+(daily.length?daily.slice().reverse().map(day=>'<div class="list-item"><div class="list-copy"><b>'+esc(new Date(day.date+'T00:00:00').toLocaleDateString('en-IN',{day:'numeric',month:'short'}))+'</b><small>'+Number(day.visitors||0)+' visitors</small></div><strong>'+Number(day.page_views||0)+' views</strong></div>').join(''):'<p class="muted">No activity recorded yet. Analytics will appear as people use One.</p>')+'</div></div><p class="muted" style="font-size:11px;margin-top:14px">Visitors are counted by a random browser identifier. Clearing browser storage may count the same person as a new visitor. Totals exclude activity before analytics was enabled.</p>';
    }catch(error){root.innerHTML='<p class="muted">Could not load analytics: '+esc(error.message||'Unknown error')+'</p>'}
  }
  document.addEventListener('change',event=>{if(event.target.id==='one-analytics-days')loadDashboard(event.target.value)});
  document.addEventListener('click',event=>{const nav=event.target.closest('[data-page="analytics"]');if(nav)setTimeout(()=>loadDashboard(document.querySelector('#one-analytics-days')?.value||30),0)});
  async function refreshAdminNav(){const nav=document.querySelector('#one-analytics-nav');if(nav)nav.hidden=!(await isAdmin())}
  window.addEventListener('one:auth-changed',refreshAdminNav);
  document.addEventListener('DOMContentLoaded',()=>{refreshAdminNav();trackPage('overview')});
  window.OneAnalytics={trackEvent,trackPage,dashboardHTML,loadDashboard,refreshAdminNav};
})();