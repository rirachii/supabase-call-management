const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Provider API clients
const vapiClient = require('./providers/vapi-client');
const synthflowClient = require('./providers/synthflow-client');

// Get the provider client based on provider type
function getProviderClient(providerType) {
  switch (providerType.toLowerCase()) {
    case 'vapi':
      return vapiClient;
    case 'synthflow':
      return synthflowClient;
    default:
      throw new Error(`Unsupported provider type: ${providerType}`);
  }
}

// Process the next call in the queue
async function processNextCall() {
  try {
    // Start a transaction
    const { data: nextCall, error: nextCallError } = await supabase.rpc('get_next_call_in_queue');
    
    if (nextCallError) {
      console.error('Error getting next call:', nextCallError);
      return false;
    }
    
    if (!nextCall || nextCall.length === 0) {
      console.log('No calls in the queue');
      return false;
    }
    
    // Get the best available provider
    const { data: providerId, error: providerError } = await supabase.rpc('get_best_available_provider');
    
    if (providerError || !providerId) {
      console.error('Error getting provider or no providers available:', providerError);
      return false;
    }
    
    // Assign the call to the provider
    const { data: assigned, error: assignError } = await supabase.rpc('assign_call_to_provider', {
      queue_id_param: nextCall[0].queue_id,
      provider_id_param: providerId
    });
    
    if (assignError || !assigned) {
      console.error('Error assigning call to provider:', assignError);
      return false;
    }
    
    // Get call details
    const { data: callDetails, error: callDetailsError } = await supabase
      .from('call_queue')
      .select(`
        id,
        template_id,
        recipient_name,
        recipient_phone,
        recipient_email,
        custom_variables,
        metadata,
        provider_id
      `)
      .eq('id', nextCall[0].queue_id)
      .single();
    
    if (callDetailsError) {
      console.error('Error getting call details:', callDetailsError);
      await handleFailure(nextCall[0].queue_id, 'Failed to retrieve call details');
      return false;
    }
    
    // Get provider details
    const { data: providerDetails, error: providerDetailsError } = await supabase
      .from('call_service_providers')
      .select('*')
      .eq('id', providerId)
      .single();
    
    if (providerDetailsError) {
      console.error('Error getting provider details:', providerDetailsError);
      await handleFailure(nextCall[0].queue_id, 'Failed to retrieve provider details');
      return false;
    }
    
    // Get template details
    const { data: templateDetails, error: templateDetailsError } = await supabase
      .from('call_templates')
      .select('*')
      .eq('id', callDetails.template_id)
      .single();
    
    if (templateDetailsError) {
      console.error('Error getting template details:', templateDetailsError);
      await handleFailure(nextCall[0].queue_id, 'Failed to retrieve template details');
      return false;
    }
    
    // Initialize the appropriate provider client
    const providerClient = getProviderClient(providerDetails.provider_type);
    providerClient.configure({
      apiKey: providerDetails.api_key,
      apiSecret: providerDetails.api_secret,
      baseUrl: providerDetails.base_url,
      ...providerDetails.configuration
    });
    
    // Process variables in the template
    let processedTemplate = templateDetails.content;
    if (callDetails.custom_variables) {
      Object.entries(callDetails.custom_variables).forEach(([key, value]) => {
        processedTemplate = processedTemplate.replace(new RegExp(`{{${key}}}`, 'g'), value);
      });
    }
    
    // Make the call using the provider
    try {
      const callResult = await providerClient.makeCall({
        recipient: {
          name: callDetails.recipient_name,
          phone: callDetails.recipient_phone,
          email: callDetails.recipient_email
        },
        template: processedTemplate,
        metadata: callDetails.metadata || {}
      });
      
      // Update the call with the provider's call ID
      await supabase
        .from('call_queue')
        .update({ provider_call_id: callResult.callId })
        .eq('id', nextCall[0].queue_id);
      
      console.log(`Call initiated successfully. Provider call ID: ${callResult.callId}`);
      return true;
    } catch (error) {
      console.error('Error making call with provider:', error);
      await handleFailure(nextCall[0].queue_id, `Provider error: ${error.message}`);
      return false;
    }
  } catch (error) {
    console.error('Unexpected error in processNextCall:', error);
    return false;
  }
}

// Handle a failed call
async function handleFailure(queueId, errorMessage) {
  try {
    const { error } = await supabase.rpc('handle_failed_call', {
      queue_id_param: queueId,
      error_message: errorMessage,
      retry: true
    });
    
    if (error) {
      console.error('Error handling failed call:', error);
    }
  } catch (error) {
    console.error('Unexpected error in handleFailure:', error);
  }
}

// Webhook handler for call completion
async function handleCallCompletion(req, res) {
  const { queueId, status, duration, recordingUrl, transcript } = req.body;
  
  try {
    const { data, error } = await supabase.rpc('complete_call', {
      queue_id_param: queueId,
      call_status_param: status,
      duration_param: duration,
      recording_url_param: recordingUrl,
      transcript_param: transcript
    });
    
    if (error) {
      console.error('Error completing call:', error);
      return res.status(500).json({ error: error.message });
    }
    
    return res.status(200).json({ success: true, callHistoryId: data });
  } catch (error) {
    console.error('Unexpected error in handleCallCompletion:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Main processing loop
async function processQueue() {
  let processed = 0;
  let maxToProcess = 10; // Process up to 10 calls per batch
  
  while (processed < maxToProcess) {
    const success = await processNextCall();
    if (!success) {
      break;
    }
    processed++;
  }
  
  console.log(`Processed ${processed} calls`);
  
  // Schedule the next run
  setTimeout(processQueue, 5000); // Run every 5 seconds
}

// Update provider availability
async function updateProviderAvailability() {
  try {
    const { data: providers, error } = await supabase
      .from('call_service_providers')
      .select('*')
      .eq('is_active', true);
    
    if (error) {
      console.error('Error fetching providers:', error);
      return;
    }
    
    for (const provider of providers) {
      const providerClient = getProviderClient(provider.provider_type);
      providerClient.configure({
        apiKey: provider.api_key,
        apiSecret: provider.api_secret,
        baseUrl: provider.base_url,
        ...provider.configuration
      });
      
      try {
        // Get health status from the provider
        const healthStatus = await providerClient.checkHealth();
        
        // Get current active calls from the provider
        const activeCallsCount = await providerClient.getActiveCallsCount();
        
        // Update the provider availability
        await supabase
          .from('provider_availability')
          .update({
            current_calls: activeCallsCount,
            available_slots: provider.max_concurrent_calls - activeCallsCount,
            status: healthStatus.status,
            health_status: healthStatus,
            last_health_check: new Date().toISOString()
          })
          .eq('provider_id', provider.id);
        
      } catch (error) {
        console.error(`Error updating provider ${provider.name} availability:`, error);
        
        // Mark the provider as degraded or offline
        await supabase
          .from('provider_availability')
          .update({
            status: 'degraded',
            health_status: { error: error.message },
            last_health_check: new Date().toISOString()
          })
          .eq('provider_id', provider.id);
      }
    }
  } catch (error) {
    console.error('Unexpected error in updateProviderAvailability:', error);
  }
  
  // Schedule the next update
  setTimeout(updateProviderAvailability, 60000); // Run every minute
}

// Process scheduled calls that need to be moved to pending
async function processScheduledCalls() {
  try {
    const now = new Date().toISOString();
    
    // Find scheduled calls that are due
    const { data, error } = await supabase
      .from('call_queue')
      .update({ scheduled_time: null, status: 'pending' })
      .eq('status', 'pending')
      .lt('scheduled_time', now)
      .is('provider_id', null);
    
    if (error) {
      console.error('Error processing scheduled calls:', error);
    } else if (data && data.length > 0) {
      console.log(`Moved ${data.length} scheduled calls to pending queue`);
    }
  } catch (error) {
    console.error('Unexpected error in processScheduledCalls:', error);
  }
  
  // Schedule the next check
  setTimeout(processScheduledCalls, 30000); // Run every 30 seconds
}

// Check for stalled calls
async function checkStalledCalls() {
  try {
    const stalledTimeout = new Date();
    stalledTimeout.setMinutes(stalledTimeout.getMinutes() - 30); // Calls processing for more than 30 minutes
    
    // Find stalled calls
    const { data: stalledCalls, error } = await supabase
      .from('call_queue')
      .select('id, provider_id')
      .eq('status', 'processing')
      .lt('last_attempt', stalledTimeout.toISOString());
    
    if (error) {
      console.error('Error checking for stalled calls:', error);
      return;
    }
    
    // Handle each stalled call
    for (const call of stalledCalls || []) {
      await handleFailure(
        call.id, 
        'Call processing timed out after 30 minutes'
      );
    }
    
    if (stalledCalls && stalledCalls.length > 0) {
      console.log(`Reset ${stalledCalls.length} stalled calls`);
    }
  } catch (error) {
    console.error('Unexpected error in checkStalledCalls:', error);
  }
  
  // Schedule the next check
  setTimeout(checkStalledCalls, 300000); // Run every 5 minutes
}

// Start all processes
function startProcessing() {
  // Initialize health check for all providers
  updateProviderAvailability();
  
  // Start processing scheduled calls
  processScheduledCalls();
  
  // Start checking for stalled calls
  checkStalledCalls();
  
  // Start the main queue processor
  processQueue();
  
  console.log('Call queue processor started');
}

// If this file is run directly (not imported), start processing
if (require.main === module) {
  startProcessing();
}

// Export functions for use in other files (e.g., webhook handlers)
module.exports = {
  handleCallCompletion,
  startProcessing
};
