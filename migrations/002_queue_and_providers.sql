-- Add service providers table
CREATE TABLE IF NOT EXISTS call_service_providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    api_key TEXT,
    api_secret TEXT,
    base_url TEXT,
    provider_type TEXT NOT NULL, -- 'vapi', 'synthflow', etc.
    max_concurrent_calls INTEGER NOT NULL DEFAULT 10,
    is_active BOOLEAN DEFAULT TRUE,
    priority INTEGER NOT NULL DEFAULT 1, -- Lower number = higher priority
    capabilities JSONB, -- What features this provider supports
    configuration JSONB, -- Provider-specific settings
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Call queue table
CREATE TABLE IF NOT EXISTS call_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id UUID REFERENCES call_templates(id),
    recipient_name TEXT,
    recipient_phone TEXT,
    recipient_email TEXT,
    scheduled_time TIMESTAMP WITH TIME ZONE, -- NULL for immediate, timestamp for scheduled
    priority INTEGER NOT NULL DEFAULT 5, -- 1-10, 1 being highest
    status TEXT NOT NULL, -- 'pending', 'processing', 'completed', 'failed', 'canceled'
    provider_id UUID REFERENCES call_service_providers(id),
    provider_call_id TEXT, -- ID from the provider once assigned
    attempt_count INTEGER DEFAULT 0,
    last_attempt TIMESTAMP WITH TIME ZONE,
    notes TEXT,
    custom_variables JSONB, -- Variables to inject into the template
    metadata JSONB, -- Additional data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create an index for efficient queue processing
CREATE INDEX IF NOT EXISTS idx_call_queue_status_priority ON call_queue (status, priority, scheduled_time NULLS FIRST);
CREATE INDEX IF NOT EXISTS idx_call_queue_scheduled ON call_queue (scheduled_time) WHERE scheduled_time IS NOT NULL;

-- Provider availability tracking
CREATE TABLE IF NOT EXISTS provider_availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider_id UUID NOT NULL REFERENCES call_service_providers(id) ON DELETE CASCADE,
    current_calls INTEGER NOT NULL DEFAULT 0,
    available_slots INTEGER,
    status TEXT NOT NULL, -- 'online', 'degraded', 'offline'
    last_health_check TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    health_status JSONB, -- Detailed health information
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Call assignment history (for audit and debugging)
CREATE TABLE IF NOT EXISTS call_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id UUID NOT NULL REFERENCES call_queue(id) ON DELETE CASCADE,
    provider_id UUID NOT NULL REFERENCES call_service_providers(id),
    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    assignment_status TEXT NOT NULL, -- 'assigned', 'failed', 'completed'
    provider_response JSONB, -- Response from the provider
    metadata JSONB -- Any additional data
);

-- Call retries tracking
CREATE TABLE IF NOT EXISTS call_retries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    queue_id UUID NOT NULL REFERENCES call_queue(id) ON DELETE CASCADE,
    retry_count INTEGER NOT NULL DEFAULT 1,
    last_error TEXT,
    last_provider_id UUID REFERENCES call_service_providers(id),
    next_retry_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Extended call history table with provider info (add columns to existing table)
ALTER TABLE call_history
ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES call_service_providers(id),
ADD COLUMN IF NOT EXISTS provider_call_id TEXT,
ADD COLUMN IF NOT EXISTS queue_id UUID REFERENCES call_queue(id);

-- RLS policies for security

-- Call service providers should only be visible to admins
ALTER TABLE call_service_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_call_service_providers_policy ON call_service_providers
    USING (auth.jwt() ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Users can only see their own queued calls
ALTER TABLE call_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_queue_user_policy ON call_queue
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Only admins can see call assignments
ALTER TABLE call_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_call_assignments_policy ON call_assignments
    USING (auth.jwt() ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Only admins can see provider availability
ALTER TABLE provider_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_provider_availability_policy ON provider_availability
    USING (auth.jwt() ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Only admins can see call retries
ALTER TABLE call_retries ENABLE ROW LEVEL SECURITY;

CREATE POLICY admin_call_retries_policy ON call_retries
    USING (auth.jwt() ->> 'role' = 'admin')
    WITH CHECK (auth.jwt() ->> 'role' = 'admin');

-- Create triggers to automatically update the updated_at timestamp
CREATE TRIGGER update_call_service_providers_updated_at
BEFORE UPDATE ON call_service_providers
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_call_queue_updated_at
BEFORE UPDATE ON call_queue
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

CREATE TRIGGER update_provider_availability_updated_at
BEFORE UPDATE ON provider_availability
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- Create functions for queue management

-- Function to get the next call in the queue
CREATE OR REPLACE FUNCTION get_next_call_in_queue()
RETURNS TABLE (
    queue_id UUID,
    user_id UUID,
    template_id UUID,
    priority INTEGER,
    scheduled_time TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        cq.id AS queue_id,
        cq.user_id,
        cq.template_id,
        cq.priority,
        cq.scheduled_time
    FROM 
        call_queue cq
    WHERE 
        cq.status = 'pending'
        AND (cq.scheduled_time IS NULL OR cq.scheduled_time <= CURRENT_TIMESTAMP)
    ORDER BY 
        cq.priority ASC,
        cq.created_at ASC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Function to get the best available provider
CREATE OR REPLACE FUNCTION get_best_available_provider()
RETURNS UUID AS $$
DECLARE
    selected_provider_id UUID;
BEGIN
    SELECT 
        csp.id INTO selected_provider_id
    FROM 
        call_service_providers csp
    JOIN 
        provider_availability pa ON csp.id = pa.provider_id
    WHERE 
        csp.is_active = TRUE
        AND pa.current_calls < csp.max_concurrent_calls
        AND pa.status = 'online'
    ORDER BY 
        -- First by available capacity
        (csp.max_concurrent_calls - pa.current_calls) DESC,
        -- Then by provider priority
        csp.priority ASC
    LIMIT 1;
    
    RETURN selected_provider_id;
END;
$$ LANGUAGE plpgsql;

-- Function to assign a call to a provider
CREATE OR REPLACE FUNCTION assign_call_to_provider(queue_id_param UUID, provider_id_param UUID)
RETURNS BOOLEAN AS $$
DECLARE
    success BOOLEAN := FALSE;
BEGIN
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

-- Function to complete a call and update statistics
CREATE OR REPLACE FUNCTION complete_call(
    queue_id_param UUID,
    call_status_param TEXT,
    duration_param INTEGER,
    recording_url_param TEXT DEFAULT NULL,
    transcript_param TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    call_record_id UUID;
    queue_record RECORD;
    provider_id_var UUID;
BEGIN
    -- Get the queue record
    SELECT * INTO queue_record FROM call_queue WHERE id = queue_id_param;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Queue record not found';
    END IF;
    
    provider_id_var := queue_record.provider_id;
    
    -- Create call history record
    INSERT INTO call_history (
        user_id,
        template_id,
        call_start,
        call_end,
        duration,
        recipient_name,
        recipient_phone,
        recipient_email,
        recording_url,
        transcript,
        call_status,
        provider_id,
        provider_call_id,
        queue_id,
        metadata
    ) VALUES (
        queue_record.user_id,
        queue_record.template_id,
        CURRENT_TIMESTAMP - (duration_param || ' seconds')::INTERVAL,
        CURRENT_TIMESTAMP,
        duration_param,
        queue_record.recipient_name,
        queue_record.recipient_phone,
        queue_record.recipient_email,
        recording_url_param,
        transcript_param,
        call_status_param,
        provider_id_var,
        queue_record.provider_call_id,
        queue_id_param,
        queue_record.metadata
    )
    RETURNING id INTO call_record_id;
    
    -- Update call queue status
    UPDATE call_queue
    SET status = 'completed'
    WHERE id = queue_id_param;
    
    -- Update provider availability
    UPDATE provider_availability
    SET current_calls = GREATEST(0, current_calls - 1)
    WHERE provider_id = provider_id_var;
    
    -- Update call assignment
    UPDATE call_assignments
    SET assignment_status = 'completed'
    WHERE queue_id = queue_id_param AND assignment_status = 'assigned';
    
    -- Update user call usage
    UPDATE user_call_usage
    SET 
        calls_used = calls_used + 1,
        minutes_used = minutes_used + CEILING(duration_param / 60.0),
        calls_remaining = GREATEST(0, calls_remaining - 1),
        minutes_remaining = GREATEST(0, minutes_remaining - CEILING(duration_param / 60.0)),
        last_updated = CURRENT_TIMESTAMP
    WHERE 
        user_id = queue_record.user_id
        AND current_timestamp BETWEEN billing_period_start AND billing_period_end;
    
    RETURN call_record_id;
END;
$$ LANGUAGE plpgsql;

-- Function to handle failed calls
CREATE OR REPLACE FUNCTION handle_failed_call(
    queue_id_param UUID,
    error_message TEXT,
    retry BOOLEAN DEFAULT TRUE
)
RETURNS BOOLEAN AS $$
DECLARE
    queue_record RECORD;
    max_retries INTEGER := 3; -- Configurable
    provider_id_var UUID;
BEGIN
    -- Get the queue record
    SELECT * INTO queue_record FROM call_queue WHERE id = queue_id_param;
    
    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;
    
    provider_id_var := queue_record.provider_id;
    
    -- Update provider availability
    IF provider_id_var IS NOT NULL THEN
        UPDATE provider_availability
        SET current_calls = GREATEST(0, current_calls - 1)
        WHERE provider_id = provider_id_var;
        
        -- Update call assignment
        UPDATE call_assignments
        SET 
            assignment_status = 'failed',
            provider_response = jsonb_build_object('error', error_message)
        WHERE 
            queue_id = queue_id_param 
            AND assignment_status = 'assigned';
    END IF;
    
    -- Check if we should retry
    IF retry AND queue_record.attempt_count < max_retries THEN
        -- Schedule a retry
        UPDATE call_queue
        SET 
            status = 'pending',
            provider_id = NULL,
            provider_call_id = NULL
        WHERE id = queue_id_param;
        
        -- Insert or update retry record
        INSERT INTO call_retries (
            queue_id,
            retry_count,
            last_error,
            last_provider_id,
            next_retry_time
        ) VALUES (
            queue_id_param,
            1,
            error_message,
            provider_id_var,
            CURRENT_TIMESTAMP + INTERVAL '5 minutes'
        )
        ON CONFLICT (queue_id)
        DO UPDATE SET
            retry_count = call_retries.retry_count + 1,
            last_error = error_message,
            last_provider_id = provider_id_var,
            next_retry_time = CURRENT_TIMESTAMP + (POWER(2, call_retries.retry_count) * INTERVAL '1 minute')
        ;
        
        RETURN TRUE;
    ELSE
        -- Mark as failed permanently
        UPDATE call_queue
        SET status = 'failed'
        WHERE id = queue_id_param;
        
        RETURN FALSE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to schedule a call
CREATE OR REPLACE FUNCTION schedule_call(
    user_id_param UUID,
    template_id_param UUID,
    recipient_name_param TEXT,
    recipient_phone_param TEXT,
    recipient_email_param TEXT,
    scheduled_time_param TIMESTAMP WITH TIME ZONE,
    priority_param INTEGER DEFAULT 5,
    custom_variables_param JSONB DEFAULT NULL,
    metadata_param JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
    new_queue_id UUID;
BEGIN
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
        metadata
    ) VALUES (
        user_id_param,
        template_id_param,
        recipient_name_param,
        recipient_phone_param,
        recipient_email_param,
        scheduled_time_param,
        priority_param,
        'pending',
        custom_variables_param,
        metadata_param
    )
    RETURNING id INTO new_queue_id;
    
    RETURN new_queue_id;
END;
$$ LANGUAGE plpgsql;
