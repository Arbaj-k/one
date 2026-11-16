/* Shared Supabase client for One. Keep auth state in one storage namespace. */
(function(){
 'use strict';
 const SUPABASE_URL='https://tcthrfpkydcmenxwajfg.supabase.co';
 const SUPABASE_KEY='sb_publishable_-PlVhv38rbHYFqsfvJ42AQ_S6-2A7JT';
 let client=null;
 window.getOneSupabaseClient=function(){
  if(client)return client;
  if(!window.supabase?.createClient)throw new Error('Supabase client did not load.');
  client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'one-auth-session-v1'}});
  return client;
 };
})();
