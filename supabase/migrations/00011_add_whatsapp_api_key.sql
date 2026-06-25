-- Add WhatsApp CallMeBot API Key column to user_settings
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS whatsapp_api_key TEXT DEFAULT NULL;
