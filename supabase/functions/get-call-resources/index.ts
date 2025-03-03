// Follow this setup guide to integrate the Deno Edge Functions:
// https://deno.com/deploy/docs/supabase-functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Edge function to get available assistants and phone numbers
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
    
    // Get query parameters
    const url = new URL(req.url);
    const templateId = url.searchParams.get('templateId');
    const providerType = url.searchParams.get('providerType');
    
    // Prepare response data
    const result: {
      assistants: any[];
      phoneNumbers: any[];
      templateDetails?: any;
      templateVariables?: any[];
    } = {
      assistants: [],
      phoneNumbers: [],
    };
    
    // If a template ID was provided, get template details and variables
    if (templateId) {
      // Get template details
      const { data: template, error: templateError } = await supabase
        .from("call_templates")
        .select(`
          id, 
          name, 
          description, 
          provider_id, 
          assistant_id,
          provider:provider_id (
            id,
            name,
            provider_type
          )
        `)
        .eq("id", templateId)
        .or(`is_public.eq.true,created_by.eq.${user.id}`)
        .single();
      
      if (templateError || !template) {
        return new Response(
          JSON.stringify({ error: "Template not found or not accessible" }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }
      
      result.templateDetails = {
        id: template.id,
        name: template.name,
        description: template.description,
        assistantId: template.assistant_id,
        provider: template.provider
      };
      
      // Get template variables
      const { data: variables, error: varsError } = await supabase
        .from("template_variables")
        .select("*")
        .eq("template_id", templateId)
        .order("variable_name", { ascending: true });
      
      if (!varsError && variables) {
        result.templateVariables = variables.map(variable => ({
          name: variable.variable_name,
          displayName: variable.display_name,
          description: variable.description,
          required: variable.is_required,
          defaultValue: variable.default_value,
          validationRegex: variable.validation_regex
        }));
      }
    }
    
    // Get available assistants
    const { data: assistantsData, error: assistantsError } = await supabase.rpc(
      'get_available_assistants',
      providerType ? { provider_type_param: providerType } : {}
    );
    
    if (!assistantsError && assistantsData) {
      result.assistants = assistantsData.map(assistant => ({
        id: assistant.id,
        name: assistant.assistant_name,
        assistantId: assistant.assistant_id,
        description: assistant.description,
        provider: {
          id: assistant.provider_id,
          name: assistant.provider_name,
          type: assistant.provider_type
        }
      }));
    } else {
      console.warn("Error getting assistants:", assistantsError);
    }
    
    // Get available phone numbers
    const { data: phoneNumbersData, error: phoneNumbersError } = await supabase.rpc(
      'get_available_phone_numbers',
      providerType ? { provider_type_param: providerType } : {}
    );
    
    if (!phoneNumbersError && phoneNumbersData) {
      result.phoneNumbers = phoneNumbersData.map(phone => ({
        id: phone.id,
        areaCode: phone.area_code,
        phoneId: phone.phone_id,
        provider: {
          id: phone.provider_id,
          name: phone.provider_name,
          type: phone.provider_type
        }
      }));
    } else {
      console.warn("Error getting phone numbers:", phoneNumbersError);
    }
    
    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing get call resources request:", error);
    
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
