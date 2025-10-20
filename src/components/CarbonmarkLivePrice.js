import React, { useEffect, useState } from 'react';
import axios from 'axios';
import './CarbonmarkLivePrice.css'; // You can style it like your LiveRates

const CarbonmarkLivePrice = () => {
  const [price, setPrice] = useState(null);

  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const response = await axios.get('https://v16.api.carbonmark.com/quotes/latest', {
          headers: {
            'X-API-Key': 'your_actual_sandbox_key_here' // replace with your actual key
          }
        });

        if (response.data?.price) {
          setPrice(parseFloat(response.data.price).toFixed(2));
        }
      } catch (err) {
        console.error('Failed to fetch Carbonmark price:', err);
      }
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 30000); // refresh every 30s

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="carbonmark-price-box">
      🌍 <strong>Carbon Credit Price:</strong>{' '}
      {price ? (
        <span className="carbon-price">${price} /tCO₂</span>
      ) : (
        'Loading...'
      )}
    </div>
  );
};

export default CarbonmarkLivePrice;
