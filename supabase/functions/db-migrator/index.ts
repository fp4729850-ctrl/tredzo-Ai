import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import postgres from "https://deno.land/x/postgresjs@v3.3.0/mod.js";

serve(async (req) => {
  try {
    const dbUrl = Deno.env.get('SUPABASE_DB_URL');
    if (!dbUrl) throw new Error("Missing DB URL");

    // Use URL encoding for '#' -> '%23'
    const newUrl = dbUrl.replace(/:[^:@]+@/, ':Santro2007%23123@');

    const sql = postgres(newUrl, {
      ssl: { rejectUnauthorized: false }
    });

    await sql`
      ALTER TABLE "public"."user_settings"
      ADD COLUMN IF NOT EXISTS "webhook_token" uuid DEFAULT gen_random_uuid();
    `;

    await sql`
      UPDATE "public"."user_settings"
      SET "webhook_token" = gen_random_uuid()
      WHERE "webhook_token" IS NULL;
    `;

    return new Response(JSON.stringify({ success: true }), { headers: { "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
