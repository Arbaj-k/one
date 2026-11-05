/* One account authentication. Guest/local workspace remains usable without signing in. */
(() => {
  'use strict';
  const URL = 'https://tcthrfpkydcmenxwajfg.supabase.co';
  const KEY = 'sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT';
  const REDIRECT = location.origin + location.pathname;
  let client = null, session = null, view = 'login';
  const $ = (s) => document.querySelector(s);
  const escapeHtml = (s='') => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function getClient() {
    if (client) return client;
    if (!window.supabase?.createClient) throw Error('Authentication service could not load. Guest mode is still available.');
    client = window.supabase.createClient(URL, KEY, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'one-auth-session-v1'}});
    return client;
  }
  function status(message, error=false) {
    const el=$('#one-auth-message'); if (!el) return;
    el.textContent=message||''; el.classList.toggle('error',!!error); el.hidden=!message;
  }
  function render() {
    const root=$('#one-auth-root'); if(!root)return;
    root.innerHTML = `<div class="one-auth-backdrop" role="dialog" aria-modal="true" aria-labelledby="one-auth-title">
      <section class="one-auth-card">
        <div class="one-auth-brand"><span class="one-auth-mark">✦</span><div><strong>One</strong><small>Your personal assistant</small></div></div>
        <button class="one-auth-close" type="button" aria-label="Close authentication">×</button>
        <div class="one-auth-kicker">YOUR SPACE, YOUR DATA</div>
        <h1 id="one-auth-title">${view==='signup'?'Create your account':view==='reset'?'Reset your password':view==='sent'?'Check your inbox':'Welcome back'}</h1>
        <p class="one-auth-sub">${view==='signup'?'Create a secure account to access One across devices.':view==='reset'?'We’ll email you a secure password reset link.':view==='sent'?'Follow the link in your email to continue.':'Sign in to your account or continue using One as a guest.'}</p>
        ${view==='sent'?'<p class="one-auth-note">If the email does not arrive, check spam or request another link.</p>':`
        ${view!=='reset'?'<button id="one-google" class="one-auth-google" type="button"><span class="google-g">G</span> Continue with Google</button><div class="one-auth-divider"><span>or continue with email</span></div>':''}
        <form id="one-auth-form" novalidate>
          ${view==='signup'?'<label>Full name<input name="name" autocomplete="name" maxlength="80" placeholder="Your name" required></label>':''}
          <label>Email address<input name="email" type="email" autocomplete="email" placeholder="you@example.com" required></label>
          ${view==='reset'?'':'<label>Password<div class="one-auth-password"><input name="password" type="password" autocomplete="'+(view==='signup'?'new-password':'current-password')+'" minlength="8" placeholder="At least 8 characters" required><button type="button" class="one-show-password" aria-label="Show password">Show</button></div></label>'}
          ${view==='login'?'<button type="button" id="one-forgot" class="one-auth-link">Forgot password?</button>':view==='reset'?'<label>New password<input name="password" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label>':''}
          <button class="one-auth-submit" type="submit">${view==='signup'?'Create account':view==='reset'?'Send reset link':'Log in'} <span>→</span></button>
        </form>`}
        <div id="one-auth-message" class="one-auth-message" role="status" aria-live="polite" hidden></div>
        <div class="one-auth-switch">${view==='login'?'New to One? <button id="one-switch" type="button">Create account</button>':view==='signup'?'Already have an account? <button id="one-switch" type="button">Log in</button>':view==='reset'?'<button id="one-switch" type="button">Back to log in</button>':'<button id="one-switch" type="button">Back to log in</button>'}</div>
        <button id="one-guest" class="one-auth-guest" type="button">Continue as guest · keep data on this device</button>
        <p class="one-auth-legal">Your local workspace remains available in guest mode. Cloud access is tied to your signed-in account.</p>
      </section></div>`;
    $('#one-auth-root').hidden=false;
    $('.one-auth-close').onclick=close;
    $('#one-guest').onclick=close;
    $('#one-switch')?.addEventListener('click',()=>{view=view==='login'?'signup':'login';render()});
    $('#one-forgot')?.addEventListener('click',()=>{view='reset';render()});
    $('.one-show-password')?.addEventListener('click',e=>{const input=$('[name=password]');input.type=input.type==='password'?'text':'password';e.currentTarget.textContent=input.type==='password'?'Show':'Hide'});
    $('#one-google')?.addEventListener('click',google);
    $('#one-auth-form')?.addEventListener('submit',submit);
  }
  function close(){const root=$('#one-auth-root');if(root)root.hidden=true;document.body.classList.remove('one-auth-open')}
  function open(next='login'){view=next;render();document.body.classList.add('one-auth-open')}
  async function submit(e){
    e.preventDefault();const form=new FormData(e.currentTarget),email=String(form.get('email')||'').trim(),password=String(form.get('password')||''),name=String(form.get('name')||'').trim();
    const submitButton=$('.one-auth-submit');if(submitButton)submitButton.disabled=true;status('Please wait…');
    try{
      const auth=getClient();
      if(view==='signup'){
        const {data,error}=await auth.auth.signUp({email,password,options:{emailRedirectTo:REDIRECT,data:{full_name:name}}});if(error)throw error;
        if(data.session){await upsertProfile(data.user,name);session=data.session;close();paintUser(data.user)}
        else{view='sent';render();status('Verification email sent. Verify your email before logging in.')}
      }else if(view==='login'){
        const {data,error}=await auth.auth.signInWithPassword({email,password});if(error)throw error;
        if(!data.user?.email_confirmed_at){await auth.auth.signOut();throw Error('Please verify your email using the link we sent you.')}
        session=data.session;await upsertProfile(data.user);close();paintUser(data.user);
      }else if(view==='reset'&&location.hash.includes('type=recovery')){
        const {error}=await auth.auth.updateUser({password});if(error)throw error;
        history.replaceState(null,'',location.pathname+location.search);view='login';render();status('Password updated. You can now log in.');
      }else{
        const {error}=await auth.auth.resetPasswordForEmail(email,{redirectTo:REDIRECT});if(error)throw error;
        view='sent';render();status('Password reset email sent. Open the link to set a new password.');
      }
    }catch(err){status(err.message||'Authentication failed. Please try again.',true)}
    finally{if($('.one-auth-submit'))$('.one-auth-submit').disabled=false}
  }
  async function google(){try{status('Opening Google…');const {error}=await getClient().auth.signInWithOAuth({provider:'google',options:{redirectTo:REDIRECT}});if(error)throw error}catch(err){status(err.message||'Google sign-in failed.',true)}}
  async function upsertProfile(user,name=''){
    if(!user)return;
    const profile={id:user.id,display_name:name||user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split('@')[0]||'One user',avatar_url:user.user_metadata?.avatar_url||user.user_metadata?.picture||null,updated_at:new Date().toISOString()};
    const {error}=await getClient().from('user_profiles').upsert(profile,{onConflict:'id'});if(error)console.warn('Profile sync unavailable; auth remains active.',error.message);
  }
  function paintUser(user){
    const signIn=$('#one-signin');if(signIn)signIn.hidden=true;
    const top=$('.topbar-right');
    if(top&&!$('#one-account-menu')){
      const menu=document.createElement('div');menu.id='one-account-menu';menu.className='one-account-menu';
      menu.innerHTML='<button type="button" id="one-account-trigger" class="one-profile-trigger" aria-label="Open profile menu" aria-haspopup="true" aria-expanded="false"><span class="one-profile-avatar">O</span></button><div id="one-account-pop" hidden><div class="one-profile-heading"><span class="one-profile-avatar">O</span><div><strong class="one-profile-name">Account</strong><small class="one-profile-email"></small></div></div><p id="one-update-message" class="one-update-message" hidden>A new version of One is available.</p><button id="one-update-now" type="button" hidden>Update Now</button><button id="one-logout" type="button">Log out</button></div>';
      top.append(menu);
      $('#one-account-trigger').onclick=()=>{const pop=$('#one-account-pop'),trigger=$('#one-account-trigger');pop.hidden=!pop.hidden;trigger.setAttribute('aria-expanded',String(!pop.hidden));};
      $('#one-logout').onclick=logout;
      window.addEventListener('one:pwa-update-ready',()=>{const msg=$('#one-update-message'),btn=$('#one-update-now');if(msg)msg.hidden=false;if(btn)btn.hidden=false;});
      $('#one-update-now').onclick=()=>{const btn=$('#one-update-now');if(btn){btn.disabled=true;btn.textContent='Updating…'}window.OnePWAUpdate?.apply();};
      document.addEventListener('click',e=>{const root=$('#one-account-menu');if(root&&!root.contains(e.target)){const pop=$('#one-account-pop');if(pop)pop.hidden=true;$('#one-account-trigger')?.setAttribute('aria-expanded','false')}});
    }
    const name=user.user_metadata?.full_name||user.user_metadata?.name||user.email?.split('@')[0]||'Account';
    const initial=name.trim().slice(0,1).toUpperCase()||'O';
    const menu=$('#one-account-menu');
    if(menu){menu.querySelectorAll('.one-profile-avatar').forEach(el=>el.textContent=initial);menu.querySelector('.one-profile-name').textContent=name;menu.querySelector('.one-profile-email').textContent=user.email||'Signed in';}
    const statusEl=$('#cloud-status');if(statusEl)statusEl.textContent='Signed in';
  }
  async function logout(){try{const {error}=await getClient().auth.signOut();if(error)throw error;session=null;$('#one-account-menu')?.remove();const signIn=$('#one-signin');if(signIn)signIn.hidden=false;const s=$('#cloud-status');if(s)s.textContent='Offline · Local data';}catch(err){console.error(err);status(err.message||'Could not log out.',true)}}
  async function boot(){
    try{const auth=getClient();const {data,error}=await auth.auth.getSession();if(error)throw error;session=data.session;
      auth.auth.onAuthStateChange((event,next)=>{session=next;if(next?.user){paintUser(next.user);if(event==='SIGNED_IN')upsertProfile(next.user)}else if(event==='SIGNED_OUT'){$('#one-account-menu')?.remove();const signIn=$('#one-signin');if(signIn)signIn.hidden=false;}});
      if(session?.user){paintUser(session.user);await upsertProfile(session.user)}
      $('#one-signin')?.addEventListener('click',()=>open('login'));const params=new URLSearchParams(location.search);if(params.get('auth')==='login')open('login');
      if(location.hash.includes('type=recovery')){open('reset');status('Choose a new password.');}
    }catch(err){console.warn('One auth unavailable; local guest mode remains enabled.',err.message);const statusEl=$('#cloud-status');if(statusEl)statusEl.textContent='Local mode'}
  }
  window.OneAuth={open,logout,getSession:()=>session};
  document.addEventListener('DOMContentLoaded',boot);
})();