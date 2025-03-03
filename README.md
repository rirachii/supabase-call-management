# Supabase Call Management System

This repository contains the database schema for a comprehensive call management system using Supabase. The schema includes tables for user information, call templates, call history, subscription plans, and usage tracking.

## Tables Overview

1. **users** - Extends Supabase's auth.users with profile information
2. **subscription_plans** - Defines different subscription tiers
3. **user_subscriptions** - Links users to their subscription plans
4. **user_call_usage** - Tracks call and minute usage for billing
5. **call_templates** - Stores call scripts and templates
6. **call_history** - Records all calls made by users
7. **template_favorites** - Tracks user favorite templates
8. **call_feedback** - Stores feedback for calls

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

### Template Favorites
- User bookmarked templates

### Call Feedback
- Rating and feedback for calls

## Row Level Security

The schema includes Row Level Security (RLS) policies to ensure:
- Users can only see and modify their own data
- Public templates are visible to all authenticated users
- Private templates are only visible to their creators

## How to Use

### Method 1: Using the Supabase Web Interface

1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy the content of `migrations/001_initial_schema.sql`
4. Paste it into the SQL Editor and run the query

### Method 2: Using the Supabase CLI

1. Install the Supabase CLI if you haven't already:
   ```bash
   npm install -g supabase
   ```

2. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```

3. Apply the migration:
   ```bash
   supabase db push
   ```

### Method 3: Using the Migration in Your Project

1. Clone this repository:
   ```bash
   git clone https://github.com/rirachii/supabase-call-management.git
   ```

2. Copy the SQL files to your project's migration folder

## ERD (Entity Relationship Diagram)

For a visual representation of the database schema, you can generate an ERD using tools like:
- [dbdiagram.io](https://dbdiagram.io)
- [Supabase Schema Visualizer](https://github.com/dystroy/supabase-schema)

## Customizing the Schema

Feel free to modify the schema to suit your specific needs:
- Add additional columns to tables
- Create new tables for additional features
- Modify the RLS policies for your security requirements
