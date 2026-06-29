import { createClient } from "npm:@supabase/supabase-js";
import "npm:dotenv/config";

const sb = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY!);
async function run() {
  const { data } = await sb.from("user_settings").select("*");
  console.log("Settings:", data);
}
run();
