-- Database Analysis SQL
-- Run this in your Supabase SQL Editor to get a comprehensive report on your database

-- Part 1: List all tables and their descriptions
SELECT 
    table_name,
    (SELECT obj_description(oid) FROM pg_class WHERE relname = table_name) as table_description
FROM 
    information_schema.tables 
WHERE 
    table_schema = 'public'
ORDER BY table_name;

-- Part 2: Show table details with column info for all tables
DO $$
DECLARE
    table_record record;
    column_record record;
    constraint_record record;
    index_record record;
BEGIN
    RAISE NOTICE '============= DATABASE STRUCTURE ANALYSIS =============';
    
    FOR table_record IN 
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE 'TABLE: %', table_record.table_name;
        RAISE NOTICE '----------------------------------------';
        
        -- Show columns
        RAISE NOTICE 'Columns:';
        FOR column_record IN 
            SELECT 
                column_name, 
                data_type, 
                is_nullable,
                column_default
            FROM 
                information_schema.columns
            WHERE 
                table_schema = 'public' AND 
                table_name = table_record.table_name
            ORDER BY ordinal_position
        LOOP
            RAISE NOTICE '  % (%, Nullable: %, Default: %)', 
                column_record.column_name, 
                column_record.data_type,
                column_record.is_nullable,
                column_record.column_default;
        END LOOP;
        
        -- Show constraints (primary keys, foreign keys, etc.)
        RAISE NOTICE '';
        RAISE NOTICE 'Constraints:';
        FOR constraint_record IN 
            SELECT
                con.conname as constraint_name,
                con.contype as constraint_type,
                CASE
                    WHEN con.contype = 'p' THEN 'PRIMARY KEY'
                    WHEN con.contype = 'f' THEN 'FOREIGN KEY'
                    WHEN con.contype = 'u' THEN 'UNIQUE'
                    WHEN con.contype = 'c' THEN 'CHECK'
                    ELSE con.contype::text
                END as constraint_type_desc,
                pg_get_constraintdef(con.oid) as constraint_definition
            FROM
                pg_constraint con
                JOIN pg_class rel ON rel.oid = con.conrelid
                JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE
                nsp.nspname = 'public' AND
                rel.relname = table_record.table_name
            ORDER BY con.contype
        LOOP
            RAISE NOTICE '  % (%) - %', 
                constraint_record.constraint_name, 
                constraint_record.constraint_type_desc,
                constraint_record.constraint_definition;
        END LOOP;
        
        -- Show indexes
        RAISE NOTICE '';
        RAISE NOTICE 'Indexes:';
        FOR index_record IN 
            SELECT
                indexname as index_name,
                indexdef as index_definition
            FROM
                pg_indexes
            WHERE
                schemaname = 'public' AND
                tablename = table_record.table_name
            ORDER BY indexname
        LOOP
            RAISE NOTICE '  % - %', 
                index_record.index_name, 
                index_record.index_definition;
        END LOOP;
        
        -- Show row count
        EXECUTE 'SELECT COUNT(*) FROM ' || quote_ident(table_record.table_name) INTO column_record;
        RAISE NOTICE '';
        RAISE NOTICE 'Row count: %', column_record.count;
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '============= DATABASE FUNCTIONS =============';
    
    -- Show functions
    FOR column_record IN 
        SELECT 
            proname as function_name,
            pg_get_functiondef(pg_proc.oid) as function_definition
        FROM 
            pg_proc 
        JOIN 
            pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
        WHERE 
            pg_namespace.nspname = 'public'
        ORDER BY proname
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE 'FUNCTION: %', column_record.function_name;
        RAISE NOTICE '----------------------------------------';
        RAISE NOTICE '%', left(column_record.function_definition, 500) || '...'; -- Show first 500 chars
    END LOOP;
    
    RAISE NOTICE '';
    RAISE NOTICE '============= RLS POLICIES =============';
    
    -- Show RLS policies
    FOR column_record IN 
        SELECT 
            tablename,
            policyname,
            permissive,
            roles,
            cmd,
            qual,
            with_check
        FROM 
            pg_policies
        WHERE 
            schemaname = 'public'
        ORDER BY tablename, policyname
    LOOP
        RAISE NOTICE '';
        RAISE NOTICE 'POLICY: % ON %', column_record.policyname, column_record.tablename;
        RAISE NOTICE '  Type: %, Command: %, Roles: %', 
            CASE WHEN column_record.permissive THEN 'PERMISSIVE' ELSE 'RESTRICTIVE' END,
            column_record.cmd,
            column_record.roles;
        RAISE NOTICE '  USING: %', column_record.qual;
        IF column_record.with_check IS NOT NULL THEN
            RAISE NOTICE '  WITH CHECK: %', column_record.with_check;
        END IF;
    END LOOP;
END $$;

-- Part 3: Check for phone_numbers data specifically
SELECT * FROM provider_phone_numbers LIMIT 10;

-- Part 4: Check for call_service_providers data
SELECT * FROM call_service_providers LIMIT 10;

-- Part 5: Check for any custom tables that might be missing from our schema
SELECT 
    table_name,
    (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t.table_name) as column_count
FROM 
    information_schema.tables t
WHERE 
    table_schema = 'public'
    AND table_name NOT IN (
        'users', 'subscription_plans', 'user_subscriptions', 'user_call_usage',
        'call_templates', 'call_history', 'template_favorites', 'call_feedback',
        'call_service_providers', 'call_queue', 'provider_availability', 'call_assignments',
        'call_retries', 'provider_assistants', 'provider_phone_numbers', 'template_variables',
        'subscription_invoices', 'payment_methods'
    )
ORDER BY table_name;
