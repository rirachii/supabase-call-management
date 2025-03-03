import React, { useState, useEffect } from 'react';
import { getSubscriptionPlans, getActiveSubscription, initiateCheckout, manageSubscription } from './stripe-helpers';

function SubscriptionPlans() {
  const [plans, setPlans] = useState([]);
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        
        // Load subscription plans
        const plansData = await getSubscriptionPlans();
        setPlans(plansData);
        
        // Load active subscription
        const subscription = await getActiveSubscription();
        setActiveSubscription(subscription);
        
        setLoading(false);
      } catch (err) {
        setError('Failed to load subscription data');
        setLoading(false);
        console.error(err);
      }
    }
    
    loadData();
  }, []);

  const handleSubscribe = async (planId) => {
    try {
      // Define URLs for success and cancel pages
      const successUrl = `${window.location.origin}/subscription/success`;
      const cancelUrl = `${window.location.origin}/subscription/cancel`;
      
      // Redirect to Stripe Checkout
      await initiateCheckout(planId, successUrl, cancelUrl);
    } catch (err) {
      setError('Failed to initiate checkout');
      console.error(err);
    }
  };

  const handleManageSubscription = async () => {
    try {
      // Define URL to return to after managing subscription
      const returnUrl = window.location.href;
      
      // Redirect to Stripe Customer Portal
      await manageSubscription(returnUrl);
    } catch (err) {
      setError('Failed to open customer portal');
      console.error(err);
    }
  };

  if (loading) {
    return <div className="text-center p-8">Loading subscription plans...</div>;
  }

  if (error) {
    return <div className="text-red-500 p-8">{error}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-center mb-10">Subscription Plans</h1>
      
      {activeSubscription && (
        <div className="bg-blue-50 p-6 rounded-lg mb-8">
          <h2 className="text-xl font-semibold mb-2">Your Current Subscription</h2>
          <p className="mb-1"><span className="font-medium">Plan:</span> {activeSubscription.plan_name}</p>
          <p className="mb-1"><span className="font-medium">Status:</span> {activeSubscription.status}</p>
          <p className="mb-1"><span className="font-medium">Renews:</span> {new Date(activeSubscription.current_period_end).toLocaleDateString()}</p>
          <p className="mb-1"><span className="font-medium">Calls used:</span> {activeSubscription.calls_used} / {activeSubscription.plan_call_limit}</p>
          <p className="mb-1"><span className="font-medium">Minutes used:</span> {activeSubscription.minutes_used} / {activeSubscription.plan_minutes_limit}</p>
          
          <button
            onClick={handleManageSubscription}
            className="mt-4 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
          >
            Manage Subscription
          </button>
          
          {activeSubscription.cancel_at_period_end && (
            <div className="mt-4 text-orange-600">
              Your subscription will end on {new Date(activeSubscription.current_period_end).toLocaleDateString()}.
            </div>
          )}
        </div>
      )}
      
      <div className="grid md:grid-cols-3 gap-8">
        {plans.map((plan) => (
          <div key={plan.id} className="border rounded-lg overflow-hidden shadow-sm hover:shadow-md transition-shadow">
            <div className="bg-gray-50 p-6 border-b">
              <h2 className="text-2xl font-bold">{plan.name}</h2>
              <p className="text-3xl font-bold mt-2">
                ${plan.price.toFixed(2)}
                <span className="text-sm font-normal text-gray-500">/{plan.interval}</span>
              </p>
            </div>
            
            <div className="p-6">
              <p className="text-gray-600 mb-6">{plan.description}</p>
              
              <ul className="space-y-2 mb-6">
                {plan.features && Array.isArray(plan.features) && plan.features.map((feature, index) => (
                  <li key={index} className="flex items-start">
                    <svg className="h-5 w-5 text-green-500 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              
              {activeSubscription && activeSubscription.plan_id === plan.id ? (
                <button
                  disabled
                  className="w-full bg-gray-300 text-gray-700 px-4 py-2 rounded cursor-not-allowed"
                >
                  Current Plan
                </button>
              ) : (
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  className="w-full bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                >
                  {activeSubscription ? 'Change Plan' : 'Subscribe'}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default SubscriptionPlans;
