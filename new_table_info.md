# Supabase Database Tables

This document outlines the database schema for a phone call app using Supabase, with tables supporting user authentication, subscriptions, call management, and integration with VAPI and Stripe.

## Tables

### 1. `subscription_plans`
Stores available subscription tiers.

CREATE TABLE IF NOT EXISTS subscription_plans (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(10, 2) NOT NULL,
    interval TEXT NOT NULL,  -- 'monthly', 'yearly'
    features JSONB,          -- JSON array of features
    call_limit INTEGER,      -- Number of calls allowed per interval
    minutes_limit INTEGER,   -- Number of minutes allowed per interval
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
Give it 4 tiers, free, basic, business, enterprise
**RLS Policy**: `SELECT` for authenticated users.

---

### 2. `auth.users` (Built-in)
Managed by Supabase Authentication.

| Column  | Type  | Description           | Constraints |
|---------|-------|-----------------------|-------------|
| `id`    | uuid  | Primary key          | PK          |
| `email` | text  | User email           |             |
| ...     | ...   | Other auth fields    |             |

---
### 3. `user_profiles`

CREATE TABLE public.user_profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  phone_number TEXT,
  email TEXT,
  address JSONB,
  preferences JSONB,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  status, TEXT ("active" or "inactive") with Default "inactive",

);
**RLS Policy**: `SELECT`, `UPDATE` where `auth.uid() = user_id`.

-- Add Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Policy for users to view/edit only their own profile
CREATE POLICY "Users can view own profile" 
  ON public.profiles FOR SELECT 
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" 
  ON public.profiles FOR UPDATE 
  USING (auth.uid() = id);

---

### 4. `user_subscriptions`

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES subscription_plans(id),
    status TEXT NOT NULL,  -- 'active', 'canceled', 'past_due', 'trialing'
    stripe_sub_id TEXT,
    current_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
    current_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
    cancel_at_period_end BOOLEAN DEFAULT FALSE,
    payment_method JSONB,
    subscription_id TEXT,  -- External subscription ID (Stripe, etc.)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

### 5. `user_call_usage`
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

### 1. `call_service_providers`
Manages VAPI provider details.

| Column            | Type     | Description                       | Constraints       |
|-------------------|----------|-----------------------------------|-------------------|
| `id`             | uuid     | Primary key                      | PK                |
| `name`           | text     | Provider name (e.g., "VAPI")     |                   |
| `api_credentials`| jsonb    | Encrypted API keys               |                   |
| `type`           | text     | Provider type (e.g., "voice")    |                   |
| `concurrency_limit`| integer | Max simultaneous calls (e.g., 5) |                   |
| `priority`       | integer  | Selection priority (e.g., 1)     |                   |

**RLS Policy**: No direct user access; managed via edge functions.

### 2. `provider_phone_numbers`
CREATE TABLE IF NOT EXISTS provider_phone_numbers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES call_service_providers(id) ON DELETE CASCADE,
    phone_id TEXT,
    country_code TEXT NOT NULL,
    area_code TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    full_number TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    capabilities JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider_id, phone_id)
);

### 3. `call_templates`
CREATE TABLE "public.call_templates" (
    "id" UUID PRIMARY KEY,
    "name" VARCHAR NOT NULL,
    "description" TEXT,
    "category" VARCHAR,
    "tags" JSONB,
    "is_public" BOOLEAN DEFAULT FALSE,
    "created_by" UUID,
    "provider_id" UUID (lnked to vapi),
    "assistant_id" UUID,
    "params" JSONB,
    "params_order" JSONB
    "created_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
);

---

### 4. `call_queue`
Queues user call requests.

| Column            | Type     | Description                       | Constraints       |
|-------------------|----------|-----------------------------------|-------------------|
| `id`             | uuid     | Primary key                      | PK                |
| `user_id`        | uuid     | References `auth.users`          | FK                |
| `recipient_number`| text     | Phone number (e.g., "+1234567890")|                  |
| `scheduled_time` | timestamp| Time to process (nullable)       |                   |
| `status`         | text     | "queued", "in-progress", etc.    | Default "queued"  |
| `call_id`         | text     | VAPI call ID (nullable)          |                   |

| `provider_id`    | uuid     | References `call_service_providers`| FK              |
| `template_id`    | uuid     | References `call_templates`      | FK                |
| `custom_variables`| jsonb    | Custom data (e.g., {"doctor": "Smith"}) |            |
| `created_at`     | timestamp| Creation timestamp               | Default `now()`   |

queue the call in fifo order. anyone can add to this queue. have a function that will check if any new call is in queue. if so it will call post request to vapi api with the template information and update the status to in-progress. we can do 10 of these concurrently so the function must be able to post 10 calls if necessary at once. and wait for the response. once we get response we can update the status and the call_id. we will also add this to user_call_history

---

### 5. `user_call_history`
Stores completed call records.

| Column           | Type     | Description                       | Constraints       |
|------------------|----------|-----------------------------------|-------------------|
| `id`            | uuid     | Primary key                      | PK                |
| `user_id`       | uuid     | References `auth.users`          | FK                |
| `call_queue_id` | uuid     | References `call_queue`          | FK                |
| `call_id`         | text     | VAPI call ID (nullable)          |                   |
| `provider_id`   | uuid     | References `call_service_providers`| FK              |
| `assistant_id`  | uuid     | References `provider_assistants` | FK                |
| `phone_number_id`| uuid    | References `provider_phone_numbers`| FK              |
| `transcript`    | text     | Call transcript                  |                   |
| `status`        | text     | "completed", "failed"            |                   |
| `created_at`    | timestamp| Creation timestamp               | Default `now()`   |
