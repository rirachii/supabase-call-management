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

// This is your Stripe webhook secret for testing your endpoint locally.
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET') || '';

serve(async (request) => {
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return new Response('No signature provided', { status: 400 });
  }

  try {
    const body = await request.text();
    
    // Verify the event came from Stripe
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        body,
        signature,
        webhookSecret
      );
    } catch (err) {
      console.error(`Webhook signature verification failed: ${err.message}`);
      return new Response(`Webhook signature verification failed: ${err.message}`, { status: 400 });
    }

    // Handle specific event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        // Process the checkout session
        await handleCheckoutSession(session);
        break;
      }
      
      case 'customer.subscription.created': {
        const subscription = event.data.object;
        // Process new subscription
        await handleSubscriptionCreated(subscription);
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        // Process subscription update
        await handleSubscriptionUpdated(subscription);
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        // Process subscription cancellation
        await handleSubscriptionCanceled(subscription);
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        // Process successful payment
        await handlePaymentSucceeded(invoice);
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        // Process failed payment
        await handlePaymentFailed(invoice);
        break;
      }
      
      default: {
        console.log(`Unhandled event type: ${event.type}`);
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(`Webhook Error: ${error.message}`, {
      status: 500,
    });
  }
});

/**
 * Handle checkout.session.completed event
 * This is triggered when a customer completes the checkout process
 */
async function handleCheckoutSession(session) {
  try {
    // Get the Stripe subscription ID from the session
    const subscriptionId = session.subscription;
    if (!subscriptionId) return;

    // Get the subscription details from Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    // Get the Stripe customer ID
    const customerId = session.customer;
    
    // Find the Supabase user ID associated with this Stripe customer
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();
    
    if (userError || !userData) {
      console.error('Error finding user with Stripe customer ID:', userError);
      return;
    }
    
    // Get the plan ID from the subscription
    const planId = subscription.items.data[0].price.product;
    
    // Find the corresponding plan in Supabase
    const { data: planData, error: planError } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('stripe_product_id', planId)
      .single();
    
    if (planError || !planData) {
      console.error('Error finding subscription plan:', planError);
      return;
    }
    
    // Create or update the user subscription
    await createOrUpdateSubscription(
      userData.id,
      planData.id,
      subscription,
      customerId
    );
  } catch (error) {
    console.error('Error handling checkout session:', error);
  }
}

/**
 * Handle customer.subscription.created event
 */
async function handleSubscriptionCreated(subscription) {
  try {
    // Get the Stripe customer ID
    const customerId = subscription.customer;
    
    // Find the Supabase user ID associated with this Stripe customer
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();
    
    if (userError || !userData) {
      console.error('Error finding user with Stripe customer ID:', userError);
      return;
    }
    
    // Get the plan ID from the subscription
    const planId = subscription.items.data[0].price.product;
    
    // Find the corresponding plan in Supabase
    const { data: planData, error: planError } = await supabase
      .from('subscription_plans')
      .select('id, call_limit, minutes_limit')
      .eq('stripe_product_id', planId)
      .single();
    
    if (planError || !planData) {
      console.error('Error finding subscription plan:', planError);
      return;
    }
    
    // Create the user subscription
    const { data: subscriptionData, error: subscriptionError } = await createOrUpdateSubscription(
      userData.id,
      planData.id,
      subscription,
      customerId
    );
    
    if (subscriptionError || !subscriptionData) {
      console.error('Error creating subscription:', subscriptionError);
      return;
    }
    
    // Initialize call usage for this subscription
    await supabase
      .from('user_call_usage')
      .insert({
        user_id: userData.id,
        subscription_id: subscriptionData.id,
        billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
        billing_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        calls_used: 0,
        minutes_used: 0,
        calls_remaining: planData.call_limit,
        minutes_remaining: planData.minutes_limit
      });
  } catch (error) {
    console.error('Error handling subscription created:', error);
  }
}

/**
 * Handle customer.subscription.updated event
 */
async function handleSubscriptionUpdated(subscription) {
  try {
    // Get the Stripe customer ID
    const customerId = subscription.customer;
    
    // Find the Supabase user ID associated with this Stripe customer
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_customer_id', customerId)
      .single();
    
    if (userError || !userData) {
      console.error('Error finding user with Stripe customer ID:', userError);
      return;
    }
    
    // Get the plan ID from the subscription
    const planId = subscription.items.data[0].price.product;
    
    // Find the corresponding plan in Supabase
    const { data: planData, error: planError } = await supabase
      .from('subscription_plans')
      .select('id')
      .eq('stripe_product_id', planId)
      .single();
    
    if (planError || !planData) {
      console.error('Error finding subscription plan:', planError);
      return;
    }
    
    // Update the user subscription
    await createOrUpdateSubscription(
      userData.id,
      planData.id,
      subscription,
      customerId
    );
  } catch (error) {
    console.error('Error handling subscription updated:', error);
  }
}

/**
 * Handle customer.subscription.deleted event
 */
async function handleSubscriptionCanceled(subscription) {
  try {
    // Find the Supabase subscription by Stripe subscription ID
    const { data, error } = await supabase
      .from('user_subscriptions')
      .update({
        status: 'canceled',
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', subscription.id);
    
    if (error) {
      console.error('Error updating canceled subscription:', error);
    }
  } catch (error) {
    console.error('Error handling subscription canceled:', error);
  }
}

/**
 * Handle invoice.payment_succeeded event
 */
async function handlePaymentSucceeded(invoice) {
  try {
    if (!invoice.subscription) return;
    
    // Get the subscription details
    const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
    
    // Find the Supabase subscription by Stripe subscription ID
    const { data: subscriptionData, error: subscriptionError } = await supabase
      .from('user_subscriptions')
      .select('id, user_id, plan_id')
      .eq('subscription_id', invoice.subscription)
      .single();
    
    if (subscriptionError || !subscriptionData) {
      console.error('Error finding subscription:', subscriptionError);
      return;
    }
    
    // Get plan details
    const { data: planData, error: planError } = await supabase
      .from('subscription_plans')
      .select('call_limit, minutes_limit')
      .eq('id', subscriptionData.plan_id)
      .single();
    
    if (planError || !planData) {
      console.error('Error finding plan:', planError);
      return;
    }
    
    // Check if this is for a new billing period
    if (invoice.billing_reason === 'subscription_cycle') {
      // Update the call usage for the new billing period
      const { data: existingUsage, error: usageError } = await supabase
        .from('user_call_usage')
        .select('id')
        .eq('user_id', subscriptionData.user_id)
        .eq('subscription_id', subscriptionData.id)
        .gte('billing_period_end', new Date().toISOString())
        .single();
      
      if (usageError || !existingUsage) {
        // Create a new usage record for the new billing period
        await supabase
          .from('user_call_usage')
          .insert({
            user_id: subscriptionData.user_id,
            subscription_id: subscriptionData.id,
            billing_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            billing_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            calls_used: 0,
            minutes_used: 0,
            calls_remaining: planData.call_limit,
            minutes_remaining: planData.minutes_limit
          });
      }
    }
  } catch (error) {
    console.error('Error handling payment succeeded:', error);
  }
}

/**
 * Handle invoice.payment_failed event
 */
async function handlePaymentFailed(invoice) {
  try {
    if (!invoice.subscription) return;
    
    // Find the Supabase subscription by Stripe subscription ID
    const { data, error } = await supabase
      .from('user_subscriptions')
      .update({
        status: 'past_due',
        updated_at: new Date().toISOString()
      })
      .eq('subscription_id', invoice.subscription);
    
    if (error) {
      console.error('Error updating subscription status to past_due:', error);
    }
  } catch (error) {
    console.error('Error handling payment failed:', error);
  }
}

/**
 * Create or update a user subscription
 */
async function createOrUpdateSubscription(userId, planId, stripeSubscription, customerId) {
  // Map Stripe status to our status
  const statusMap = {
    'active': 'active',
    'trialing': 'trialing',
    'past_due': 'past_due',
    'canceled': 'canceled',
    'unpaid': 'past_due',
    'incomplete': 'pending',
    'incomplete_expired': 'canceled'
  };
  
  const status = statusMap[stripeSubscription.status] || 'active';
  
  // Check if subscription already exists
  const { data: existingSubscription, error: findError } = await supabase
    .from('user_subscriptions')
    .select('id')
    .eq('subscription_id', stripeSubscription.id)
    .single();
  
  if (findError && findError.code !== 'PGRST116') {
    console.error('Error checking for existing subscription:', findError);
    throw findError;
  }
  
  // Prepare subscription data
  const subscriptionData = {
    user_id: userId,
    plan_id: planId,
    status: status,
    current_period_start: new Date(stripeSubscription.current_period_start * 1000).toISOString(),
    current_period_end: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
    cancel_at_period_end: stripeSubscription.cancel_at_period_end,
    subscription_id: stripeSubscription.id,
    payment_method: { customer_id: customerId },
    updated_at: new Date().toISOString()
  };
  
  if (existingSubscription) {
    // Update existing subscription
    const { data, error } = await supabase
      .from('user_subscriptions')
      .update(subscriptionData)
      .eq('id', existingSubscription.id)
      .select()
      .single();
    
    if (error) {
      console.error('Error updating subscription:', error);
      throw error;
    }
    
    return data;
  } else {
    // Create new subscription
    const { data, error } = await supabase
      .from('user_subscriptions')
      .insert({
        ...subscriptionData,
        created_at: new Date().toISOString()
      })
      .select()
      .single();
    
    if (error) {
      console.error('Error creating subscription:', error);
      throw error;
    }
    
    return data;
  }
}
