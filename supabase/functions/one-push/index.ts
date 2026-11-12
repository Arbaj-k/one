import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const cors={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type, x-one-cron-secret","Access-Control-Allow-Methods":"POST, OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json"}});
const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const publicKey=Deno.env.get("VAPID_PUBLIC_KEY")||"",privateKey=Deno.env.get("VAPID_PRIVATE_KEY")||"",subject=Deno.env.get("VAPID_SUBJECT")||"mailto:notifications@one.app";
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
function configurePush(){if(!publicKey||!privateKey)throw new Error("Push server is not configured. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY Edge Function secrets.");webpush.setVapidDetails(subject,publicKey,privateKey);}
async function sendToUser(userId:string,payload:Record<string,unknown>){
 configurePush();const {data:rows,error}=await admin.from("one_push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",userId);if(error)throw error;
 let sent=0,expired=0;for(const row of rows||[]){try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload));sent++;}catch(error){const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410){await admin.from("one_push_subscriptions").delete().eq("id",row.id);expired++;}else console.error("Push delivery failed",status,String(error));}}
 return {sent,expired};
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});if(req.method!=="POST")return json({error:"POST required"},405);
 try{
  const body=await req.json().catch(()=>({}));
  if(body.action==="config")return json({publicKey:publicKey||null,configured:Boolean(publicKey&&privateKey)});
  if(body.action==="dispatch"){
   const expected=Deno.env.get("ONE_PUSH_CRON_SECRET");if(!expected||req.headers.get("x-one-cron-secret")!==expected)return json({error:"Unauthorized dispatcher"},401);configurePush();
   const {data:workspaces,error}=await admin.from("user_workspaces").select("user_id,workspace_data");if(error)throw error;
   const now=new Date(),date=now.toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"}),hhmm=now.toLocaleTimeString("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false});let checked=0,sent=0;
   for(const workspace of workspaces||[]){const tasks=Array.isArray(workspace.workspace_data?.tasks)?workspace.workspace_data.tasks:[];for(const task of tasks){if(task.done||task.due!==date||!task.id||!task.title)continue;const dueTime=String(task.reminderTime||"09:00").slice(0,5);if(dueTime>hhmm)continue;checked++;const key="task:"+task.id+":"+date+":"+dueTime;
    const {data:claim,error:claimError}=await admin.from("one_push_deliveries").insert({user_id:workspace.user_id,delivery_key:key,notification_type:"task"}).select("id").maybeSingle();if(claimError?.code==="23505")continue;if(claimError)throw claimError;if(!claim)continue;
    const result=await sendToUser(workspace.user_id,{title:"One · Task reminder",body:task.title+" is due today at "+dueTime+".",tag:key,url:"./?open=task&id="+encodeURIComponent(task.id)});sent+=result.sent;if(result.sent){await admin.from("one_push_deliveries").update({sent_at:new Date().toISOString(),last_error:null}).eq("id",claim.id);}else{await admin.from("one_push_deliveries").delete().eq("id",claim.id);}
   }}
   return json({ok:true,checked,sent});
  }
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!jwt)return json({error:"Sign in required"},401);
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:userData,error:userError}=await authClient.auth.getUser(jwt);if(userError||!userData.user)return json({error:"Invalid session"},401);const userId=userData.user.id;
  if(body.action==="subscribe"){const sub=body.subscription;if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return json({error:"Invalid push subscription"},400);
   const {error}=await admin.from("one_push_subscriptions").upsert({user_id:userId,endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth,expiration_time:sub.expirationTime?new Date(sub.expirationTime).toISOString():null,user_agent:req.headers.get("user-agent")||null,updated_at:new Date().toISOString()},{onConflict:"user_id,endpoint"});if(error)throw error;return json({ok:true});}
  if(body.action==="unsubscribe"){const endpoint=String(body.endpoint||"");const {error}=await admin.from("one_push_subscriptions").delete().eq("user_id",userId).eq("endpoint",endpoint);if(error)throw error;return json({ok:true});}
  if(body.action==="test"){const result=await sendToUser(userId,{title:"One notifications are ready",body:"Your Android push notifications are connected.",tag:"one-push-test-"+Date.now(),url:"./?open=notifications"});return json({ok:true,...result});}
  return json({error:"Unknown action"},400);
 }catch(error){console.error("one-push error",error);return json({error:error instanceof Error?error.message:"Push request failed"},500);}
});