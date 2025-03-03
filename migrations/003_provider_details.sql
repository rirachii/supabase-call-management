-- Provider assistants table to store assistant information
CREATE TABLE IF NOT EXISTS provider_assistants (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES call_service_providers(id) ON DELETE CASCADE,
    assistant_name TEXT NOT NULL,
    assistant_id TEXT NOT NULL,
    description TEXT,
    capabilities TEXT[],
    default_voice_id TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(provider_id, assistant_id)
);

-- Provider phone numbers table
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

-- Template variables table to define required variables for templates
CREATE TABLE IF NOT EXISTS template_variables (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    template_id UUID NOT NULL REFERENCES call_templates(id) ON DELETE CASCADE,
    variable_name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT TRUE,
    default_value TEXT,
    validation_regex TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(template_id, variable_name)
);

-- Modify call_templates table to add assistant and provider references
ALTER TABLE call_templates
ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES call_service_providers(id),
ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES provider_assistants(id);

-- Modify call_queue table to add assistant and phone number references
ALTER TABLE call_queue
ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES provider_assistants(id),
ADD COLUMN IF NOT EXISTS phone_number_id UUID REFERENCES provider_phone_numbers(id);

-- Modify call_history table to add assistant and phone number references
ALTER TABLE call_history
ADD COLUMN IF NOT EXISTS assistant_id UUID REFERENCES provider_assistants(id),
ADD COLUMN IF NOT EXISTS phone_number_id UUID REFERENCES provider_phone_numbers(id),
ADD COLUMN IF NOT EXISTS caller_phone_number TEXT;

-- Update RLS policies

-- Assistants visible to authenticated users
ALTER TABLE provider_assistants ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_assistants_read_policy ON provider_assistants
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Phone numbers visible to authenticated users (only area code in UI)
ALTER TABLE provider_phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_phone_numbers_read_policy ON provider_phone_numbers
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Template variables visible to authenticated users
ALTER TABLE template_variables ENABLE ROW LEVEL SECURITY;

CREATE POLICY template_variables_read_policy ON template_variables
    FOR SELECT
    USING (auth.role() = 'authenticated');

-- Template variables can be modified by template owner
CREATE POLICY template_variables_write_policy ON template_variables
    USING (template_id IN (SELECT id FROM call_templates WHERE created_by = auth.uid()))
    WITH CHECK (template_id IN (SELECT id FROM call_templates WHERE created_by = auth.uid()));

-- Create triggers to automatically update the updated_at timestamp
CREATE TRIGGER update_provider_assistants_updated_at
BEFORE UPDATE ON provider_assistants
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_provider_phone_numbers_updated_at
BEFORE UPDATE ON provider_phone_numbers
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_template_variables_updated_at
BEFORE UPDATE ON template_variables
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Create or replace function to get available assistants
CREATE OR REPLACE FUNCTION get_available_assistants(provider_type_param TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    assistant_name TEXT,
    assistant_id TEXT,
    description TEXT,
    provider_id UUID,
    provider_name TEXT,
    provider_type TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        pa.id,
        pa.assistant_name,
        pa.assistant_id,
        pa.description,
        csp.id AS provider_id,
        csp.name AS provider_name,
        csp.provider_type
    FROM 
        provider_assistants pa
    JOIN 
        call_service_providers csp ON pa.provider_id = csp.id
    WHERE 
        pa.is_active = TRUE
        AND csp.is_active = TRUE
        AND (provider_type_param IS NULL OR csp.provider_type = provider_type_param)
    ORDER BY 
        csp.priority ASC, 
        pa.assistant_name ASC;
END;
$$ LANGUAGE plpgsql;

-- Create or replace function to get available phone numbers
CREATE OR REPLACE FUNCTION get_available_phone_numbers(provider_type_param TEXT DEFAULT NULL)
RETURNS TABLE (
    id UUID,
    provider_id UUID,
    provider_name TEXT,
    provider_type TEXT,
    phone_id TEXT,
    area_code TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        ppn.id,
        csp.id AS provider_id,
        csp.name AS provider_name,
        csp.provider_type,
        ppn.phone_id,
        ppn.area_code
    FROM 
        provider_phone_numbers ppn
    JOIN 
        call_service_providers csp ON ppn.provider_id = csp.id
    WHERE 
        ppn.is_active = TRUE
        AND csp.is_active = TRUE
        AND (provider_type_param IS NULL OR csp.provider_type = provider_type_param)
    ORDER BY 
        csp.priority ASC, 
        ppn.area_code ASC;
END;
$$ LANGUAGE plpgsql;

-- Update schedule_call function to include assistant and phone number
CREATE OR REPLACE FUNCTION schedule_call(
    user_id_param UUID,
    template_id_param UUID,
    recipient_name_param TEXT,
    recipient_phone_param TEXT,
    recipient_email_param TEXT,
    scheduled_time_param TIMESTAMP WITH TIME ZONE,
    priority_param INTEGER DEFAULT 5,
    custom_variables_param JSONB DEFAULT NULL,
    metadata_param JSONB DEFAULT NULL,
    assistant_id_param UUID DEFAULT NULL,
    phone_number_id_param UUID DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    new_queue_id UUID;
    validated_variables JSONB := custom_variables_param;
    missing_required_vars TEXT[];
BEGIN
    -- Check for required variables
    WITH required_vars AS (
        SELECT 
            variable_name, 
            is_required
        FROM 
            template_variables
        WHERE 
            template_id = template_id_param
            AND is_required = TRUE
    )
    SELECT 
        array_agg(variable_name) INTO missing_required_vars
    FROM 
        required_vars
    WHERE 
        NOT (custom_variables_param ? variable_name);
    
    -- Error if missing required variables
    IF missing_required_vars IS NOT NULL AND array_length(missing_required_vars, 1) > 0 THEN
        RAISE EXCEPTION 'Missing required variables: %', missing_required_vars;
    END IF;
    
    -- Find assistant if not specified
    IF assistant_id_param IS NULL THEN
        -- Get template's assistant if set
        WITH template_assistant AS (
            SELECT assistant_id FROM call_templates WHERE id = template_id_param AND assistant_id IS NOT NULL
        )
        SELECT 
            COALESCE(
                (SELECT assistant_id FROM template_assistant),
                (SELECT id FROM provider_assistants WHERE is_active = TRUE LIMIT 1)
            ) 
        INTO assistant_id_param;
    END IF;
    
    -- Find phone number if not specified
    IF phone_number_id_param IS NULL THEN
        SELECT id INTO phone_number_id_param 
        FROM provider_phone_numbers 
        WHERE is_active = TRUE 
        LIMIT 1;
    END IF;
    
    -- Create the queue entry
    INSERT INTO call_queue (
        user_id,
        template_id,
        recipient_name,
        recipient_phone,
        recipient_email,
        scheduled_time,
        priority,
        status,
        custom_variables,
        metadata,
        assistant_id,
        phone_number_id
    ) VALUES (
        user_id_param,
        template_id_param,
        recipient_name_param,
        recipient_phone_param,
        recipient_email_param,
        scheduled_time_param,
        priority_param,
        'pending',
        validated_variables,
        metadata_param,
        assistant_id_param,
        phone_number_id_param
    )
    RETURNING id INTO new_queue_id;
    
    RETURN new_queue_id;
END;
$$ LANGUAGE plpgsql;

-- Update the processNextCall function to handle assistants and phone numbers
CREATE OR REPLACE FUNCTION assign_call_to_provider(queue_id_param UUID, provider_id_param UUID)
RETURNS BOOLEAN AS $$
DECLARE
    success BOOLEAN := FALSE;
    queue_record RECORD;
    assistant_info RECORD;
    phone_info RECORD;
BEGIN
    -- First, get the call queue record
    SELECT * INTO queue_record FROM call_queue WHERE id = queue_id_param;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    -- Get assistant info if specified
    IF queue_record.assistant_id IS NOT NULL THEN
        SELECT 
            pa.*, 
            csp.id AS actual_provider_id 
        INTO assistant_info 
        FROM 
            provider_assistants pa
        JOIN 
            call_service_providers csp ON pa.provider_id = csp.id
        WHERE 
            pa.id = queue_record.assistant_id;
        
        -- Override the provider_id with the assistant's provider
        IF FOUND THEN
            provider_id_param := assistant_info.actual_provider_id;
        END IF;
    END IF;
    
    -- Get phone number info if specified
    IF queue_record.phone_number_id IS NOT NULL THEN
        SELECT 
            ppn.*, 
            csp.id AS actual_provider_id 
        INTO phone_info 
        FROM 
            provider_phone_numbers ppn
        JOIN 
            call_service_providers csp ON ppn.provider_id = csp.id
        WHERE 
            ppn.id = queue_record.phone_number_id;
        
        -- Override the provider_id with the phone number's provider
        -- This takes precedence over the assistant's provider
        IF FOUND THEN
            provider_id_param := phone_info.actual_provider_id;
        END IF;
    END IF;
    
    -- Update the call queue entry
    UPDATE call_queue
    SET 
        status = 'processing',
        provider_id = provider_id_param,
        last_attempt = CURRENT_TIMESTAMP,
        attempt_count = attempt_count + 1
    WHERE 
        id = queue_id_param
        AND status = 'pending';
    
    -- Check if update was successful
    IF FOUND THEN
        -- Increment the current_calls counter for the provider
        UPDATE provider_availability
        SET current_calls = current_calls + 1
        WHERE provider_id = provider_id_param;
        
        -- Record the assignment
        INSERT INTO call_assignments (
            queue_id,
            provider_id,
            assignment_status
        ) VALUES (
            queue_id_param,
            provider_id_param,
            'assigned'
        );
        
        success := TRUE;
    END IF;
    
    RETURN success;
END;
$$ LANGUAGE plpgsql;

-- Sample data for Vapi integration
-- Uncomment and customize as needed for your implementation

/*
-- Add Vapi as a service provider
INSERT INTO call_service_providers 
(name, provider_type, api_key, api_secret, base_url, max_concurrent_calls, priority, is_active)
VALUES 
('Vapi Production', 'vapi', 'YOUR_VAPI_API_KEY', 'YOUR_VAPI_API_SECRET', 'https://api.vapi.ai', 10, 1, true);

-- Get the provider ID for Vapi
DO $$
DECLARE
    vapi_provider_id UUID;
BEGIN
    SELECT id INTO vapi_provider_id FROM call_service_providers WHERE provider_type = 'vapi' LIMIT 1;
    
    -- Add some Vapi assistants
    INSERT INTO provider_assistants 
    (provider_id, assistant_name, assistant_id, description, default_voice_id, is_active)
    VALUES 
    (vapi_provider_id, 'Sales Assistant', 'sales-assistant-123', 'An AI assistant specialized in sales calls', 'echo', true),
    (vapi_provider_id, 'Support Agent', 'support-agent-456', 'An AI assistant for customer support', 'alloy', true),
    (vapi_provider_id, 'Appointment Scheduler', 'appointment-scheduler-789', 'An AI assistant for scheduling appointments', 'shimmer', true);
    
    -- Add some Vapi phone numbers
    INSERT INTO provider_phone_numbers 
    (provider_id, phone_id, country_code, area_code, phone_number, full_number, is_active)
    VALUES 
    (vapi_provider_id, 'phone-123', '+1', '415', '5551234', '+14155551234', true),
    (vapi_provider_id, 'phone-456', '+1', '650', '5555678', '+16505555678', true),
    (vapi_provider_id, 'phone-789', '+1', '747', '5559876', '+17475559876', true);
END $$;
*/
