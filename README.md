# Supabase Call Management System

This repository contains the database schema for a comprehensive call management system using Supabase. The schema includes tables for user information, call templates, call history, subscription plans, usage tracking, call queuing, and multi-provider support.

## Tables Overview

### Core Tables
1. **users** - Extends Supabase's auth.users with profile information
2. **subscription_plans** - Defines different subscription tiers
3. **user_subscriptions** - Links users to their subscription plans
4. **user_call_usage** - Tracks call and minute usage for billing
5. **call_templates** - Stores call scripts and templates
6. **call_history** - Records all calls made by users
7. **template_favorites** - Tracks user favorite templates
8. **call_feedback** - Stores feedback for calls

### Queue and Provider Management
9. **call_service_providers** - Manages different call service providers (Vapi, SynthFlow, etc.)
10. **call_queue** - Handles call queuing, scheduling, and routing
11. **provider_availability** - Tracks real-time availability of providers
12. **call_assignments** - Records which provider handled which call
13. **call_retries** - Manages retry logic for failed calls

## Key Features

### Multi-Provider Support
- Abstract away provider details from users
- Automatically route calls to available providers
- Track provider health and availability
- Balance load between providers
- Fail over to alternative providers

### Call Queuing and Scheduling
- Immediate and scheduled calls
- Priority-based queuing
- Retry logic for failed calls
- Queue status tracking

### User Management
- Extended user profiles
- Subscription and billing management
- Usage tracking and limits

### Call Templates and History
- Template management with categories and favorites
- Comprehensive call history with recordings and transcripts
- Feedback collection

## Database Schema

### Users Table
- Extended user profile information
- Linked to Supabase auth.users

### Subscription Plans Table
- Different pricing tiers
- Features and limits for each plan

### User Subscriptions Table
- Links users to plans
- Tracks subscription status and periods
- Supports external payment provider IDs

### User Call Usage Table
- Tracks calls and minutes used
- Monitors remaining allowances
- Tied to billing periods

### Call Templates Table
- Stores call scripts and templates
- Supports categories and tags
- Can be public or private

### Call History Table
- Records of all calls made
- Includes duration, recipient info, and status
- Support for recordings and transcripts

### Call Service Providers Table
- Manages provider information and credentials
- Tracks capabilities and limitations
- Configures provider priorities

### Call Queue Table
- Manages pending and scheduled calls
- Handles call priorities
- Tracks call status through the system

### Provider Availability Table
- Real-time tracking of provider capacity
- Health monitoring
- Load balancing information

## Database Functions

The schema includes several PostgreSQL functions for common operations:

1. **get_next_call_in_queue()** - Returns the next call to process
2. **get_best_available_provider()** - Finds the optimal provider for a call
3. **assign_call_to_provider()** - Assigns a call to a provider and updates tracking
4. **complete_call()** - Finalizes a call and updates statistics
5. **handle_failed_call()** - Manages retries and failure handling
6. **schedule_call()** - Adds a call to the queue for immediate or scheduled execution

## Row Level Security

The schema includes Row Level Security (RLS) policies to ensure:
- Users can only see and modify their own data
- Public templates are visible to all authenticated users
- Private templates are only visible to their creators
- Provider management is restricted to admin users

## How to Use

### Method 1: Using the Supabase Web Interface

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the content of the migration files:
   - First apply `migrations/001_initial_schema.sql`
   - Then apply `migrations/002_queue_and_providers.sql`
4. Paste them into the SQL Editor and run the queries

### Method 2: Using the Supabase CLI

1. Install the Supabase CLI if you haven't already:
   ```bash
   npm install -g supabase
   ```

2. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```

3. Apply the migrations:
   ```bash
   supabase db push
   ```

## Service Integration Example

Here's a simple example of how to integrate with different call service providers:

1. Add your providers to the `call_service_providers` table:
   ```sql
   INSERT INTO call_service_providers (name, provider_type, api_key, api_secret, base_url, max_concurrent_calls, priority)
   VALUES 
     ('Vapi Production', 'vapi', 'your_vapi_key', 'your_vapi_secret', 'https://api.vapi.com', 10, 1),
     ('SynthFlow Production', 'synthflow', 'your_synthflow_key', 'your_synthflow_secret', 'https://api.synthflow.com', 10, 2);
   ```

2. Initialize provider availability:
   ```sql
   INSERT INTO provider_availability (provider_id, current_calls, available_slots, status)
   SELECT id, 0, max_concurrent_calls, 'online'
   FROM call_service_providers
   WHERE is_active = TRUE;
   ```

3. Schedule a call:
   ```sql
   SELECT schedule_call(
     'user_uuid',
     'template_uuid',
     'John Doe',
     '+15551234567',
     'john@example.com',
     CURRENT_TIMESTAMP + INTERVAL '1 hour',
     3, -- priority
     '{"company_name": "Acme Inc"}', -- custom variables
     '{"source": "web_app"}' -- metadata
   );
   ```

4. Process the queue (from an external service or Edge Function):
   ```sql
   -- Get next call
   WITH next_call AS (
     SELECT * FROM get_next_call_in_queue()
   ),
   best_provider AS (
     SELECT get_best_available_provider() AS provider_id
   )
   SELECT assign_call_to_provider(next_call.queue_id, best_provider.provider_id)
   FROM next_call, best_provider
   WHERE next_call.queue_id IS NOT NULL AND best_provider.provider_id IS NOT NULL;
   ```

## Customizing the Schema

Feel free to modify the schema to suit your specific needs:
- Add additional columns to tables
- Create new tables for additional features
- Modify the RLS policies for your security requirements
- Adjust the queue priority logic or provider selection algorithm
