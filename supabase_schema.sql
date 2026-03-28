-- Copy and paste this entirely into your Supabase SQL Editor and hit "Run"

-- 1. Profiles Table (extends auth.users)
CREATE TABLE public.profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Turn on Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);

-- 2. Bots Table
CREATE TABLE public.bots (
  id TEXT NOT NULL PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  industry TEXT DEFAULT 'General',
  theme_color TEXT DEFAULT '#000000',
  system_prompt TEXT,
  openai_api_key TEXT,
  config JSONB DEFAULT '{}'::jsonb,
  domains JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
-- Owners can do everything
CREATE POLICY "Users can manage own bots" ON public.bots FOR ALL USING (auth.uid() = user_id);


-- 3. Messages Table (Chat Logs)
CREATE TABLE public.messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id TEXT REFERENCES public.bots(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
-- Owners can read messages for their bots
CREATE POLICY "Users can read their bot messages" ON public.messages FOR SELECT 
USING (auth.uid() IN (SELECT user_id FROM public.bots WHERE id = bot_id));
-- Anyone (the widget) can insert messages
CREATE POLICY "Public can insert messages" ON public.messages FOR INSERT WITH CHECK (true);


-- 4. Leads Table
CREATE TABLE public.leads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_id TEXT REFERENCES public.bots(id) ON DELETE CASCADE NOT NULL,
  session_id TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT DEFAULT 'chat',
  captured_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
-- Owners can read leads for their bots
CREATE POLICY "Users can read their bot leads" ON public.leads FOR SELECT 
USING (auth.uid() IN (SELECT user_id FROM public.bots WHERE id = bot_id));
-- Anyone (the widget) can insert leads
CREATE POLICY "Public can insert leads" ON public.leads FOR INSERT WITH CHECK (true);

-- Create an Auth trigger to insert into profiles automatically when users sign up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'name');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
