CREATE OR REPLACE FUNCTION proxy_webhook(payload jsonb, token text)
RETURNS void AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://outklmllxsdrbifhvvcm.supabase.co/functions/v1/tradingview-webhook?token=' || token,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := payload
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
