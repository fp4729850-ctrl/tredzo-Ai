ALTER TABLE "public"."user_settings"
ADD COLUMN IF NOT EXISTS "webhook_token" uuid DEFAULT gen_random_uuid();
