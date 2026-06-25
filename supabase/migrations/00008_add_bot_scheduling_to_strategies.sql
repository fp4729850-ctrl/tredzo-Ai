-- Track last bot execution per strategy
ALTER TABLE strategies ADD COLUMN last_executed_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE strategies ADD COLUMN last_signal TEXT DEFAULT NULL;

-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule bot-runner every minute via pg_cron → calls our Edge Function
SELECT cron.schedule(
  'bot-runner-every-minute',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/bot-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    ),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);