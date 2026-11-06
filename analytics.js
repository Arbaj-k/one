/* One privacy-conscious usage analytics */
(() => {
  'use strict';
  const URL='https://tcthrfpkydcmenxwajfg.supabase.co';
  const KEY='sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2AJT';
  const VISITOR_KEY='one-analytics-visitor-v1';
  const allowedPages=new Set(['overview','ask','memory','knowledge','planner','study','projects','expenses','backup']);
  const allowedEvents=new Set(['page_view','ask_one_message','task_created','note_created','project_created','expense_created','document_uploaded','memory_created']);
  let client=null,visitorId=null,lastPage='';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function getClient(){if(!client){if(!window.supabase?.createClient)throw Error('Analytics service unavailable');client=window.supabase.createClient(URL,KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'one-auth-session-v1'}})}return client}
  function getVisitor(){if(visitorId)return visitorId;try{visitorId=localStorage.getItem(VISITOR_KEY);if(!visitorId){visitorId=crypto.randomUUID();localStorage.setItem(VISITOR_KEY,visitorId)}}catch(_){visitorId=crypto.randomUUID()}return visitorId}
  async function trackEvent(eventName,pageKey){if(!allowedEvents.has(eventName))return;try{const {error}=await getClient().from('one_analytics_events').insert({visitor_id:getVisitor(),event_name:eventName,page_key:allowedPages.has(pageKey)?pageKey:'overview'});if(error)console.warn('Usage analytics event was not recorded:',error.message)}catch(error){console.info('Usage analytics unavailable; app remains usable.',error)}}
  function trackPage(page){if(!allowedPages.has(page)||lastPage===page)return;lastPage=page;trackEvent('page_view',page)}
  async function isAdmin(){try{const {data,error}=await getClient().auth.getSession();if(error)throw error;return data.session?.user?.app_metadata?.analytics_admin===true}catch(_){return false}}
  async function dashboardHTML(){
    if(!(await isAdmin()))return '<section class="card"><h2>Access restricted</h2><p class="muted">Usage analytics is available only to the One analytics administrator.</p></section>';
    return '<section class="one-analytics"><div class="row"><div><div class="eyebrow">PRODUCT INSIGHTS</div><h1>Usage analytics</h1><p class="subtitle">Anonymous usage totals. Message contents, notes and financial records are never collected.</p></div><select id="one-analytics-days" class="search" aria-label="Date range"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option></select></div><div id="one-analytics-results" class="card"><p class="muted">Loading analytics…</p></div></section>';
  }
  async function loadDashboard(days=30){
    const root=document.querySelector('#one-analytics-results');if(!root)return;
    if(!(await isAdmin())){root.innerHTML='<p>Access restricted.</p>';return}
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