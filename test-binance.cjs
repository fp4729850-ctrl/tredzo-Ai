const { createClient } = require('@supabase/supabase-js');

async function test() {
  const url = 'https://outklmllxsdrbifhvvcm.supabase.co';
  const key = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91dGtsbWxseHNkcmJpZmh2dmNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI1NTE0NDgsImV4cCI6MjA5ODEyNzQ0OH0.IsSDBrzib6qYC2jGq3fQx2wtx9J3SKgGdRszy6Y26IU';
  
  const client = createClient(url, key);
  try {
    const res = await fetch(`${url}/functions/v1/binance-trade`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'create-order',
        testnet: true,
        tradingMode: 'futures',
        symbol: 'SOLUSDT',
        side: 'BUY',
        type: 'MARKET',
        quantity: 0.1
      })
    });
    console.log("Status:", res.status);
    console.log("Body:", await res.text());
  } catch(e) {
    console.error(e);
  }
}
test();
