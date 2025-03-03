-- Enable UUID extension for generating unique IDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
-- This extends Supabase's auth.users table with additional profile information
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
    first_name TEXT,
    last_name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    company TEXT,
    job_title TEXT,
    timezone TEXT,
    profile_image_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Subscription plans table
-- Contains different subscription tiers
CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    interval TEXT NOT NULL,  -- 'monthly', 'yearly'
    features JSONB,          -- JSON array of features
    call_limit INTEGER,      -- Number of calls allowed per interval
    minutes_limit INTEGER,   -- Number of minutes allowed per interval
    active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User subscriptions table
-- Links users to their subscription plans
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL,  -- 'active', 'canceled', 'past_due', 'trialing'
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    payment_method JSONB,
    subscription_id TEXT,  -- External subscription ID (Stripe, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User call usage table
-- Tracks usage metrics for billing and limits
CREATE TABLE IF NOT EXISTS user_call_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES user_subscriptions(id),
    billing_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    billing_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    calls_used INTEGER DEFAULT 0,
    minutes_used INTEGER DEFAULT 0,
    calls_remaining INTEGER,
    minutes_remaining INTEGER,
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Call templates table
-- Stores call script templates for different scenarios
CREATE TABLE IF NOT EXISTS call_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    content TEXT NOT NULL,  -- The actual template/script
    category TEXT,          -- e.g., 'sales', 'support', 'onboarding'
    tags TEXT[],            -- Array of tags for better categorization
    is_public BOOLEAN DEFAULT FALSE,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User call history table
-- Records all calls made by users
CREATE TABLE IF NOT EXISTS call_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES call_templates(id),
    call_start TIMESTAMP WITH TIME ZONE NOT NULL,
    call_end TIMESTAMP WITH TIME ZONE,
    duration INTEGER,  -- Duration in seconds
    recipient_name TEXT,
    recipient_phone TEXT,
    recipient_email TEXT,
    notes TEXT,
    recording_url TEXT,
    transcript TEXT,
    call_status TEXT,  -- 'completed', 'missed', 'failed', 'canceled'
    metadata JSONB,    -- Any additional data about the call
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Call template favorites
-- Tracks which templates users have favorited for quick access
CREATE TABLE IF NOT EXISTS template_favorites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID NOT NULL REFERENCES call_templates(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, template_id)
);

-- Call feedback
-- Stores feedback for calls (either from the user or the recipient)
CREATE TABLE IF NOT EXISTS call_feedback (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    call_id UUID NOT NULL REFERENCES call_history(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL, -- 1-5 star rating
    feedback_text TEXT,
    feedback_source TEXT, -- 'user', 'recipient'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RLS policies for security
-- These policies control who can access what data

-- Users can only see and modify their own profiles
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_policy ON users
    USING (id = auth.uid())
    WITH CHECK (id = auth.uid());

-- Subscription plans are visible to all authenticated users
ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_plans_read_policy ON subscription_plans
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Users can only see their own subscriptions
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_subscriptions_policy ON user_subscriptions
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Users can only see their own usage data
ALTER TABLE user_call_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_call_usage_policy ON user_call_usage
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Call templates: Users can see public templates or ones they created
ALTER TABLE call_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_templates_read_policy ON call_templates
    FOR SELECT
    USING (is_public OR created_by = auth.uid());

CREATE POLICY call_templates_write_policy ON call_templates
    USING (created_by = auth.uid())
    WITH CHECK (created_by = auth.uid());

-- Call history: Users can only see and modify their own call history
ALTER TABLE call_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_history_policy ON call_history
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Template favorites: Users can only see and modify their own favorites
ALTER TABLE template_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_favorites_policy ON template_favorites
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Call feedback: Users can only see feedback for their own calls
ALTER TABLE call_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_feedback_policy ON call_feedback
    USING (call_id IN (SELECT id FROM call_history WHERE user_id = auth.uid()))
    WITH CHECK (call_id IN (SELECT id FROM call_history WHERE user_id = auth.uid()));

-- Create triggers to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = CURRENT_TIMESTAMP;
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_subscription_plans_updated_at
BEFORE UPDATE ON subscription_plans
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_user_subscriptions_updated_at
BEFORE UPDATE ON user_subscriptions
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_call_templates_updated_at
BEFORE UPDATE ON call_templates
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_call_history_updated_at
BEFORE UPDATE ON call_history
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
