import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
// Note: anon key might fail RLS, let's just test if the query structure throws a relation error
sb.from('user_settings').select('*, strategies(*)').eq('webhook_token', 'e0aebd4b-ec0b-4f59-a244-df66e36f59c6').then(res => console.log(res));
