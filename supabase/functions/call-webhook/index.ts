// Follow this setup guide to integrate the Deno Edge Functions:
// https://deno.com/deploy/docs/supabase-functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

interface VapiWebhook {
  call_id: string;
  status: string;
  duration: number;
  recording_url?: string;
  transcript?: string;
  metadata?: {
    system_call_id?: string;
  };
}

interface SynthFlowWebhook {
  callId: string;
  status: string;
  durationSeconds: number;
  recording?: {
    url: string;
  };
  transcription?: {
    text: string;
  };
  metadata?: {
    externalId?: string;
  };
}

serve(async (req: Request) => {
  try {
    // Create a Supabase client with the Auth context of the function
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the webhook body
    const body = await req.json();
    
    // Determine the provider type from the payload structure
    const provider = determineProvider(body);
    
    // Extract standardized data based on provider
    const { 
      queueId, 
      status, 
      duration, 
      recordingUrl, 
      transcript 
    } = extractStandardData(body, provider);
    
    if (!queueId) {
      console.error("No queue ID found in webhook payload:", body);
      return new Response(
        JSON.stringify({ error: "No queue ID found in webhook payload" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Find the queue record
    const { data: queueRecord, error: queueError } = await supabase
      .from("call_queue")
      .select("id, provider_id")
      .eq("id", queueId)
      .single();
    
    if (queueError || !queueRecord) {
      console.error("Queue record not found:", queueError);
      return new Response(
        JSON.stringify({ error: "Queue record not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Process the webhook based on status
    if (status === "completed" || status === "failed" || status === "canceled") {
      // Complete the call in the database
      const { data, error } = await supabase.rpc("complete_call", {
        queue_id_param: queueId,
        call_status_param: status,
        duration_param: duration,
        recording_url_param: recordingUrl,
        transcript_param: transcript
      });
      
      if (error) {
        console.error("Error completing call:", error);
        return new Response(
          JSON.stringify({ error: "Failed to process call completion" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Call processed successfully",
          callHistoryId: data 
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      // For other statuses, just log the event
      console.log(`Call ${queueId} status update: ${status}`);
      
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "Status update received",
          status: status
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error processing webhook:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});

/**
 * Determine the provider type from the webhook payload structure
 */
function determineProvider(body: any): string {
  if (body.call_id !== undefined) {
    return "vapi";
  } else if (body.callId !== undefined) {
    return "synthflow";
  } else {
    console.warn("Unknown provider format:", body);
    return "unknown";
  }
}

/**
 * Extract standardized data from provider-specific webhook payloads
 */
function extractStandardData(
  body: VapiWebhook | SynthFlowWebhook | any,
  provider: string
): {
  queueId: string | null;
  status: string;
  duration: number;
  recordingUrl: string | null;
  transcript: string | null;
} {
  if (provider === "vapi") {
    const vapiBody = body as VapiWebhook;
    
    // Map Vapi status to our standard status
    const statusMap: Record<string, string> = {
      'queued': 'pending',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'failed': 'failed',
      'canceled': 'canceled'
    };
    
    return {
      queueId: vapiBody.metadata?.system_call_id || null,
      status: statusMap[vapiBody.status] || vapiBody.status,
      duration: vapiBody.duration || 0,
      recordingUrl: vapiBody.recording_url || null,
      transcript: vapiBody.transcript || null
    };
  } 
  else if (provider === "synthflow") {
    const synthFlowBody = body as SynthFlowWebhook;
    
    // Map SynthFlow status to our standard status
    const statusMap: Record<string, string> = {
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
    
    return {
      queueId: synthFlowBody.metadata?.externalId || null,
      status: statusMap[synthFlowBody.status] || 'unknown',
      duration: synthFlowBody.durationSeconds || 0,
      recordingUrl: synthFlowBody.recording?.url || null,
      transcript: synthFlowBody.transcription?.text || null
    };
  }
  else {
    // Unknown provider format, try to extract data in a generic way
    console.warn("Using generic data extraction for unknown provider");
    
    return {
      queueId: body.metadata?.system_call_id || body.metadata?.externalId || null,
      status: body.status || 'unknown',
      duration: body.duration || body.durationSeconds || 0,
      recordingUrl: body.recording_url || (body.recording?.url) || null,
      transcript: body.transcript || (body.transcription?.text) || null
    };
  }
}
