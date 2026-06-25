-- Multi-symbol support per strategy (stores array of selected symbols)
ALTER TABLE strategies ADD COLUMN IF NOT EXISTS symbols TEXT[] DEFAULT NULL;