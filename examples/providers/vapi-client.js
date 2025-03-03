/**
 * Client implementation for Vapi service
 * https://vapi.ai/
 */

const axios = require('axios');

class VapiClient {
  constructor() {
    this.config = {
      apiKey: null,
      apiSecret: null,
      baseUrl: 'https://api.vapi.ai',
      timeout: 30000,
    };
  }

  /**
   * Configure the client
   * @param {Object} config Configuration options
   */
  configure(config) {
    this.config = { ...this.config, ...config };
    
    this.axiosInstance = axios.create({
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Check the health of the Vapi service
   * @returns {Object} Health status
   */
  async checkHealth() {
    try {
      const response = await this.axiosInstance.get('/health');
      return {
        status: response.data.status === 'OK' ? 'online' : 'degraded',
        latency: response.data.latency,
        timestamp: new Date().toISOString(),
        details: response.data
      };
    } catch (error) {
      console.error('Vapi health check failed:', error.message);
      return {
        status: 'offline',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get count of active calls
   * @returns {Number} Number of active calls
   */
  async getActiveCallsCount() {
    try {
      const response = await this.axiosInstance.get('/v1/calls', {
        params: {
          status: 'in-progress',
          limit: 1 // We only need the count, not the actual calls
        }
      });
      
      return response.data.meta.total || 0;
    } catch (error) {
      console.error('Failed to get active calls count from Vapi:', error.message);
      throw error;
    }
  }

  /**
   * Fetch all available assistants
   * @returns {Array} List of assistants
   */
  async getAssistants() {
    try {
      const response = await this.axiosInstance.get('/v1/assistants');
      
      return response.data.assistants.map(assistant => ({
        assistant_id: assistant.id,
        assistant_name: assistant.name,
        description: assistant.description || null,
        created_at: assistant.created_at,
        updated_at: assistant.updated_at,
        voice_id: assistant.voice_id || 'echo'
      }));
    } catch (error) {
      console.error('Failed to get assistants from Vapi:', error.message);
      throw error;
    }
  }

  /**
   * Fetch all available phone numbers
   * @returns {Array} List of phone numbers
   */
  async getPhoneNumbers() {
    try {
      const response = await this.axiosInstance.get('/v1/phone-numbers');
      
      return response.data.phone_numbers.map(phone => {
        // Parse the phone number to extract country code, area code, etc.
        const fullNumber = phone.phone_number;
        let countryCode = '+1'; // Default to US
        let areaCode = '';
        let phoneNumber = '';
        
        // Basic parsing for US numbers (adjust as needed)
        if (fullNumber.startsWith('+')) {
          const parts = fullNumber.substring(1).match(/(\d+)(\d{3})(\d+)/);
          if (parts && parts.length >= 4) {
            countryCode = '+' + parts[1];
            areaCode = parts[2];
            phoneNumber = parts[3];
          }
        }
        
        return {
          phone_id: phone.id,
          full_number: fullNumber,
          country_code: countryCode,
          area_code: areaCode,
          phone_number: phoneNumber,
          capabilities: phone.capabilities || {},
          status: phone.status
        };
      });
    } catch (error) {
      console.error('Failed to get phone numbers from Vapi:', error.message);
      throw error;
    }
  }

  /**
   * Make a call using Vapi
   * @param {Object} callParams Call parameters
   * @returns {Object} Call result with ID
   */
  async makeCall({ 
    recipient, 
    template, 
    metadata = {},
    assistantId = null,
    phoneNumberId = null,
    variableValues = {}
  }) {
    try {
      if (!recipient.phone) {
        throw new Error('Recipient phone number is required');
      }

      // Process template with variables
      let processedTemplate = template;
      if (variableValues && Object.keys(variableValues).length > 0) {
        Object.entries(variableValues).forEach(([key, value]) => {
          processedTemplate = processedTemplate.replace(new RegExp(`{{${key}}}`, 'g'), value);
        });
      }

      // Prepare request payload
      const payload = {
        recipient: {
          phone_number: recipient.phone
        },
        assistant: {
          // Use provided assistant ID or default to the one in metadata
          assistant_id: assistantId || metadata.assistant_id,
          first_name: recipient.name ? recipient.name.split(' ')[0] : 'User',
          last_name: recipient.name ? recipient.name.split(' ').slice(1).join(' ') : '',
        },
        assistant_options: {
          prompt: processedTemplate,
          interruptions_enabled: true,
          endpointing_sensitivity: metadata.endpointing_sensitivity || 'medium',
          server_call_metadata: {
            ...metadata,
            system_call_id: metadata.call_id || null,
            variable_values: variableValues
          }
        },
        record: true,
        transcribe: true,
        webhook_url: metadata.webhook_url || null
      };

      // If a phone number ID is provided, use it
      if (phoneNumberId) {
        payload.phone_number_id = phoneNumberId;
      }

      const response = await this.axiosInstance.post('/v1/calls', payload);

      return {
        success: true,
        callId: response.data.id,
        status: response.data.status,
        provider: 'vapi',
        assistantId: response.data.assistant.assistant_id,
        phoneNumberId: response.data.phone_number_id,
        providerData: response.data
      };
    } catch (error) {
      console.error('Vapi call initiation failed:', error.message);
      
      if (error.response) {
        throw new Error(`Vapi error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      }
      
      throw error;
    }
  }

  /**
   * Get status of a call
   * @param {String} callId Call ID
   * @returns {Object} Call status details
   */
  async getCallStatus(callId) {
    try {
      const response = await this.axiosInstance.get(`/v1/calls/${callId}`);
      
      return {
        callId: response.data.id,
        status: this.mapStatus(response.data.status),
        duration: response.data.duration,
        recordingUrl: response.data.recording_url,
        transcript: response.data.transcript,
        assistantId: response.data.assistant?.assistant_id,
        phoneNumberId: response.data.phone_number_id,
        rawStatus: response.data
      };
    } catch (error) {
      console.error(`Failed to get call status from Vapi for call ${callId}:`, error.message);
      throw error;
    }
  }

  /**
   * End an active call
   * @param {String} callId Call ID
   * @returns {Boolean} Success status
   */
  async endCall(callId) {
    try {
      await this.axiosInstance.post(`/v1/calls/${callId}/end`);
      return true;
    } catch (error) {
      console.error(`Failed to end Vapi call ${callId}:`, error.message);
      throw error;
    }
  }

  /**
   * Map Vapi status to our standard status
   * @param {String} vapiStatus Status from Vapi
   * @returns {String} Standardized status
   */
  mapStatus(vapiStatus) {
    const statusMap = {
      'queued': 'pending',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'failed': 'failed',
      'canceled': 'canceled'
    };
    
    return statusMap[vapiStatus] || vapiStatus;
  }
}

// Export a singleton instance
module.exports = new VapiClient();
