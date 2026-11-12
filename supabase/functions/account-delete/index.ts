import { createClient } from "npm:@supabase/supabase-js@2.57.4";

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsFor(req) });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return json({ error: "Account deletion is not configured." }, 503);

  const token = (req.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return json({ error: "Sign in again before deleting your account." }, 401);

  try {
    const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: authData, error: authError } = await authClient.auth.getUser(token);
    if (authError || !authData.user) return json({ error: "Your session is invalid. Sign in again." }, 401);

    const body = await req.json().catch(() => ({}));
    if (body?.confirmation !== "DELETE") return json({ error: "Explicit deletion confirmation is required." }, 400);

    const userId = authData.user.id;
    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

    // Remove private document objects recursively through the Storage API.
    const bucket = "one-user-documents";
    const removeFolder = async (folder: string): Promise<void> => {
      for (let offset = 0; ; offset += 100) {
        const { data: entries, error } = await admin.storage.from(bucket).list(folder, { limit: 100, offset });
        if (error) throw error;
        const files: string[] = [];
        for (const entry of entries || []) {
          const path = folder ? folder + "/" + entry.name : entry.name;
          if (entry.id) files.push(path);
          else await removeFolder(path);
        }
        if (files.length) {
          const { error: storageError } = await admin.storage.from(bucket).remove(files);
          if (storageError) throw storageError;
        }
        if (!entries || entries.length < 100) break;
      }
    };
    await removeFolder(userId);

    // Revoke active sessions before deleting the identity. Existing access tokens
    // must not remain usable after a destructive account action.
    const { error: revokeError } = await admin.auth.admin.signOut(token, "global");
    if (revokeError) throw revokeError;

    // This legacy table has a non-cascading auth.users FK; delete it explicitly.
    const { error: historyError } = await admin.from("whatsapp_processed_messages").delete().eq("user_id", userId);
    if (historyError) throw historyError;

    // Remove legacy profile tables if present; auth.users cascades the owner-bound records.
    for (const table of ["user_profiles", "profiles"]) {
      const { error } = await admin.from(table).delete().eq("id", userId);
      if (error && !/does not exist|schema cache/i.test(error.message || "")) throw error;
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return json({ ok: true });
  } catch (_error) {
    console.error("Account deletion failed; server details redacted.");
    return json({ error: "Account deletion could not be completed. Retry or contact support." }, 500);
  }
});
