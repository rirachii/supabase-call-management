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

### Provider-specific Resources
14. **provider_assistants** - Stores assistant information for each provider
15. **provider_phone_numbers** - Stores available phone numbers from providers
16. **template_variables** - Defines required variables for templates

## Key Features

### Multi-Provider Support
- Abstract away provider details from users
- Automatically route calls to available providers
- Track provider health and availability
- Balance load between providers
- Fail over to alternative providers
- Sync assistants and phone numbers from providers

### Provider-specific Resources
- Store and manage provider assistants (e.g., Vapi assistants)
- Track available phone numbers with area codes
- Allow users to select assistants and phone numbers when scheduling calls

### Template Variables
- Define required variables for each template
- Validate variable values before scheduling calls
- Insert variable values into templates before making calls

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

## Edge Functions

The system includes several Supabase Edge Functions:

1. **schedule-call** - Schedules a call with template, recipient, and variable details
2. **call-webhook** - Handles callbacks from call providers when calls complete
3. **get-call-resources** - Returns available assistants and phone numbers for UI display

## Implementation Examples

The repository includes example implementations for:

1. **Queue Processor** - A background service for processing the call queue
2. **Provider Clients** - Client implementations for Vapi and SynthFlow
3. **Migrations** - SQL scripts for setting up the database schema

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
- References to provider-specific assistants

### Call History Table
- Records of all calls made
- Includes duration, recipient info, and status
- Support for recordings and transcripts
- References to assistants and phone numbers used

### Call Service Providers Table
- Manages provider information and credentials
- Tracks capabilities and limitations
- Configures provider priorities

### Call Queue Table
- Manages pending and scheduled calls
- Handles call priorities
- Tracks call status through the system
- References to assistants and phone numbers

### Provider Assistants Table
- Stores assistant details from providers
- Includes assistant name, ID, and capabilities
- Used for scheduling calls with specific assistants

### Provider Phone Numbers Table
- Stores phone numbers from providers
- Includes country code, area code, and full number
- Only area code is exposed to users for privacy

### Template Variables Table
- Defines variables needed for a template
- Includes validation rules and descriptions
- Ensures required information is provided when scheduling

## Database Functions

The schema includes several PostgreSQL functions for common operations:

1. **get_next_call_in_queue()** - Returns the next call to process
2. **get_best_available_provider()** - Finds the optimal provider for a call
3. **assign_call_to_provider()** - Assigns a call to a provider and updates tracking
4. **complete_call()** - Finalizes a call and updates statistics
5. **handle_failed_call()** - Manages retries and failure handling
6. **schedule_call()** - Adds a call to the queue for immediate or scheduled execution
7. **get_available_assistants()** - Returns assistants available for use
8. **get_available_phone_numbers()** - Returns phone numbers available for use

## Provider Integration

The system supports multiple call providers with different APIs:

### Vapi Integration
- Store Vapi assistants with assistant IDs
- Track Vapi phone numbers with area codes
- Allow selection of assistants when scheduling calls
- Process template variables for Vapi calls
- Handle Vapi webhooks for call completion

### SynthFlow Integration
- Abstract provider differences behind a common interface
- Map provider-specific parameters appropriately
- Handle different webhook formats from each provider

## How to Use

### Method 1: Using the Supabase Web Interface

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Apply the migration files in order:
   - First apply `migrations/001_initial_schema.sql`
   - Then apply `migrations/002_queue_and_providers.sql`
   - Finally apply `migrations/003_provider_details.sql`

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

### Method 3: Using the Migration in Your Project

1. Clone this repository:
   ```bash
   git clone https://github.com/rirachii/supabase-call-management.git
   ```

2. Copy the SQL files to your project's migration folder

### Setting Up the Edge Functions

1. Deploy the edge functions to your Supabase project:
   ```bash
   cd supabase/functions
   supabase functions deploy call-webhook
   supabase functions deploy schedule-call
   supabase functions deploy get-call-resources
   ```

### Running the Queue Processor

The queue processor can be run as a background service:

1. Install dependencies:
   ```bash
   cd examples
   npm install
   ```

2. Set environment variables:
   ```bash
   export SUPABASE_URL="https://your-project-id.supabase.co"
   export SUPABASE_SERVICE_KEY="your-service-key"
   export WEBHOOK_BASE_URL="https://your-project-id.functions.supabase.co"
   ```

3. Run the processor:
   ```bash
   node queue_processor.js
   ```

## Example API Usage

### Scheduling a Call

```javascript
const response = await fetch('https://your-project-id.functions.supabase.co/schedule-call', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken}`
  },
  body: JSON.stringify({
    templateId: 'uuid-of-template',
    recipientName: 'John Doe',
    recipientPhone: '+15551234567',
    recipientEmail: 'john@example.com',
    assistantId: 'uuid-of-assistant', // Optional
    phoneNumberId: 'uuid-of-phone', // Optional
    customVariables: {
      company_name: 'Acme Inc',
      product_interest: 'Premium Plan'
    }
  })
});
```

### Getting Available Resources

```javascript
const response = await fetch('https://your-project-id.functions.supabase.co/get-call-resources?templateId=uuid-of-template', {
  headers: {
    'Authorization': `Bearer ${userToken}`
  }
});

const { assistants, phoneNumbers, templateVariables } = await response.json();
```

## Customizing the Schema

Feel free to modify the schema to suit your specific needs:
- Add additional columns to tables
- Create new tables for additional features
- Modify the RLS policies for your security requirements
- Adjust the queue priority logic or provider selection algorithm
