-- Fix: Add INSERT policy so authenticated users can create their own profile
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Also set default on id column so client doesn't need to send it explicitly
ALTER TABLE profiles ALTER COLUMN id SET DEFAULT auth.uid();