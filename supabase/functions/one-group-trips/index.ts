import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
const cors=(req:Request)=>{const origin=req.headers.get("Origin")||"";const ok=new Set(["https://arbaj-k.github.io","https://one-7na.pages.dev"]);return {"Access-Control-Allow-Origin":ok.has(origin)?origin:"https://arbaj-k.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"}};
const json=(r:Request,d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors(r),"Content-Type":"application/json","Cache-Control":"no-store"}});
const txt=(v:unknown,n=200)=>typeof v==="string"?v.trim().slice(0,n):"";
const isUuid=(v:unknown)=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const hash=async(v:string)=>{const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v));return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")};
const qrData=(v:unknown)=>{const q=txt(v,400000);if(q&&!/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(q))throw new Error("Upload a valid PNG, JPG or WebP QR image");return q||null};
const makeToken=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(x=>x.toString(16).padStart(2,"0")).join("");
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors(req)});
 if(req.method!=="POST")return json(req,{error:"POST required"},405);
 try{
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!anon||!service)throw new Error("Group Trip server configuration missing");
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const b=await req.json(),action=txt(b?.action,40),code=txt(b?.invite_code,40);
  const bearer=(req.headers.get("Authorization")||"").match(/^Bearer\s+(.+)$/i)?.[1]||"";
  if(action==="create"){
   if(!bearer)throw new Error("Sign in to One to create a trip");
   const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:a,error:ae}=await auth.auth.getUser(bearer);
   if(ae||!a.user)throw new Error("Your One session has expired. Sign in again.");
   const title=txt(b.title,80),name=txt(b.name,60);if(title.length<2||!name)throw new Error("Enter a trip title and your name");
   const invite=crypto.randomUUID().replace(/-/g,"").slice(0,18),raw=makeToken();
   const {data:t,error:te}=await admin.from("one_trip_groups").insert({owner_id:a.user.id,title,invite_code:invite}).select("id,title,invite_code").single();if(te)throw te;
   const {data:m,error:me}=await admin.from("one_trip_members").insert({trip_id:t.id,display_name:name,upi_id:txt(b.upi_id,100)||null,upi_phone:txt(b.upi_phone,20)||null,upi_qr_data:qrData(b.upi_qr_data),token_hash:await hash(raw),is_owner:true}).select("id").single();if(me)throw me;
   return json(req,{trip_id:t.id,invite_code:t.invite_code,member_id:m.id,member_token:raw,title:t.title});
  }
  if(!code)throw new Error("Invite link is missing");
  const {data:trip,error:te}=await admin.from("one_trip_groups").select("*").eq("invite_code",code).maybeSingle();if(te||!trip)throw new Error("Trip not found");
  const tokenHash=txt(b.member_token,200)?await hash(txt(b.member_token,200)):"";
  const {data:actor}=tokenHash?await admin.from("one_trip_members").select("*").eq("trip_id",trip.id).eq("token_hash",tokenHash).maybeSingle():{data:null};
  const member=()=>{if(!actor)throw new Error("Trip member verification failed");return actor};
  const active=()=>{if(trip.status!=="active")throw new Error("This trip is closed");};
  if(action==="join"){
   active();const name=txt(b.name,60);if(!name)throw new Error("Enter your name");
   const raw=makeToken(),qr=qrData(b.upi_qr_data);
   const {data:m,error}=await admin.from("one_trip_members").insert({trip_id:trip.id,display_name:name,upi_id:txt(b.upi_id,100)||null,upi_phone:txt(b.upi_phone,20)||null,upi_qr_data:qr,token_hash:await hash(raw)}).select("id").single();
   if(error)throw new Error(error.code==="23505"?"That name is already in this trip. Add a unique name":error.message);
   return json(req,{trip_id:trip.id,invite_code:code,member_id:m.id,member_token:raw,title:trip.title});
  }
  const me=member();
  if(action==="get"){
   const [ms,es,xs]=await Promise.all([admin.from("one_trip_members").select("id,display_name,upi_id,upi_phone,upi_qr_data,is_owner,created_at").eq("trip_id",trip.id).order("created_at"),admin.from("one_trip_expenses").select("*").eq("trip_id",trip.id).order("created_at",{ascending:false}),admin.from("one_trip_transfers").select("*").eq("trip_id",trip.id).order("created_at",{ascending:false})]);
   for(const r of [ms,es,xs])if(r.error)throw r.error;
   return json(req,{trip,me:{id:me.id,display_name:me.display_name,is_owner:me.is_owner},members:ms.data,expenses:es.data,transfers:xs.data});
  }
  if(action==="profile"){active();const qr=qrData(b.upi_qr_data);const {error}=await admin.from("one_trip_members").update({upi_id:txt(b.upi_id,100)||null,upi_phone:txt(b.upi_phone,20)||null,upi_qr_data:qr}).eq("id",me.id).eq("trip_id",trip.id);if(error)throw error;return json(req,{success:true});}
  if(action==="expense"){
   active();const description=txt(b.description,100),amount=Number(b.amount_paise),ids=Array.isArray(b.split_member_ids)?[...new Set(b.split_member_ids.filter(isUuid))]:[],payer=isUuid(b.payer_member_id)?b.payer_member_id:me.id;
   if(!description||!Number.isSafeInteger(amount)||amount<=0||amount>1000000000||!ids.length||ids.length!==(b.split_member_ids||[]).length)throw new Error("Enter a valid expense and split");
   const wanted=[...new Set([...ids,payer])],{data:valid,error:ve}=await admin.from("one_trip_members").select("id").eq("trip_id",trip.id).in("id",wanted);if(ve)throw ve;if(new Set((valid||[]).map(x=>x.id)).size!==wanted.length)throw new Error("A selected member does not belong to this trip");
   const {data,error}=await admin.from("one_trip_expenses").insert({trip_id:trip.id,payer_member_id:payer,created_by_member_id:me.id,description,amount_paise:amount,split_member_ids:ids}).select("*").single();if(error)throw error;return json(req,{expense:data});
  }
  if(action==="transfer"){
   active();const to=b.to_member_id,amount=Number(b.amount_paise);if(!isUuid(to)||to===me.id||!Number.isSafeInteger(amount)||amount<=0)throw new Error("Invalid transfer");
   const {data:r}=await admin.from("one_trip_members").select("id").eq("id",to).eq("trip_id",trip.id).maybeSingle();if(!r)throw new Error("Receiver is not in this trip");
   const {data,error}=await admin.from("one_trip_transfers").insert({trip_id:trip.id,from_member_id:me.id,to_member_id:to,amount_paise:amount}).select("*").single();if(error)throw error;return json(req,{transfer:data});
  }
  if(action==="confirm"){
   const {data:x}=await admin.from("one_trip_transfers").select("*").eq("id",b.transfer_id).eq("trip_id",trip.id).maybeSingle();if(!x||x.to_member_id!==me.id)throw new Error("Only the receiving member can confirm this payment");
   if(x.status!=="confirmed"){const {error}=await admin.from("one_trip_transfers").update({status:"confirmed",confirmed_at:new Date().toISOString()}).eq("id",x.id).eq("to_member_id",me.id);if(error)throw error;}return json(req,{success:true});
  }
  if(action==="close"){if(!me.is_owner)throw new Error("Only the trip creator can close this trip");const {error}=await admin.from("one_trip_groups").update({status:"closed"}).eq("id",trip.id);if(error)throw error;return json(req,{success:true});}
  throw new Error("Unknown Group Trip action");
 }catch(e){return json(req,{error:e instanceof Error?e.message:"Request failed"},400)}
});