const fs = require('fs');
const content = fs.readFileSync('.env.local', 'utf-8');
const lines = content.split('\n');
const env = {};
for (const line of lines) {
  const match = line.match(/^([^=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    env[match[1].trim()] = val;
  }
}
console.log(env.VITE_SUPABASE_URL ? "URL OK" : "URL MISSING");
console.log(env.SUPABASE_SERVICE_ROLE_KEY ? "KEY OK" : "KEY MISSING");

const { createClient } = require('@supabase/supabase-js');
const client = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
client.from('signals').select('id, direction, status, reason, created_at').order('created_at', { ascending: false }).limit(5).then(res => {
  console.log("SIGNALS:");
  console.log(JSON.stringify(res.data, null, 2));
});
