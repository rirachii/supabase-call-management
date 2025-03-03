// Follow this setup guide to integrate the Deno Edge Functions:
// https://deno.com/deploy/docs/supabase-functions
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from 'https://esm.sh/stripe@12.0.0?target=deno';

// Initialize Stripe with your secret key
const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY') || '', {
  // This is needed to use the Fetch API instead of Node.js http
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

// Supabase client setup
const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

serve(async (req: Request) => {
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

    // Get request body
    const { returnUrl } = await req.json();
    
    if (!returnUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required parameter: returnUrl" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Get the user's Stripe customer ID
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .single();
    
    if (userError || !userData || !userData.stripe_customer_id) {
      return new Response(
        JSON.stringify({ error: "User doesn't have a Stripe customer ID" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Create a Stripe customer portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: userData.stripe_customer_id,
      return_url: returnUrl,
    });
    
    return new Response(
      JSON.stringify({ 
        url: portalSession.url
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    console.error('Error creating portal session:', error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});
