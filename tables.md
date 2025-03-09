# Supabase Database Tables Schema

## 1. `subscription_plans`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `name` | TEXT | Plan name | NOT NULL |
| `description` | TEXT | Plan description | |
| `price` | DECIMAL(10, 2) | Plan price | NOT NULL |
| `interval` | TEXT | Billing interval | NOT NULL, CHECK (interval IN ('monthly', 'yearly')) |
| `features` | JSONB | List of features | |
| `call_limit` | INTEGER | Number of calls allowed per interval | |
| `minutes_limit` | INTEGER | Number of minutes allowed per interval | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_subscription_plans_interval` on (`interval`)

**RLS Policies:**
- `Anyone can view subscription plans`: SELECT to authenticated users
- `Admin can manage subscription plans`: All operations for admins

## 2. `user_profiles`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key, references auth.users | PK, FK |
| `first_name` | TEXT | User's first name | |
| `last_name` | TEXT | User's last name | |
| `phone_number` | TEXT | User's phone number | |
| `email` | TEXT | User's email address | |
| `address` | JSONB | User's address information | |
| `preferences` | JSONB | User preferences | |
| `status` | TEXT | Account status | NOT NULL, CHECK (status IN ('active', 'inactive')), Default: 'inactive' |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_user_profiles_status` on (`status`)

**RLS Policies:**
- `Users can view own profile`: SELECT where auth.uid() = id
- `Users can update own profile`: UPDATE where auth.uid() = id
- `Users can insert own profile`: INSERT where auth.uid() = id
- `Admin can access all profiles`: All operations for admins

## 3. `user_subscriptions`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `user_id` | UUID | References auth.users | NOT NULL, FK, ON DELETE CASCADE |
| `plan_id` | UUID | References subscription_plans | NOT NULL, FK |
| `status` | TEXT | Subscription status | NOT NULL, CHECK (status IN ('active', 'canceled', 'past_due', 'trialing')) |
| `stripe_sub_id` | TEXT | Stripe subscription ID | |
| `current_period_start` | TIMESTAMPTZ | Current billing period start | NOT NULL |
| `current_period_end` | TIMESTAMPTZ | Current billing period end | NOT NULL |
| `cancel_at_period_end` | BOOLEAN | Whether to cancel at period end | Default: FALSE |
| `payment_method` | JSONB | Payment method details | |
| `subscription_id` | TEXT | External subscription ID | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_user_subscriptions_user_id` on (`user_id`)
- `idx_user_subscriptions_plan_id` on (`plan_id`)
- `idx_user_subscriptions_status` on (`status`)

**RLS Policies:**
- `Users can view own subscriptions`: SELECT where auth.uid() = user_id
- `Admin can manage all subscriptions`: All operations for admins

## 4. `user_call_usage`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `user_id` | UUID | References auth.users | NOT NULL, FK, ON DELETE CASCADE |
| `subscription_id` | UUID | References user_subscriptions | FK |
| `billing_period_start` | TIMESTAMPTZ | Billing period start date | NOT NULL |
| `billing_period_end` | TIMESTAMPTZ | Billing period end date | NOT NULL |
| `calls_used` | INTEGER | Number of calls used | Default: 0 |
| `minutes_used` | INTEGER | Number of minutes used | Default: 0 |
| `calls_remaining` | INTEGER | Number of calls remaining | |
| `minutes_remaining` | INTEGER | Number of minutes remaining | |
| `last_updated` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_user_call_usage_user_id` on (`user_id`)
- `idx_user_call_usage_subscription_id` on (`subscription_id`)
- `idx_user_call_usage_billing_period` on (`billing_period_start`, `billing_period_end`)

**RLS Policies:**
- `Users can view own call usage`: SELECT where auth.uid() = user_id
- `Admin can manage all call usage`: All operations for admins

## 5. `call_service_providers`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `name` | TEXT | Provider name (e.g., "VAPI") | NOT NULL |
| `api_credentials` | JSONB | Encrypted API keys | |
| `type` | TEXT | Provider type (e.g., "voice") | NOT NULL |
| `concurrency_limit` | INTEGER | Max simultaneous calls | Default: 5 |
| `priority` | INTEGER | Selection priority | Default: 1 |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_call_service_providers_name` on (`name`)

**RLS Policies:**
- `Users can view call providers`: SELECT for authenticated users
- `Admin can manage call providers`: All operations for admins

## 6. `provider_phone_numbers`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `provider_id` | UUID | References call_service_providers | NOT NULL, FK, ON DELETE CASCADE |
| `phone_id` | TEXT | External phone ID | |
| `country_code` | TEXT | Country code (e.g., "1" for US) | NOT NULL |
| `area_code` | TEXT | Area code | NOT NULL |
| `phone_number` | TEXT | Phone number without codes | NOT NULL |
| `full_number` | TEXT | Complete phone number with codes | NOT NULL |
| `is_active` | BOOLEAN | Whether number is active | Default: TRUE |
| `capabilities` | JSONB | Phone number capabilities | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_provider_phone_numbers_provider_id` on (`provider_id`)
- `idx_provider_phone_numbers_is_active` on (`is_active`)
- `idx_provider_phone_numbers_full_number` on (`full_number`)

**Constraints:**
- UNIQUE(`provider_id`, `phone_id`)

**RLS Policies:**
- `Users can view provider phone numbers`: SELECT where is_active = true for authenticated users
- `Admin can manage phone numbers`: All operations for admins

## 7. `user_phone_numbers`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `user_id` | UUID | References auth.users | NOT NULL, FK, ON DELETE CASCADE |
| `provider_id` | UUID | References call_service_providers | NOT NULL, FK |
| `phone_id` | TEXT | External phone ID | |
| `country_code` | TEXT | Country code (e.g., "1" for US) | NOT NULL |
| `area_code` | TEXT | Area code | NOT NULL |
| `phone_number` | TEXT | Phone number without codes | NOT NULL |
| `full_number` | TEXT | Complete phone number with codes | NOT NULL |
| `is_active` | BOOLEAN | Whether number is active | Default: TRUE |
| `is_default` | BOOLEAN | Whether this is the default number | Default: FALSE |
| `capabilities` | JSONB | Phone number capabilities | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_user_phone_numbers_user_id` on (`user_id`)
- `idx_user_phone_numbers_is_active` on (`is_active`)
- `idx_user_phone_numbers_is_default` on (`is_default`)

**Constraints:**
- UNIQUE(`user_id`, `full_number`)

**RLS Policies:**
- `Users can view own phone numbers`: SELECT where auth.uid() = user_id
- `Users can manage own phone numbers`: INSERT where auth.uid() = user_id
- `Users can update own phone numbers`: UPDATE where auth.uid() = user_id
- `Users can delete own phone numbers`: DELETE where auth.uid() = user_id
- `Admin can manage all phone numbers`: All operations for admins

## 8. `voice_options`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `provider_id` | UUID | References call_service_providers | NOT NULL, FK, ON DELETE CASCADE |
| `voice_id` | TEXT | External voice ID | NOT NULL |
| `name` | TEXT | Voice name | NOT NULL |
| `gender` | TEXT | Voice gender | CHECK (gender IN ('male', 'female', 'neutral')) |
| `language` | TEXT | Voice language code | NOT NULL |
| `accent` | TEXT | Voice accent | |
| `description` | TEXT | Voice description | |
| `sample_mp3_url` | TEXT | URL to voice sample | |
| `is_premium` | BOOLEAN | Whether voice requires premium subscription | Default: FALSE |
| `is_active` | BOOLEAN | Whether voice is active | Default: TRUE |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_voice_options_provider_id` on (`provider_id`)
- `idx_voice_options_language` on (`language`)
- `idx_voice_options_is_active` on (`is_active`)
- `idx_voice_options_is_premium` on (`is_premium`)

**Constraints:**
- UNIQUE(`provider_id`, `voice_id`)

**RLS Policies:**
- `Users can view available voices`: SELECT where is_active = true for authenticated users
- `Admin can manage voices`: All operations for admins

## 9. `call_templates`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `name` | TEXT | Template name | NOT NULL |
| `description` | TEXT | Template description | |
| `category` | TEXT | Template category | |
| `tags` | JSONB | Template tags | |
| `is_public` | BOOLEAN | Whether template is public | Default: FALSE |
| `created_by` | UUID | References auth.users | FK |
| `provider_id` | UUID | References call_service_providers | FK |
| `assistant_id` | UUID | External assistant ID | |
| `voice_id` | UUID | References voice_options | FK |
| `params` | JSONB | Template parameters | |
| `params_order` | JSONB | Order of parameters | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_call_templates_created_by` on (`created_by`)
- `idx_call_templates_is_public` on (`is_public`)
- `idx_call_templates_category` on (`category`)
- `idx_call_templates_provider_id` on (`provider_id`)

**RLS Policies:**
- `Users can view public templates`: SELECT where is_public = true
- `Users can view own templates`: SELECT where auth.uid() = created_by
- `Users can create templates`: INSERT where auth.uid() = created_by
- `Users can update own templates`: UPDATE where auth.uid() = created_by
- `Users can delete own templates`: DELETE where auth.uid() = created_by
- `Admin can manage all templates`: All operations for admins

## 10. `call_queue`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `user_id` | UUID | References auth.users | NOT NULL, FK |
| `recipient_number` | TEXT | Target phone number | NOT NULL |
| `caller_number_id` | UUID | References user_phone_numbers | FK |
| `scheduled_time` | TIMESTAMPTZ | Scheduled call time | |
| `status` | TEXT | Queue status | NOT NULL, CHECK (status IN ('queued', 'in-progress', 'completed', 'failed', 'canceled')), Default: 'queued' |
| `call_id` | TEXT | External call ID | |
| `provider_id` | UUID | References call_service_providers | FK |
| `template_id` | UUID | References call_templates | FK |
| `voice_id` | UUID | References voice_options | FK |
| `custom_variables` | JSONB | Custom data for call | |
| `retry_count` | INTEGER | Number of retry attempts | Default: 0 |
| `last_error` | TEXT | Last error message | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |
| `updated_at` | TIMESTAMPTZ | Last update timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_call_queue_user_id` on (`user_id`)
- `idx_call_queue_status` on (`status`)
- `idx_call_queue_scheduled_time` on (`scheduled_time`)
- `idx_call_queue_created_at` on (`created_at`)

**RLS Policies:**
- `Users can view own call queue`: SELECT where auth.uid() = user_id
- `Users can insert into call queue`: INSERT where auth.uid() = user_id
- `Users can update own queued calls`: UPDATE where auth.uid() = user_id AND status = 'queued'
- `Users can delete own queued calls`: DELETE where auth.uid() = user_id AND status = 'queued'
- `Admin can manage all call queue entries`: All operations for admins

## 11. `user_call_history`

| Column | Type | Description | Constraints |
|--------|------|-------------|-------------|
| `id` | UUID | Primary key | PK, Default: uuid_generate_v4() |
| `user_id` | UUID | References auth.users | NOT NULL, FK |
| `call_queue_id` | UUID | References call_queue | FK |
| `call_id` | TEXT | External call ID | |
| `provider_id` | UUID | References call_service_providers | FK |
| `assistant_id` | UUID | External assistant ID | |
| `phone_number_id` | UUID | References provider_phone_numbers | FK |
| `caller_number_id` | UUID | References user_phone_numbers | FK |
| `voice_id` | UUID | References voice_options | FK |
| `transcript` | TEXT | Call transcript | |
| `status` | TEXT | Call status | NOT NULL, CHECK (status IN ('completed', 'failed', 'canceled')) |
| `duration` | INTEGER | Call duration in seconds | Default: 0 |
| `recording_url` | TEXT | URL to call recording | |
| `call_summary` | TEXT | Summary of the call | |
| `call_data` | JSONB | Additional call data | |
| `created_at` | TIMESTAMPTZ | Creation timestamp | Default: CURRENT_TIMESTAMP |

**Indexes:**
- `idx_user_call_history_user_id` on (`user_id`)
- `idx_user_call_history_call_queue_id` on (`call_queue_id`)
- `idx_user_call_history_status` on (`status`)
- `idx_user_call_history_created_at` on (`created_at`)

**RLS Policies:**
- `Users can view own call history`: SELECT where auth.uid() = user_id
- `Admin can manage all call history`: All operations for admins