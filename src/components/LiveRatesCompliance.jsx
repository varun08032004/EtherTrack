// LiveRatesCompliance.jsx
import React, { useEffect, useState } from 'react';
import axios from 'axios';

const LiveRatesCompliance = ({ apiKey }) => {
  const [euaPrice, setEuaPrice] = useState(null);

  useEffect(() => {
    const fetchEUA = async () => {
      try {
        const res = await axios.get('https://api.databento.com/v1/livedatasets', {
          params: {
            dataset: 'ICE.ENDX.ECF', // Replace with actual EUA futures dataset name
            limit: 1
          },
          headers: {
            'X-Api-Key': apiKey
          }
        });

        const latest = res.data.data[0];
        setEuaPrice(latest.close.toFixed(2));
      } catch (err) {
        console.error('Databento error:', err);
      }
    };

    fetchEUA();
    const timer = setInterval(fetchEUA, 30000);
    return () => clearInterval(timer);
  }, [apiKey]);

  return euaPrice != null ? (
    <span className="rate-up">
      🏛 EUA (Compliance): €{euaPrice}/tCO₂e
    </span>
  ) : (
    <span>Loading EUA...</span>
  );
};

export default LiveRatesCompliance;
