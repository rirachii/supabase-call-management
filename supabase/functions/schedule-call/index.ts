// Follow this setup guide to integrate the Deno Edge Functions:
// https://deno.com/deploy/docs/supabase-functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Edge function to schedule a call through the system
 */
serve(async (req: Request) => {
  // Create a Supabase client with the Auth context of the function
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if this request has authorization
  const authorization = req.headers.get('Authorization');
  if (!authorization) {
    return new Response(
      JSON.stringify({ error: "Authorization required" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    // Get the JWT token from the Authorization header
    const token = authorization.replace('Bearer ', '');
    
    // Get the user ID from the token
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid authorization token" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Get the request body
    const { 
      templateId,
      recipientName,
      recipientPhone,
      recipientEmail,
      scheduledTime = null,
      priority = 5,
      customVariables = {},
      metadata = {},
      assistantId = null,
      phoneNumberId = null
    } = await req.json();
    
    // Validate required fields
    if (!templateId || !recipientPhone) {
      return new Response(
        JSON.stringify({ error: "Template ID and recipient phone are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Verify the template exists and the user has access to it
    const { data: template, error: templateError } = await supabase
      .from("call_templates")
      .select("id, provider_id, assistant_id")
      .eq("id", templateId)
      .or(`is_public.eq.true,created_by.eq.${user.id}`)
      .single();
    
    if (templateError || !template) {
      return new Response(
        JSON.stringify({ error: "Template not found or not accessible" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Check if the user has an active subscription
    const { data: subscription, error: subscriptionError } = await supabase
      .from("user_subscriptions")
      .select(`
        id,
        plan_id,
        subscription_plans (
          call_limit,
          minutes_limit
        )
      `)
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("current_period_end", { ascending: false })
      .limit(1)
      .single();
    
    if (subscriptionError || !subscription) {
      return new Response(
        JSON.stringify({ error: "No active subscription found" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Check if the user has exceeded their call limit
    const { data: usage, error: usageError } = await supabase
      .from("user_call_usage")
      .select("calls_used, calls_remaining")
      .eq("user_id", user.id)
      .eq("subscription_id", subscription.id)
      .single();
    
    if (usageError) {
      console.error("Error fetching user call usage:", usageError);
      return new Response(
        JSON.stringify({ error: "Failed to check call usage" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    if (usage && usage.calls_remaining <= 0) {
      return new Response(
        JSON.stringify({ 
          error: "Call limit exceeded", 
          details: {
            used: usage.calls_used,
            remaining: usage.calls_remaining,
            limit: subscription.subscription_plans.call_limit
          }
        }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Format the scheduled time if provided
    let parsedScheduledTime = null;
    if (scheduledTime) {
      parsedScheduledTime = new Date(scheduledTime).toISOString();
      
      // Ensure the scheduled time is in the future
      if (new Date(parsedScheduledTime) <= new Date()) {
        return new Response(
          JSON.stringify({ error: "Scheduled time must be in the future" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
    }
    
    // Validate assistant ID if provided
    let validatedAssistantId = assistantId || template.assistant_id || null;
    if (validatedAssistantId) {
      const { data: assistant, error: assistantError } = await supabase
        .from("provider_assistants")
        .select("id")
        .eq("id", validatedAssistantId)
        .eq("is_active", true)
        .single();
      
      if (assistantError || !assistant) {
        console.warn("Invalid or inactive assistant ID:", validatedAssistantId);
        validatedAssistantId = null;
      }
    }
    
    // Validate phone number ID if provided
    let validatedPhoneNumberId = phoneNumberId || null;
    if (validatedPhoneNumberId) {
      const { data: phoneNumber, error: phoneNumberError } = await supabase
        .from("provider_phone_numbers")
        .select("id")
        .eq("id", validatedPhoneNumberId)
        .eq("is_active", true)
        .single();
      
      if (phoneNumberError || !phoneNumber) {
        console.warn("Invalid or inactive phone number ID:", validatedPhoneNumberId);
        validatedPhoneNumberId = null;
      }
    }
    
    // Get template variables for validation
    const { data: templateVariables, error: templateVariablesError } = await supabase
      .from("template_variables")
      .select("*")
      .eq("template_id", templateId);
    
    if (templateVariablesError) {
      console.warn("Could not get template variables:", templateVariablesError);
    }
    
    // Validate required variables
    const validationErrors = [];
    if (templateVariables && templateVariables.length > 0) {
      templateVariables.forEach(variable => {
        // Check if required variables are present
        if (variable.is_required && (!customVariables || !customVariables[variable.variable_name])) {
          validationErrors.push(`Required variable '${variable.variable_name}' (${variable.display_name}) is missing`);
        }
        
        // Check regex validation if specified
        if (customVariables && 
            customVariables[variable.variable_name] && 
            variable.validation_regex) {
          const regex = new RegExp(variable.validation_regex);
          if (!regex.test(customVariables[variable.variable_name])) {
            validationErrors.push(`Variable '${variable.variable_name}' (${variable.display_name}) failed validation`);
          }
        }
      });
    }
    
    if (validationErrors.length > 0) {
      return new Response(
        JSON.stringify({ 
          error: "Variable validation failed", 
          details: validationErrors
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Schedule the call
    const { data: queueId, error: scheduleError } = await supabase.rpc('schedule_call', {
      user_id_param: user.id,
      template_id_param: templateId,
      recipient_name_param: recipientName,
      recipient_phone_param: recipientPhone,
      recipient_email_param: recipientEmail,
      scheduled_time_param: parsedScheduledTime,
      priority_param: priority,
      custom_variables_param: customVariables,
      metadata_param: metadata,
      assistant_id_param: validatedAssistantId,
      phone_number_id_param: validatedPhoneNumberId
    });
    
    if (scheduleError || !queueId) {
      console.error("Error scheduling call:", scheduleError);
      return new Response(
        JSON.stringify({ error: "Failed to schedule call" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Get assistant and phone number details for the response
    let assistantDetails = null;
    let phoneNumberDetails = null;
    
    if (validatedAssistantId) {
      const { data: assistant } = await supabase
        .from("provider_assistants")
        .select("assistant_name, assistant_id")
        .eq("id", validatedAssistantId)
        .single();
      
      if (assistant) {
        assistantDetails = {
          id: validatedAssistantId,
          name: assistant.assistant_name,
          assistantId: assistant.assistant_id
        };
      }
    }
    
    if (validatedPhoneNumberId) {
      const { data: phoneNumber } = await supabase
        .from("provider_phone_numbers")
        .select("area_code")
        .eq("id", validatedPhoneNumberId)
        .single();
      
      if (phoneNumber) {
        phoneNumberDetails = {
          id: validatedPhoneNumberId,
          areaCode: phoneNumber.area_code
        };
      }
    }
    
    // Prepare variables info for response
    let variablesInfo = null;
    if (templateVariables && templateVariables.length > 0 && customVariables) {
      variablesInfo = templateVariables.map(variable => ({
        name: variable.variable_name,
        displayName: variable.display_name,
        value: customVariables[variable.variable_name] || null
      }));
    }
    
    return new Response(
      JSON.stringify({
        success: true,
        id: queueId,
        scheduled: parsedScheduledTime ? true : false,
        scheduledTime: parsedScheduledTime,
        recipient: {
          name: recipientName,
          phone: recipientPhone,
          email: recipientEmail
        },
        template: {
          id: templateId
        },
        assistant: assistantDetails,
        phoneNumber: phoneNumberDetails,
        variables: variablesInfo,
        message: parsedScheduledTime 
          ? "Call scheduled successfully" 
          : "Call queued for immediate processing"
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing schedule call request:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
