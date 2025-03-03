/**
 * Client implementation for SynthFlow service
 * Note: This is a fictional example since SynthFlow is not a real service.
 * This shows how the abstraction layer works with different providers.
 */

const axios = require('axios');

class SynthFlowClient {
  constructor() {
    this.config = {
      apiKey: null,
      apiSecret: null,
      baseUrl: 'https://api.synthflow.ai',
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
        'X-API-Key': this.config.apiKey,
        'X-API-Secret': this.config.apiSecret,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Check the health of the SynthFlow service
   * @returns {Object} Health status
   */
  async checkHealth() {
    try {
      const response = await this.axiosInstance.get('/api/system/status');
      return {
        status: response.data.healthy ? 'online' : 'degraded',
        latency: response.data.responseTime,
        capacity: response.data.capacity,
        timestamp: new Date().toISOString(),
        details: response.data
      };
    } catch (error) {
      console.error('SynthFlow health check failed:', error.message);
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
      const response = await this.axiosInstance.get('/api/calls/active/count');
      return response.data.count || 0;
    } catch (error) {
      console.error('Failed to get active calls count from SynthFlow:', error.message);
      throw error;
    }
  }

  /**
   * Make a call using SynthFlow
   * @param {Object} callParams Call parameters
   * @returns {Object} Call result with ID
   */
  async makeCall({ recipient, template, metadata = {} }) {
    try {
      if (!recipient.phone) {
        throw new Error('Recipient phone number is required');
      }

      // SynthFlow API has a different structure than Vapi
      const response = await this.axiosInstance.post('/api/calls', {
        destination: {
          phoneNumber: recipient.phone,
          contactName: recipient.name || 'User',
          email: recipient.email || null
        },
        conversation: {
          scriptContent: template,
          voiceType: metadata.voice_type || 'natural',
          language: metadata.language || 'en-US',
          allowInterruptions: true
        },
        settings: {
          recordCall: true,
          generateTranscription: true,
          callbackUrl: metadata.webhook_url || null,
          maxDuration: metadata.max_duration || 600, // 10 minutes default
          fallbackMessage: metadata.fallback_message || null
        },
        metadata: {
          ...metadata,
          externalId: metadata.call_id || null
        }
      });

      return {
        success: true,
        callId: response.data.callId,
        status: this.mapStatus(response.data.status),
        provider: 'synthflow',
        providerData: response.data
      };
    } catch (error) {
      console.error('SynthFlow call initiation failed:', error.message);
      
      if (error.response) {
        throw new Error(`SynthFlow error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
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
      const response = await this.axiosInstance.get(`/api/calls/${callId}`);
      
      return {
        callId: response.data.callId,
        status: this.mapStatus(response.data.status),
        duration: response.data.durationSeconds,
        recordingUrl: response.data.recording ? response.data.recording.url : null,
        transcript: response.data.transcription ? response.data.transcription.text : null,
        rawStatus: response.data
      };
    } catch (error) {
      console.error(`Failed to get call status from SynthFlow for call ${callId}:`, error.message);
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
      await this.axiosInstance.post(`/api/calls/${callId}/terminate`);
      return true;
    } catch (error) {
      console.error(`Failed to end SynthFlow call ${callId}:`, error.message);
      throw error;
    }
  }

  /**
   * Map SynthFlow status to our standard status
   * @param {String} synthFlowStatus Status from SynthFlow
   * @returns {String} Standardized status
   */
  mapStatus(synthFlowStatus) {
    const statusMap = {
      'QUEUED': 'pending',
      'CONNECTING': 'pending',
      'IN_PROGRESS': 'in-progress',
      'CONNECTED': 'in-progress',
      'COMPLETED': 'completed',
      'FAILED': 'failed',
      'ERROR': 'failed',
      'CANCELLED': 'canceled',
      'NO_ANSWER': 'failed'
    };
    
    return statusMap[synthFlowStatus] || 'unknown';
  }
}

// Export a singleton instance
module.exports = new SynthFlowClient();
