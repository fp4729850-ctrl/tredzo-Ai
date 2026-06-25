-- Top-level symbol override on strategies (like timeframe)
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS symbol VARCHAR(20) DEFAULT NULL;

-- Telegram + WhatsApp notification settings
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS telegram_bot_token TEXT DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whatsapp_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS whatsapp_phone TEXT DEFAULT NULL;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT TRUE;