/**
 * Helper functions for integrating Stripe payments on the frontend
 */

import { createClient } from '@supabase/supabase-js';
import { loadStripe } from '@stripe/stripe-js';

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Initialize Stripe
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY);

/**
 * Redirects the user to the Stripe Checkout page for a subscription
 * @param {string} planId - The ID of the subscription plan
 * @param {string} successUrl - URL to redirect to after successful payment
 * @param {string} cancelUrl - URL to redirect to if the user cancels
 */
export async function initiateCheckout(planId, successUrl, cancelUrl) {
  try {
    // Get the user's session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('You must be logged in to subscribe');
    }
    
    // Call the Edge Function to create a checkout session
    const { data, error } = await fetch(
      `${supabaseUrl}/functions/v1/create-checkout`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          planId,
          successUrl,
          cancelUrl
        })
      }
    ).then(r => r.json());
    
    if (error) {
      throw new Error(error);
    }
    
    // Redirect to the Stripe Checkout page
    window.location.href = data.url;
    
  } catch (error) {
    console.error('Error creating checkout session:', error);
    throw error;
  }
}

/**
 * Redirects the user to the Stripe Customer Portal
 * @param {string} returnUrl - URL to return to after managing subscription
 */
export async function manageSubscription(returnUrl) {
  try {
    // Get the user's session
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session) {
      throw new Error('You must be logged in to manage your subscription');
    }
    
    // Call the Edge Function to create a portal session
    const { data, error } = await fetch(
      `${supabaseUrl}/functions/v1/create-portal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          returnUrl
        })
      }
    ).then(r => r.json());
    
    if (error) {
      throw new Error(error);
    }
    
    // Redirect to the Stripe Customer Portal
    window.location.href = data.url;
    
  } catch (error) {
    console.error('Error creating portal session:', error);
    throw error;
  }
}

/**
 * Gets the user's active subscription details
 * @returns {Promise<Object>} The user's active subscription
 */
export async function getActiveSubscription() {
  try {
    const { data, error } = await supabase.rpc('get_user_subscription');
    
    if (error) {
      console.error('Error getting subscription:', error);
      return null;
    }
    
    return data;
  } catch (error) {
    console.error('Error getting subscription:', error);
    return null;
  }
}

/**
 * Gets all available subscription plans
 * @returns {Promise<Array>} Array of subscription plans
 */
export async function getSubscriptionPlans() {
  try {
    const { data, error } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('active', true)
      .order('price', { ascending: true });
    
    if (error) {
      console.error('Error getting plans:', error);
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('Error getting plans:', error);
    return [];
  }
}

/**
 * Gets the user's invoices
 * @param {number} limit - Maximum number of invoices to return
 * @returns {Promise<Array>} Array of invoices
 */
export async function getUserInvoices(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('subscription_invoices')
      .select('*')
      .order('invoice_date', { ascending: false })
      .limit(limit);
    
    if (error) {
      console.error('Error getting invoices:', error);
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('Error getting invoices:', error);
    return [];
  }
}

/**
 * Gets the user's payment methods
 * @returns {Promise<Array>} Array of payment methods
 */
export async function getPaymentMethods() {
  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .order('is_default', { ascending: false });
    
    if (error) {
      console.error('Error getting payment methods:', error);
      return [];
    }
    
    return data;
  } catch (error) {
    console.error('Error getting payment methods:', error);
    return [];
  }
}

/**
 * Cancel the user's subscription
 * @param {string} subscriptionId - The ID of the subscription to cancel
 * @param {boolean} atPeriodEnd - Whether to cancel at the end of the billing period
 * @returns {Promise<boolean>} Whether the cancellation was successful
 */
export async function cancelSubscription(subscriptionId, atPeriodEnd = true) {
  try {
    const { data, error } = await supabase.rpc('cancel_subscription', {
      subscription_id_param: subscriptionId,
      cancel_at_period_end_param: atPeriodEnd
    });
    
    if (error) {
      console.error('Error canceling subscription:', error);
      return false;
    }
    
    return data;
  } catch (error) {
    console.error('Error canceling subscription:', error);
    return false;
  }
}
