import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js';

// Load your publishable key from your environment
const stripePromise = loadStripe('your-publishable-key-here');

const CheckoutForm = () => {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  
  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!stripe || !elements) return;

    setLoading(true);

    const cardElement = elements.getElement(CardElement);

    const { error, paymentMethod } = await stripe.createPaymentMethod({
      type: 'card',
      card: cardElement,
    });

    if (error) {
      console.error(error);
      setLoading(false);
    } else {
      // Send paymentMethod.id to your backend for further processing
      // Example: const response = await fetch('/your-backend-endpoint', { method: 'POST', body: JSON.stringify(paymentMethod) });

      // Simulating successful payment
      setPaymentSuccess(true);
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <h2>Payment Details</h2>
      <CardElement />
      <button type="submit" disabled={loading || !stripe}>
        {loading ? 'Processing...' : 'Pay Now'}
      </button>

      {paymentSuccess && <div>Payment Successful!</div>}
    </form>
  );
};

const StripeCheckout = () => {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm />
    </Elements>
  );
};

export default StripeCheckout;
