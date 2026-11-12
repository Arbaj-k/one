import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
let activeRequest: Request;
const ALLOWED_ORIGINS = new Set(["https://one-7na.pages.dev","https://arbaj-k.github.io"]);
function corsFor(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const headers: Record<string,string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-one-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...corsFor(activeRequest),"Content-Type":"application/json","Cache-Control":"no-store"}});
const url=Deno.env.get("SUPABASE_URL")!,anon=Deno.env.get("SUPABASE_ANON_KEY")!,service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
async function getPushConfig(){
 const {data,error}=await admin.from("one_push_server_config").select("vapid_public_key,vapid_private_key,vapid_subject,cron_secret").eq("id",true).maybeSingle();
 if(error)throw error;if(!data)throw new Error("Push server configuration is missing.");
 return data;
}
function configurePush(config:{vapid_public_key:string;vapid_private_key:string;vapid_subject:string;cron_secret:string}){
 if(!config.vapid_public_key||!config.vapid_private_key)throw new Error("VAPID keys are missing from the private server configuration.");
 webpush.setVapidDetails(config.vapid_subject,config.vapid_public_key,config.vapid_private_key);
}
async function sendToUser(userId:string,payload:Record<string,unknown>){
 const config=await getPushConfig();configurePush(config);
 const {data:rows,error}=await admin.from("one_push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id",userId);if(error)throw error;
 let sent=0,expired=0;for(const row of rows||[]){try{await webpush.sendNotification({endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}},JSON.stringify(payload));sent++;}catch(error){const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410){await admin.from("one_push_subscriptions").delete().eq("id",row.id);expired++;}else console.warn("Operation failed; diagnostic details redacted.");}}
 return {sent,expired};
}
Deno.serve(async(req:Request)=>{
 activeRequest = req;
 if(req.method==="OPTIONS")return new Response("ok",{headers:corsFor(req)});if(req.method!=="POST")return json({error:"POST required"},405);
 try{
  const body=await req.json().catch(()=>({}));
  if(body.action==="config"){const config=await getPushConfig();return json({publicKey:config.vapid_public_key,configured:Boolean(config.vapid_public_key&&config.vapid_private_key)});}
  if(body.action==="dispatch"){
   const config=await getPushConfig();if(!config.cron_secret||req.headers.get("x-one-cron-secret")!==config.cron_secret)return json({error:"Unauthorized dispatcher"},401);configurePush(config);
   const {data:workspaces,error}=await admin.from("user_workspaces").select("user_id,workspace_data");if(error)throw error;
   const now=new Date(),date=now.toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"}),hhmm=now.toLocaleTimeString("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false});let checked=0,sent=0;
   const localDate=(d:Date)=>new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit"}).format(d);
   const localMinute=(d:Date)=>new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",hour:"2-digit",minute:"2-digit",hour12:false}).format(d);
   const addLocalDays=(value:string,n:number)=>{const [y,m,d]=value.split("-").map(Number),x=new Date(Date.UTC(y,m-1,d+n));return x.toISOString().slice(0,10)};
   const occurs=(task:any,day:string)=>{if(!task.due||day<task.due)return false;const rule=task.repeatRule||"none";if(rule==="none")return day===task.due;const [y,m,d]=task.due.split("-").map(Number),[cy,cm,cd]=day.split("-").map(Number),delta=Math.round((Date.UTC(cy,cm-1,cd)-Date.UTC(y,m-1,d))/86400000);if(rule==="daily")return delta>=0;if(rule==="weekly")return delta>=0&&delta%7===0;if(rule==="monthly")return cd===Math.min(d,new Date(Date.UTC(cy,cm,0)).getUTCDate());return day===task.due};
   for(const workspace of workspaces||[]){const tasks=Array.isArray(workspace.workspace_data?.tasks)?workspace.workspace_data.tasks:[];for(const task of tasks){if(task.done||!task.id||!task.title||!task.due)continue;
    const lead=Math.max(0,Number(task.notifyBeforeMinutes)||0),dueTime=String(task.reminderTime||"09:00").slice(0,5),snooze=task.snoozedUntil?new Date(task.snoozedUntil):null;
    let occurrence="";for(const candidate of [date,addLocalDays(date,1)]){if(occurs(task,candidate)){const trigger=new Date(candidate+"T"+dueTime+":00+05:30");trigger.setMinutes(trigger.getMinutes()-lead);if(localDate(trigger)===date&&localMinute(trigger)<=hhmm){occurrence=candidate;break}}}
    let triggerTime:string;if(snooze&&Number.isFinite(snooze.getTime())){if(snooze.getTime()>now.getTime())continue;if(localDate(snooze)!==date)continue;triggerTime=localMinute(snooze);occurrence=occurrence||date;}else{if(!occurrence)continue;const trigger=new Date(occurrence+"T"+dueTime+":00+05:30");trigger.setMinutes(trigger.getMinutes()-lead);triggerTime=localMinute(trigger)}
    if(triggerTime>hhmm)continue;checked++;const key="task:"+task.id+":"+occurrence+":"+dueTime+":"+lead+(snooze?":"+snooze.toISOString():"");
    const {data:claim,error:claimError}=await admin.from("one_push_deliveries").insert({user_id:workspace.user_id,delivery_key:key,notification_type:"task"}).select("id").maybeSingle();if(claimError?.code==="23505")continue;if(claimError)throw claimError;if(!claim)continue;
    const note=(workspace.workspace_data?.notes||[]).find((n:any)=>n.id===task.relatedNoteId),doc=(workspace.workspace_data?.documents||[]).find((d:any)=>d.id===task.relatedDocumentId),linked=note?" · Note: "+(note.title||"Saved note"):doc?" · Document: "+(doc.name||"Saved document"):"";
    const result=await sendToUser(workspace.user_id,{title:"One · Task reminder",body:task.title+" · Due "+occurrence+" at "+dueTime+linked,tag:key,url:"./?open=task&id="+encodeURIComponent(task.id)});sent+=result.sent;if(result.sent){await admin.from("one_push_deliveries").update({sent_at:new Date().toISOString(),last_error:null}).eq("id",claim.id);}else{await admin.from("one_push_deliveries").delete().eq("id",claim.id);}
   }}
   // One daily digest at 09:00 Asia/Kolkata: include every unfinished dated task
   // plus explicit Reminder/Briefing items, so users don't have to ask Ask One again.
   if(hhmm>="09:00"){
    for(const workspace of workspaces||[]){
     const tasks=Array.isArray(workspace.workspace_data?.tasks)?workspace.workspace_data.tasks:[];
     const pending=tasks.filter((task:any)=>!task.done&&task.id&&task.title&&(
      Boolean(task.due)||["assignment","reminder","briefing"].includes(String(task.category||"").toLowerCase())
     ));
     if(!pending.length)continue;
     const digestKey="daily-pending-summary:"+date;
     const {data:claim,error:claimError}=await admin.from("one_push_deliveries").insert({user_id:workspace.user_id,delivery_key:digestKey,notification_type:"daily_digest"}).select("id").maybeSingle();
     if(claimError?.code==="23505")continue;if(claimError)throw claimError;if(!claim)continue;
     const sorted=pending.sort((a:any,b:any)=>String(a.due||"9999").localeCompare(String(b.due||"9999")));
     const preview=sorted.slice(0,5).map((task:any)=>String(task.title).trim()+(task.due?" ("+task.due+")":"")).join(" · ");
     const more=sorted.length>5?" · +"+(sorted.length-5)+" more":"";
     const result=await sendToUser(workspace.user_id,{title:"One · Your pending reminders",body:sorted.length+" pending item(s): "+preview+more,tag:digestKey,url:"./?open=tasks"});sent+=result.sent;if(result.sent){await admin.from("one_push_deliveries").update({sent_at:new Date().toISOString(),last_error:null}).eq("id",claim.id);}else{await admin.from("one_push_deliveries").delete().eq("id",claim.id);}
    }
   }
   return json({ok:true,checked,sent});
  }
  const jwt=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!jwt)return json({error:"Sign in required"},401);
  const authClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}});const {data:userData,error:userError}=await authClient.auth.getUser(jwt);if(userError||!userData.user)return json({error:"Invalid session"},401);const userId=userData.user.id;
  if(body.action==="subscribe"){const sub=body.subscription;if(!sub?.endpoint||!sub?.keys?.p256dh||!sub?.keys?.auth)return json({error:"Invalid push subscription"},400);
   const {error}=await admin.from("one_push_subscriptions").upsert({user_id:userId,endpoint:sub.endpoint,p256dh:sub.keys.p256dh,auth:sub.keys.auth,expiration_time:sub.expirationTime?new Date(sub.expirationTime).toISOString():null,user_agent:req.headers.get("user-agent")||null,updated_at:new Date().toISOString()},{onConflict:"user_id,endpoint"});if(error)throw error;return json({ok:true});}
  if(body.action==="unsubscribe"){const endpoint=String(body.endpoint||"");const {error}=await admin.from("one_push_subscriptions").delete().eq("user_id",userId).eq("endpoint",endpoint);if(error)throw error;return json({ok:true});}
  if(body.action==="test"){const result=await sendToUser(userId,{title:"One notifications are ready",body:"Your Android push notifications are connected.",tag:"one-push-test-"+Date.now(),url:"./?open=notifications"});return json({ok:true,...result});}
  return json({error:"Unknown action"},400);
 }catch(error){console.warn("Operation failed; diagnostic details redacted.");return json({error:"Push request failed. Check server logs for a redacted diagnostic."},500);}
});