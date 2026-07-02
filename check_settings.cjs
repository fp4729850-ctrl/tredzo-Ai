const { createClient } = require('@supabase/supabase-js');
const client = createClient('https://outklmllxsdrbifhvvcm.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dGtsbWxseHNkcmJpZmh2dmNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTE0NDgsImV4cCI6MjA5ODEyNzQ0OH0.IsSDBrzib6qYC2jGq3fQx2wtx9J3SKgGdRszy6Y26IU');
async function run() {
  const { data } = await client.from('user_settings').select('*');
  console.log(data);
}
run();
