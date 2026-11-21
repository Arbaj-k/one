import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://one-7na.pages.dev",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply({ error: "POST required" }, 405);
  try {
    const declared=Number(req.headers.get("content-length")||0);if(declared>300000)return reply({error:"Request too large."},413);
    const auth = req.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token || token === auth) return reply({ error: "Sign in to One first." }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !anon || !service) return reply({ error: "Server configuration is incomplete." }, 500);

    const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return reply({ error: "Your One session has expired. Sign in again." }, 401);

    const raw=await req.text();if(raw.length>300000)return reply({error:"Request too large."},413);
    const body=JSON.parse(raw);
    if (!Array.isArray(body.transactions) || body.transactions.length < 1 || body.transactions.length > 50) {
      return reply({ error: "Send between 1 and 50 transactions." }, 400);
    }

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const {data:allowed,error:limitError}=await admin.rpc("one_consume_rate_limit",{p_bucket_key:"bank-sms:"+authData.user.id,p_limit:30,p_window_seconds:60});
    if(limitError)return reply({error:"Transaction sync security check unavailable."},503);
    if(allowed!==true)return reply({error:"Too many transaction sync requests. Wait a minute and retry."},429);
    const results = [];
    for (const item of body.transactions) {
      const amount = Number(item.amount);
      const direction = item.direction === "credit" ? "credit" : item.direction === "debit" ? "debit" : null;
      const at = new Date(item.transactionAt);
      const fingerprint = typeof item.fingerprint === "string" ? item.fingerprint : "";
      if (!direction || !Number.isFinite(amount) || amount <= 0 || amount > 10000000 ||
          !Number.isFinite(at.getTime()) || fingerprint.length < 32 || fingerprint.length > 128) {
        results.push({ accepted: false, error: "Invalid transaction ignored." });
        continue;
      }
      const { data, error } = await admin.rpc("ingest_bank_sms_transaction", {
        p_user_id: authData.user.id,
        p_fingerprint: fingerprint,
        p_upi_reference: String(item.upiReference || "").slice(0, 100),
        p_amount: amount,
        p_direction: direction,
        p_merchant: String(item.merchant || "UPI transaction").slice(0, 120),
        p_transaction_at: at.toISOString(),
        p_sms_sender: String(item.sender || "").slice(0, 40),
      });
      if (error) {
        console.warn("Bank SMS ingest failed; details redacted.");
        results.push({ accepted: false, error: "Could not save this transaction." });
      } else results.push({ accepted: true, ...data });
    }
    return reply({
      received: body.transactions.length,
      added: results.filter(x => x.accepted && x.inserted).length,
      duplicates: results.filter(x => x.accepted && x.duplicate).length,
      results,
    });
  } catch (error) {
    console.warn("Bank SMS sync failed; details redacted.");
    return reply({ error: "Could not sync transactions. Please try again." }, 500);
  }
});
