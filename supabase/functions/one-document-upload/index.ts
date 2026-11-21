import { createClient } from "npm:@supabase/supabase-js@2.57.4";
const ORIGINS=new Set(["https://arbaj-k.github.io","https://one-7na.pages.dev"]);
const cors=(r:Request)=>{const o=r.headers.get("Origin")||"";const h:Record<string,string>={"Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Vary":"Origin"};if(ORIGINS.has(o))h["Access-Control-Allow-Origin"]=o;return h};
const reply=(r:Request,d:unknown,s=200)=>new Response(JSON.stringify(d),{status:s,headers:{...cors(r),"Content-Type":"application/json","Cache-Control":"no-store"}});
const text=(v:unknown,n=500)=>typeof v==="string"?v.slice(0,n):"";
function signature(bytes:Uint8Array,mime:string){
 if(mime==="application/pdf")return new TextDecoder().decode(bytes.slice(0,8)).startsWith("%PDF-");
 if(mime==="image/jpeg")return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
 if(mime==="image/png")return [137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v);
 if(mime==="image/webp")return new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
 if(mime==="image/heic"||mime==="image/heif"){const brand=new TextDecoder().decode(bytes.slice(8,16));return new TextDecoder().decode(bytes.slice(4,8))==="ftyp"&&/hei[cfx]|mif1|msf1/i.test(brand)}
 return false;
}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS"){const o=req.headers.get("Origin")||"";if(o&&!ORIGINS.has(o))return new Response("Forbidden",{status:403});return new Response("ok",{headers:cors(req)})}
 if(req.method!=="POST")return reply(req,{error:"POST required"},405);
 try{
  const len=Number(req.headers.get("content-length")||0);if(len>20000)return reply(req,{error:"Request too large"},413);
  const token=(req.headers.get("Authorization")||"").match(/^Bearer\\s+(.+)$/i)?.[1];if(!token)return reply(req,{error:"Sign in to upload documents"},401);
  const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");if(!url||!anon||!service)return reply(req,{error:"Upload service unavailable"},503);
  const auth=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}}),{data:u,error:ue}=await auth.auth.getUser(token);if(ue||!u.user)return reply(req,{error:"Session expired. Sign in again."},401);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}}),uid=u.user.id;
  const body=await req.json(),stage=text(body.storage_path,500),id=text(body.document_id,100),name=text(body.file_name,255),mime=text(body.mime_type,80).toLowerCase(),size=Number(body.byte_size);
  if(!/^[a-zA-Z0-9_-]{8,100}$/.test(id)||!stage.startsWith(uid+"/pending/"+id+"/")||stage.split("/").length!==5)return reply(req,{error:"Invalid staging path"},400);
  if(!name||!["application/pdf","image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(mime)||!Number.isSafeInteger(size)||size<1||size>12582912)return reply(req,{error:"Invalid file details or file exceeds 12 MB"},400);
  const {data:allowed,error:limitError}=await admin.rpc("one_consume_rate_limit",{p_bucket_key:"document-upload:"+uid,p_limit:12,p_window_seconds:3600});if(limitError)return reply(req,{error:"Upload security check unavailable"},503);if(allowed!==true)return reply(req,{error:"Upload limit reached. Try again later."},429);
  const {data:staged,error:downloadError}=await admin.storage.from("one-document-staging").download(stage);if(downloadError||!staged)return reply(req,{error:"Staged file not found"},404);
  if(staged.size!==size||staged.size>12582912)return reply(req,{error:"Uploaded file size did not match the declared size"},400);
  const bytes=new Uint8Array(await staged.arrayBuffer());if(!signature(bytes,mime))return reply(req,{error:"File content does not match its declared type. Upload a genuine PDF or supported image."},415);
  const safeName=name.normalize("NFKC").replace(/[^\\p{L}\\p{N}._-]+/gu,"_").replace(/^\\.+/,"").slice(0,120)||"document";
  const finalPath=uid+"/"+id+"/"+safeName;
  const {error:upError}=await admin.storage.from("one-user-documents").upload(finalPath,new Blob([bytes],{type:mime}),{upsert:true,contentType:mime,cacheControl:"3600"});if(upError)throw upError;
  const metadata={workspace_doc_id:id,display_name:text(body.display_name,255)||name,type:text(body.document_type,40)||"file",ocr_status:text(body.ocr_status,40)||"pending",json_status:text(body.json_status,40)||"pending"};
  const {error:metaError}=await admin.from("user_documents").upsert({user_id:uid,storage_path:finalPath,file_name:name,mime_type:mime,byte_size:size,extracted_text:text(body.extracted_text,180000)||null,metadata},{onConflict:"storage_path"});if(metaError){await admin.storage.from("one-user-documents").remove([finalPath]);throw metaError}
  await admin.storage.from("one-document-staging").remove([stage]);
  return reply(req,{ok:true,storage_path:finalPath,byte_size:size});
 }catch(_e){console.warn("Document upload failed; server details redacted.");return reply(req,{error:"Document upload could not be verified or saved. Retry."},500)}
});