const { createClient } = require('@supabase/supabase-js');
const client = createClient('https://outklmllxsdrbifhvvcm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dGtsbWxseHNkcmJpZmh2dmNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTE0NDgsImV4cCI6MjA5ODEyNzQ0OH0.IsSDBrzib6qYC2jGq3fQx2wtx9J3SKgGdRszy6Y26IU');
async function run() {
  const { data, error } = await client.from('signals').select('*').order('created_at', { ascending: false }).limit(20);
  if (error) {
    console.log("Error:", error);
    return;
  }
  for (const sig of data) {
    console.log(`[${sig.created_at}] ${sig.symbol} | ${sig.direction} | ${sig.status} | ${sig.reason}`);
  }
}
run();
