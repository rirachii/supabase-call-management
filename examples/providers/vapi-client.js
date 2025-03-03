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
   * Make a call using Vapi
   * @param {Object} callParams Call parameters
   * @returns {Object} Call result with ID
   */
  async makeCall({ recipient, template, metadata = {} }) {
    try {
      if (!recipient.phone) {
        throw new Error('Recipient phone number is required');
      }

      const response = await this.axiosInstance.post('/v1/calls', {
        recipient: {
          phone_number: recipient.phone
        },
        assistant: {
          voice_id: metadata.voice_id || 'echo', // Default to Echo voice
          first_name: recipient.name ? recipient.name.split(' ')[0] : 'User',
          last_name: recipient.name ? recipient.name.split(' ').slice(1).join(' ') : '',
        },
        assistant_options: {
          prompt: template,
          interruptions_enabled: true,
          endpointing_sensitivity: metadata.endpointing_sensitivity || 'medium',
          server_call_metadata: {
            ...metadata,
            system_call_id: metadata.call_id || null
          }
        },
        record: true,
        transcribe: true,
        webhook_url: metadata.webhook_url || null
      });

      return {
        success: true,
        callId: response.data.id,
        status: response.data.status,
        provider: 'vapi',
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
