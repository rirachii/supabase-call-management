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
        provider_id,
        assistant_id,
        phone_number_id
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
      .eq('id', callDetails.provider_id)
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
    
    // Get assistant details if specified
    let assistantDetails = null;
    if (callDetails.assistant_id) {
      const { data, error } = await supabase
        .from('provider_assistants')
        .select('*')
        .eq('id', callDetails.assistant_id)
        .single();
      
      if (!error) {
        assistantDetails = data;
      } else {
        console.warn('Could not get assistant details:', error);
      }
    }
    
    // Get phone number details if specified
    let phoneNumberDetails = null;
    if (callDetails.phone_number_id) {
      const { data, error } = await supabase
        .from('provider_phone_numbers')
        .select('*')
        .eq('id', callDetails.phone_number_id)
        .single();
      
      if (!error) {
        phoneNumberDetails = data;
      } else {
        console.warn('Could not get phone number details:', error);
      }
    }
    
    // Get template variables
    const { data: templateVariables, error: templateVariablesError } = await supabase
      .from('template_variables')
      .select('*')
      .eq('template_id', callDetails.template_id);
    
    if (templateVariablesError) {
      console.warn('Could not get template variables:', templateVariablesError);
    }
    
    // Validate custom variables
    let validationErrors = [];
    if (templateVariables && templateVariables.length > 0) {
      templateVariables.forEach(variable => {
        // Check if required variables are present
        if (variable.is_required && (!callDetails.custom_variables || !callDetails.custom_variables[variable.variable_name])) {
          validationErrors.push(`Required variable '${variable.variable_name}' is missing`);
        }
        
        // Check regex validation if specified
        if (callDetails.custom_variables && 
            callDetails.custom_variables[variable.variable_name] && 
            variable.validation_regex) {
          const regex = new RegExp(variable.validation_regex);
          if (!regex.test(callDetails.custom_variables[variable.variable_name])) {
            validationErrors.push(`Variable '${variable.variable_name}' failed validation`);
          }
        }
      });
    }
    
    if (validationErrors.length > 0) {
      console.error('Variable validation errors:', validationErrors);
      await handleFailure(nextCall[0].queue_id, `Variable validation errors: ${validationErrors.join(', ')}`);
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
    
    // Make the call using the provider
    try {
      // Prepare additional parameters based on provider type
      let additionalParams = {};
      
      if (providerDetails.provider_type === 'vapi') {
        // For Vapi, include assistant ID and phone number ID
        if (assistantDetails) {
          additionalParams.assistantId = assistantDetails.assistant_id;
        }
        
        if (phoneNumberDetails) {
          additionalParams.phoneNumberId = phoneNumberDetails.phone_id;
        }
        
        // Include variable values
        additionalParams.variableValues = callDetails.custom_variables || {};
      } 
      else if (providerDetails.provider_type === 'synthflow') {
        // For SynthFlow, adapt parameters as needed
        additionalParams.voiceType = assistantDetails ? assistantDetails.default_voice_id : 'natural';
        additionalParams.callerId = phoneNumberDetails ? phoneNumberDetails.full_number : null;
        additionalParams.variables = callDetails.custom_variables || {};
      }
      
      const callResult = await providerClient.makeCall({
        recipient: {
          name: callDetails.recipient_name,
          phone: callDetails.recipient_phone,
          email: callDetails.recipient_email
        },
        template: templateDetails.content,
        metadata: {
          ...callDetails.metadata || {},
          call_id: callDetails.id,
          template_id: callDetails.template_id,
          assistant_id: callDetails.assistant_id,
          phone_number_id: callDetails.phone_number_id,
          webhook_url: process.env.WEBHOOK_BASE_URL ? `${process.env.WEBHOOK_BASE_URL}/call-webhook` : null
        },
        ...additionalParams
      });
      
      // Update the call with the provider's call ID
      await supabase
        .from('call_queue')
        .update({ provider_call_id: callResult.callId })
        .eq('id', nextCall[0].queue_id);
      
      console.log(`Call initiated successfully. Provider: ${providerDetails.provider_type}, Call ID: ${callResult.callId}`);
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

// Sync assistants and phone numbers from providers
async function syncProviderResources() {
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
      
      // Sync assistants if the provider supports it
      if (typeof providerClient.getAssistants === 'function') {
        try {
          const assistants = await providerClient.getAssistants();
          
          // Process each assistant
          for (const assistant of assistants) {
            // Check if the assistant already exists
            const { data: existingAssistant } = await supabase
              .from('provider_assistants')
              .select('id')
              .eq('provider_id', provider.id)
              .eq('assistant_id', assistant.assistant_id)
              .single();
            
            if (existingAssistant) {
              // Update existing assistant
              await supabase
                .from('provider_assistants')
                .update({
                  assistant_name: assistant.assistant_name,
                  description: assistant.description,
                  default_voice_id: assistant.voice_id,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingAssistant.id);
            } else {
              // Insert new assistant
              await supabase
                .from('provider_assistants')
                .insert({
                  provider_id: provider.id,
                  assistant_name: assistant.assistant_name,
                  assistant_id: assistant.assistant_id,
                  description: assistant.description,
                  default_voice_id: assistant.voice_id,
                  is_active: true
                });
            }
          }
          
          console.log(`Synced ${assistants.length} assistants for provider ${provider.name}`);
        } catch (error) {
          console.error(`Error syncing assistants for provider ${provider.name}:`, error);
        }
      }
      
      // Sync phone numbers if the provider supports it
      if (typeof providerClient.getPhoneNumbers === 'function') {
        try {
          const phoneNumbers = await providerClient.getPhoneNumbers();
          
          // Process each phone number
          for (const phone of phoneNumbers) {
            // Check if the phone number already exists
            const { data: existingPhone } = await supabase
              .from('provider_phone_numbers')
              .select('id')
              .eq('provider_id', provider.id)
              .eq('phone_id', phone.phone_id)
              .single();
            
            if (existingPhone) {
              // Update existing phone number
              await supabase
                .from('provider_phone_numbers')
                .update({
                  country_code: phone.country_code,
                  area_code: phone.area_code,
                  phone_number: phone.phone_number,
                  full_number: phone.full_number,
                  is_active: phone.status === 'active',
                  capabilities: phone.capabilities,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingPhone.id);
            } else {
              // Insert new phone number
              await supabase
                .from('provider_phone_numbers')
                .insert({
                  provider_id: provider.id,
                  phone_id: phone.phone_id,
                  country_code: phone.country_code,
                  area_code: phone.area_code,
                  phone_number: phone.phone_number,
                  full_number: phone.full_number,
                  is_active: phone.status === 'active',
                  capabilities: phone.capabilities
                });
            }
          }
          
          console.log(`Synced ${phoneNumbers.length} phone numbers for provider ${provider.name}`);
        } catch (error) {
          console.error(`Error syncing phone numbers for provider ${provider.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Unexpected error in syncProviderResources:', error);
  }
  
  // Schedule the next sync
  setTimeout(syncProviderResources, 3600000); // Run every hour
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
  
  // Sync provider resources (assistants and phone numbers)
  syncProviderResources();
  
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
  startProcessing,
  syncProviderResources
};
