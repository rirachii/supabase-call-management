# Supabase Database Schema for Phone Call App

This document defines the complete database schema for a phone call app using Supabase, including tables, indexes, enums, triggers, and RLS policies.

## Table Definitions

### 1. `subscription_plans`

```sql
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    interval TEXT NOT NULL CHECK (interval IN ('monthly', 'yearly')),
    features JSONB,
    call_limit INTEGER,
    minutes_limit INTEGER,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_subscription_plans_interval ON public.subscription_plans(interval);
```

### 2. `user_profiles`

```sql
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id),
    first_name TEXT,
    last_name TEXT,
    phone_number TEXT,
    email TEXT,
    address JSONB,
    preferences JSONB,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'inactive',
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_user_profiles_status ON public.user_profiles(status);
```

### 3. `user_subscriptions`

```sql
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES public.subscription_plans(id),
    status TEXT NOT NULL CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')),
    stripe_sub_id TEXT,
    current_period_start TIMESTAMPTZ NOT NULL,
    current_period_end TIMESTAMPTZ NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    payment_method JSONB,
    subscription_id TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_user_subscriptions_user_id ON public.user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_plan_id ON public.user_subscriptions(plan_id);
CREATE INDEX idx_user_subscriptions_status ON public.user_subscriptions(status);
```

### 4. `user_call_usage`

```sql
CREATE TABLE IF NOT EXISTS public.user_call_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES public.user_subscriptions(id),
    billing_period_start TIMESTAMPTZ NOT NULL,
    billing_period_end TIMESTAMPTZ NOT NULL,
    calls_used INTEGER DEFAULT 0,
    minutes_used INTEGER DEFAULT 0,
    calls_remaining INTEGER,
    minutes_remaining INTEGER,
    last_updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_user_call_usage_user_id ON public.user_call_usage(user_id);
CREATE INDEX idx_user_call_usage_subscription_id ON public.user_call_usage(subscription_id);
CREATE INDEX idx_user_call_usage_billing_period ON public.user_call_usage(billing_period_start, billing_period_end);
```

### 5. `call_service_providers`

```sql
CREATE TABLE IF NOT EXISTS public.call_service_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    api_credentials JSONB,
    type TEXT NOT NULL,
    concurrency_limit INTEGER DEFAULT 5,
    priority INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Index
CREATE INDEX idx_call_service_providers_name ON public.call_service_providers(name);
```

### 6. `provider_phone_numbers`

```sql
CREATE TABLE IF NOT EXISTS public.provider_phone_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES public.call_service_providers(id) ON DELETE CASCADE,
    phone_id TEXT,
    country_code TEXT NOT NULL,
    area_code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    full_number TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    capabilities JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider_id, phone_id)
);

-- Indexes
CREATE INDEX idx_provider_phone_numbers_provider_id ON public.provider_phone_numbers(provider_id);
CREATE INDEX idx_provider_phone_numbers_is_active ON public.provider_phone_numbers(is_active);
CREATE INDEX idx_provider_phone_numbers_full_number ON public.provider_phone_numbers(full_number);
```

### 7. `user_phone_numbers`

```sql
CREATE TABLE IF NOT EXISTS public.user_phone_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES public.call_service_providers(id),
    phone_id TEXT,
    country_code TEXT NOT NULL,
    area_code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    full_number TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    is_default BOOLEAN DEFAULT FALSE,
    capabilities JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, full_number)
);

-- Indexes
CREATE INDEX idx_user_phone_numbers_user_id ON public.user_phone_numbers(user_id);
CREATE INDEX idx_user_phone_numbers_is_active ON public.user_phone_numbers(is_active);
CREATE INDEX idx_user_phone_numbers_is_default ON public.user_phone_numbers(is_default);
```

### 8. `voice_options`

```sql
CREATE TABLE IF NOT EXISTS public.voice_options (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES public.call_service_providers(id) ON DELETE CASCADE,
    voice_id TEXT NOT NULL,
    name TEXT NOT NULL,
    gender TEXT CHECK (gender IN ('male', 'female', 'neutral')),
    language TEXT NOT NULL,
    accent TEXT,
    description TEXT,
    sample_mp3_url TEXT,
    is_premium BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider_id, voice_id)
);

-- Indexes
CREATE INDEX idx_voice_options_provider_id ON public.voice_options(provider_id);
CREATE INDEX idx_voice_options_language ON public.voice_options(language);
CREATE INDEX idx_voice_options_is_active ON public.voice_options(is_active);
CREATE INDEX idx_voice_options_is_premium ON public.voice_options(is_premium);
```

### 9. `call_templates`

```sql
CREATE TABLE IF NOT EXISTS public.call_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    category TEXT,
    tags JSONB,
    is_public BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES auth.users(id),
    provider_id UUID REFERENCES public.call_service_providers(id),
    assistant_id UUID,
    voice_id UUID REFERENCES public.voice_options(id),
    params JSONB,
    params_order JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_call_templates_created_by ON public.call_templates(created_by);
CREATE INDEX idx_call_templates_is_public ON public.call_templates(is_public);
CREATE INDEX idx_call_templates_category ON public.call_templates(category);
CREATE INDEX idx_call_templates_provider_id ON public.call_templates(provider_id);
```

### 10. `call_queue`

```sql
CREATE TABLE IF NOT EXISTS public.call_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    recipient_number TEXT NOT NULL,
    caller_number_id UUID REFERENCES public.user_phone_numbers(id),
    scheduled_time TIMESTAMPTZ,
    status TEXT NOT NULL CHECK (status IN ('queued', 'in-progress', 'completed', 'failed', 'canceled')) DEFAULT 'queued',
    call_id TEXT,
    provider_id UUID REFERENCES public.call_service_providers(id),
    template_id UUID REFERENCES public.call_templates(id),
    voice_id UUID REFERENCES public.voice_options(id),
    custom_variables JSONB,
    retry_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_call_queue_user_id ON public.call_queue(user_id);
CREATE INDEX idx_call_queue_status ON public.call_queue(status);
CREATE INDEX idx_call_queue_scheduled_time ON public.call_queue(scheduled_time);
CREATE INDEX idx_call_queue_created_at ON public.call_queue(created_at);
```

### 11. `user_call_history`

```sql
CREATE TABLE IF NOT EXISTS public.user_call_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES auth.users(id),
    call_queue_id UUID REFERENCES public.call_queue(id),
    call_id TEXT,
    provider_id UUID REFERENCES public.call_service_providers(id),
    assistant_id UUID,
    phone_number_id UUID REFERENCES public.provider_phone_numbers(id),
    caller_number_id UUID REFERENCES public.user_phone_numbers(id),
    voice_id UUID REFERENCES public.voice_options(id),
    transcript TEXT,
    status TEXT NOT NULL CHECK (status IN ('completed', 'failed', 'canceled')),
    duration INTEGER DEFAULT 0, -- Duration in seconds
    recording_url TEXT,
    call_summary TEXT,
    call_data JSONB,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX idx_user_call_history_user_id ON public.user_call_history(user_id);
CREATE INDEX idx_user_call_history_call_queue_id ON public.user_call_history(call_queue_id);
CREATE INDEX idx_user_call_history_status ON public.user_call_history(status);
CREATE INDEX idx_user_call_history_created_at ON public.user_call_history(created_at);
```

## Triggers

### Auto-Update Triggers

```sql
-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to all tables with updated_at column
CREATE TRIGGER update_subscription_plans_timestamp
BEFORE UPDATE ON public.subscription_plans
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_user_profiles_timestamp
BEFORE UPDATE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_user_subscriptions_timestamp
BEFORE UPDATE ON public.user_subscriptions
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_call_service_providers_timestamp
BEFORE UPDATE ON public.call_service_providers
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_provider_phone_numbers_timestamp
BEFORE UPDATE ON public.provider_phone_numbers
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_user_phone_numbers_timestamp
BEFORE UPDATE ON public.user_phone_numbers
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_voice_options_timestamp
BEFORE UPDATE ON public.voice_options
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_call_templates_timestamp
BEFORE UPDATE ON public.call_templates
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

CREATE TRIGGER update_call_queue_timestamp
BEFORE UPDATE ON public.call_queue
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
```

### Call Duration Tracking Trigger

```sql
-- Function to update user call usage when a call is completed
CREATE OR REPLACE FUNCTION update_call_usage()
RETURNS TRIGGER AS $$
DECLARE
    user_usage_record UUID;
BEGIN
    -- Only process completed calls
    IF NEW.status = 'completed' THEN
        -- Find the current user usage record
        SELECT id INTO user_usage_record 
        FROM public.user_call_usage 
        WHERE user_id = NEW.user_id 
        AND NEW.created_at BETWEEN billing_period_start AND billing_period_end
        LIMIT 1;
        
        -- Update the usage
        IF FOUND THEN
            UPDATE public.user_call_usage 
            SET calls_used = calls_used + 1,
                minutes_used = minutes_used + CEIL(NEW.duration / 60.0),
                calls_remaining = GREATEST(0, calls_remaining - 1),
                minutes_remaining = GREATEST(0, minutes_remaining - CEIL(NEW.duration / 60.0)),
                last_updated = now()
            WHERE id = user_usage_record;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger to track call usage
CREATE TRIGGER track_call_usage
AFTER INSERT OR UPDATE ON public.user_call_history
FOR EACH ROW EXECUTE FUNCTION update_call_usage();
```

## RLS Policies

### 1. `user_profiles`

```sql
-- Enable RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own profile" 
  ON public.user_profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.user_profiles FOR UPDATE 
  USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" 
  ON public.user_profiles FOR INSERT 
  WITH CHECK (auth.uid() = id);

-- Admin policy
CREATE POLICY "Admin can access all profiles" 
  ON public.user_profiles
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 2. `subscription_plans`

```sql
-- Enable RLS
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Anyone can view subscription plans" 
  ON public.subscription_plans FOR SELECT 
  TO authenticated
  USING (true);

CREATE POLICY "Admin can manage subscription plans" 
  ON public.subscription_plans
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 3. `user_subscriptions`

```sql
-- Enable RLS
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own subscriptions" 
  ON public.user_subscriptions FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Admin can manage all subscriptions" 
  ON public.user_subscriptions
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 4. `user_call_usage`

```sql
-- Enable RLS
ALTER TABLE public.user_call_usage ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own call usage" 
  ON public.user_call_usage FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Admin can manage all call usage" 
  ON public.user_call_usage
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 5. `call_service_providers`

```sql
-- Enable RLS
ALTER TABLE public.call_service_providers ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view call providers" 
  ON public.call_service_providers FOR SELECT 
  TO authenticated
  USING (true);

CREATE POLICY "Admin can manage call providers" 
  ON public.call_service_providers
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 6. `provider_phone_numbers`

```sql
-- Enable RLS
ALTER TABLE public.provider_phone_numbers ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view provider phone numbers" 
  ON public.provider_phone_numbers FOR SELECT 
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admin can manage phone numbers" 
  ON public.provider_phone_numbers
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 7. `user_phone_numbers`

```sql
-- Enable RLS
ALTER TABLE public.user_phone_numbers ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own phone numbers" 
  ON public.user_phone_numbers FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own phone numbers" 
  ON public.user_phone_numbers FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own phone numbers" 
  ON public.user_phone_numbers FOR UPDATE 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own phone numbers" 
  ON public.user_phone_numbers FOR DELETE 
  USING (auth.uid() = user_id);

CREATE POLICY "Admin can manage all phone numbers" 
  ON public.user_phone_numbers
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 8. `voice_options`

```sql
-- Enable RLS
ALTER TABLE public.voice_options ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view available voices" 
  ON public.voice_options FOR SELECT 
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admin can manage voices" 
  ON public.voice_options
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 9. `call_templates`

```sql
-- Enable RLS
ALTER TABLE public.call_templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view public templates" 
  ON public.call_templates FOR SELECT 
  USING (is_public = true);

CREATE POLICY "Users can view own templates" 
  ON public.call_templates FOR SELECT 
  USING (auth.uid() = created_by);

CREATE POLICY "Users can create templates" 
  ON public.call_templates FOR INSERT 
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can update own templates" 
  ON public.call_templates FOR UPDATE 
  USING (auth.uid() = created_by);

CREATE POLICY "Users can delete own templates" 
  ON public.call_templates FOR DELETE 
  USING (auth.uid() = created_by);

CREATE POLICY "Admin can manage all templates" 
  ON public.call_templates
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 10. `call_queue`

```sql
-- Enable RLS
ALTER TABLE public.call_queue ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own call queue" 
  ON public.call_queue FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert into call queue" 
  ON public.call_queue FOR INSERT 
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own queued calls" 
  ON public.call_queue FOR UPDATE 
  USING (auth.uid() = user_id AND status = 'queued');

CREATE POLICY "Users can delete own queued calls" 
  ON public.call_queue FOR DELETE 
  USING (auth.uid() = user_id AND status = 'queued');

CREATE POLICY "Admin can manage all call queue entries" 
  ON public.call_queue
  USING (auth.jwt() ->> 'role' = 'admin');
```

### 11. `user_call_history`

```sql
-- Enable RLS
ALTER TABLE public.user_call_history ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Users can view own call history" 
  ON public.user_call_history FOR SELECT 
  USING (auth.uid() = user_id);

CREATE POLICY "Admin can manage all call history" 
  ON public.user_call_history
  USING (auth.jwt() ->> 'role' = 'admin');
```

## Sample Data (Subscription Plans)

```sql
-- Insert four subscription tiers
INSERT INTO public.subscription_plans (name, description, price, interval, features, call_limit, minutes_limit)
VALUES 
('Free', 'Basic access with limited features', 0.00, 'monthly', 
  '["5 calls per month", "3 minutes per call", "Basic templates"]'::jsonb, 5, 15),
  
('Basic', 'Perfect for personal use', 9.99, 'monthly', 
  '["20 calls per month", "5 minutes per call", "All templates", "Call scheduling"]'::jsonb, 20, 100),
  
('Business', 'Ideal for small businesses', 29.99, 'monthly', 
  '["100 calls per month", "10 minutes per call", "All templates", "Call scheduling", "Custom caller ID", "Priority support"]'::jsonb, 100, 1000),
  
('Enterprise', 'For large organizations with high volume needs', 99.99, 'monthly', 
  '["Unlimited calls", "Unlimited minutes", "All features", "Dedicated support", "API access", "Custom integrations"]'::jsonb, NULL, NULL);
```