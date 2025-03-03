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
    const { planId, successUrl, cancelUrl } = await req.json();
    
    if (!planId || !successUrl || !cancelUrl) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters: planId, successUrl, cancelUrl" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Get the subscription plan details
    const { data: plan, error: planError } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', planId)
      .single();
    
    if (planError || !plan) {
      return new Response(
        JSON.stringify({ error: "Plan not found" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }
    
    // Get or create the Stripe customer ID
    let customerId = await getOrCreateStripeCustomer(user);
    
    // Create the checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: plan.stripe_price_id, // You'll need to add this field to the subscription_plans table
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        user_id: user.id,
        plan_id: planId
      },
      subscription_data: {
        metadata: {
          user_id: user.id,
          plan_id: planId
        }
      }
    });
    
    return new Response(
      JSON.stringify({ 
        sessionId: session.id,
        url: session.url
      }),
      { 
        status: 200, 
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    console.error('Error creating checkout session:', error);
    
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { 
        status: 500, 
        headers: { "Content-Type": "application/json" }
      }
    );
  }
});

/**
 * Get or create a Stripe customer for the user
 */
async function getOrCreateStripeCustomer(user) {
  // Try to find the user's Stripe customer ID
  const { data: userData, error: userError } = await supabase
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();
  
  if (userError) {
    console.error('Error finding user:', userError);
    throw new Error('Error finding user');
  }
  
  // If the user already has a Stripe customer ID, return it
  if (userData.stripe_customer_id) {
    return userData.stripe_customer_id;
  }
  
  // Otherwise, create a new Stripe customer
  try {
    const customer = await stripe.customers.create({
      email: user.email,
      name: user.user_metadata?.full_name,
      metadata: {
        supabase_id: user.id
      }
    });
    
    // Save the Stripe customer ID to the user's record
    const { error: updateError } = await supabase
      .from('users')
      .update({ stripe_customer_id: customer.id })
      .eq('id', user.id);
    
    if (updateError) {
      console.error('Error updating user with Stripe customer ID:', updateError);
      throw new Error('Error updating user');
    }
    
    return customer.id;
  } catch (error) {
    console.error('Error creating Stripe customer:', error);
    throw new Error('Error creating Stripe customer');
  }
}
