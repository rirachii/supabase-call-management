-- Add Stripe-specific fields to tables

-- Add Stripe customer ID to users table
ALTER TABLE users
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;

-- Add Stripe product and price IDs to subscription_plans table
ALTER TABLE subscription_plans
ADD COLUMN IF NOT EXISTS stripe_product_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS stripe_price_id TEXT UNIQUE;

-- Add Stripe payment-related fields to user_subscriptions table
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS stripe_subscription_item_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_latest_invoice_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_intent_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_payment_method_id TEXT;

-- Create a table for subscription history and invoices
CREATE TABLE IF NOT EXISTS subscription_invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES user_subscriptions(id),
    stripe_invoice_id TEXT UNIQUE,
    stripe_payment_intent_id TEXT,
    amount DECIMAL(10, 2) NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL, -- 'paid', 'open', 'uncollectible', 'void'
    invoice_date TIMESTAMP WITH TIME ZONE,
    paid_date TIMESTAMP WITH TIME ZONE,
    invoice_pdf TEXT, -- URL to invoice PDF
    invoice_data JSONB, -- Full invoice data from Stripe
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a table for payment methods
CREATE TABLE IF NOT EXISTS payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    stripe_payment_method_id TEXT UNIQUE,
    payment_type TEXT NOT NULL, -- 'card', 'bank_account', etc.
    is_default BOOLEAN DEFAULT FALSE,
    card_brand TEXT, -- 'visa', 'mastercard', etc.
    card_last4 TEXT,
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    billing_details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create a function to insert a Stripe product and price
CREATE OR REPLACE FUNCTION create_stripe_plan(
    name_param TEXT,
    description_param TEXT,
    price_param DECIMAL,
    interval_param TEXT,
    features_param JSONB,
    call_limit_param INTEGER,
    minutes_limit_param INTEGER,
    stripe_product_id_param TEXT,
    stripe_price_id_param TEXT
) RETURNS UUID AS $$
DECLARE
    plan_id UUID;
BEGIN
    INSERT INTO subscription_plans (
        name,
        description,
        price,
        interval,
        features,
        call_limit,
        minutes_limit,
        stripe_product_id,
        stripe_price_id,
        active
    ) VALUES (
        name_param,
        description_param,
        price_param,
        interval_param,
        features_param,
        call_limit_param,
        minutes_limit_param,
        stripe_product_id_param,
        stripe_price_id_param,
        TRUE
    ) RETURNING id INTO plan_id;
    
    RETURN plan_id;
END;
$$ LANGUAGE plpgsql;

-- Create function to get user subscription details with plan info
CREATE OR REPLACE FUNCTION get_user_subscription(user_id_param UUID)
RETURNS TABLE (
    id UUID,
    status TEXT,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,
    cancel_at_period_end BOOLEAN,
    subscription_id TEXT,
    plan_id UUID,
    plan_name TEXT,
    plan_price DECIMAL,
    plan_interval TEXT,
    plan_call_limit INTEGER,
    plan_minutes_limit INTEGER,
    calls_used INTEGER,
    calls_remaining INTEGER,
    minutes_used INTEGER,
    minutes_remaining INTEGER
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        us.id,
        us.status,
        us.current_period_start,
        us.current_period_end,
        us.cancel_at_period_end,
        us.subscription_id,
        sp.id AS plan_id,
        sp.name AS plan_name,
        sp.price AS plan_price,
        sp.interval AS plan_interval,
        sp.call_limit AS plan_call_limit,
        sp.minutes_limit AS plan_minutes_limit,
        ucu.calls_used,
        ucu.calls_remaining,
        ucu.minutes_used,
        ucu.minutes_remaining
    FROM 
        user_subscriptions us
    JOIN 
        subscription_plans sp ON us.plan_id = sp.id
    LEFT JOIN 
        user_call_usage ucu ON us.id = ucu.subscription_id 
            AND ucu.billing_period_start <= CURRENT_TIMESTAMP 
            AND ucu.billing_period_end >= CURRENT_TIMESTAMP
    WHERE 
        us.user_id = user_id_param
        AND us.status IN ('active', 'trialing')
    ORDER BY 
        us.current_period_end DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Create a function to handle subscription cancellation
CREATE OR REPLACE FUNCTION cancel_subscription(
    user_id_param UUID,
    subscription_id_param UUID,
    cancel_at_period_end_param BOOLEAN DEFAULT TRUE
) RETURNS BOOLEAN AS $$
DECLARE
    success BOOLEAN := FALSE;
BEGIN
    -- Update the subscription in the database
    UPDATE user_subscriptions
    SET 
        status = CASE WHEN cancel_at_period_end_param THEN status ELSE 'canceled' END,
        cancel_at_period_end = cancel_at_period_end_param,
        updated_at = CURRENT_TIMESTAMP
    WHERE 
        id = subscription_id_param
        AND user_id = user_id_param;
    
    IF FOUND THEN
        success := TRUE;
    END IF;
    
    RETURN success;
END;
$$ LANGUAGE plpgsql;

-- Apply RLS policies to new tables

-- Only users can see their own invoices
ALTER TABLE subscription_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY subscription_invoices_policy ON subscription_invoices
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Only users can see their own payment methods
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_methods_policy ON payment_methods
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Create triggers to automatically update the updated_at timestamp
CREATE TRIGGER update_subscription_invoices_updated_at
BEFORE UPDATE ON subscription_invoices
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_payment_methods_updated_at
BEFORE UPDATE ON payment_methods
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Sample data for testing (commented out for production)
-- Uncomment and replace with your actual Stripe IDs for setup

/*
-- Create sample plans with Stripe IDs
SELECT create_stripe_plan(
    'Basic Plan',
    'Up to 50 calls per month',
    9.99,
    'monthly',
    '["50 calls per month", "5 minute maximum per call", "Basic templates"]',
    50,
    250,
    'prod_stripe_product_id_1',
    'price_stripe_price_id_1'
);

SELECT create_stripe_plan(
    'Pro Plan',
    'Up to 200 calls per month',
    29.99,
    'monthly',
    '["200 calls per month", "10 minute maximum per call", "All templates"]',
    200,
    2000,
    'prod_stripe_product_id_2',
    'price_stripe_price_id_2'
);

SELECT create_stripe_plan(
    'Enterprise Plan',
    'Unlimited calls',
    99.99,
    'monthly',
    '["Unlimited calls", "15 minute maximum per call", "All templates", "Priority support"]',
    1000,
    15000,
    'prod_stripe_product_id_3',
    'price_stripe_price_id_3'
);
*/
