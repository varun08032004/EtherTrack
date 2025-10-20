import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './LiveRates.css';

const API_KEY = 'db-aWnnXVih9Hp8nVBGRNvyEHhDtYaaE';

const LiveRates = () => {
  const [ethUsd, setEthUsd] = useState('0.00');
  const [ethInr, setEthInr] = useState('0.00');
  const [ethChange, setEthChange] = useState(0);

  const [euaPrice, setEuaPrice] = useState(null);
  const [euaPrev, setEuaPrev] = useState(null);
  const [euaChange, setEuaChange] = useState(0);
  const [euaVolume, setEuaVolume] = useState(0);

  const fetchEth = async () => {
    try {
      const res = await axios.get(
        'https://api.coingecko.com/api/v3/simple/price',
        { params: { ids: 'ethereum', vs_currencies: 'usd,inr', include_24hr_change: true } }
      );
      setEthUsd(res.data.ethereum.usd.toFixed(2));
      setEthInr(res.data.ethereum.inr.toFixed(2));
      setEthChange(res.data.ethereum.usd_24h_change.toFixed(2));
    } catch (e) {
      console.error('ETH fetch error:', e);
    }
  };

  const fetchEua = async () => {
    try {
      const res = await axios.get('https://api.databento.com/v0/passthrough/get', {
        headers: { 'X-Api-Key': API_KEY },
        params: {
          dataset: 'NDEX.IMPACT',
          schema: 'mbp-1',
          symbols: 'ECF',           // continuous EUA futures
          stype_in: 'raw_symbol',
          limit: 2                   // fetch last 2 ticks
        }
      });

      const [latest, prev] = res.data;
      const px = latest.px / 10000;
      setEuaPrice(px.toFixed(2));
      setEuaPrev(prev?.px / 10000);
      setEuaChange(((px - (prev?.px / 10000)) / (prev?.px / 10000) * 100).toFixed(2));
      setEuaVolume(latest.v || 0);
    } catch (e) {
      console.error('EUA fetch error:', e);
    }
  };

  useEffect(() => {
    fetchEth();
    fetchEua();
    const iv = setInterval(() => { fetchEth(); fetchEua(); }, 30000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="ticker-wrapper">
      <div className="ticker-strip">
        {/* ETH Info */}
        <span>
          📈 ETH/USD:&nbsp;
          <span className={ethChange >= 0 ? 'rate-up' : 'rate-down'}>
            ${ethUsd} ({ethChange >= 0 ? `+${ethChange}%` : `${ethChange}%`})
          </span>
        </span>
        &nbsp;|&nbsp;
        <span>💰 ETH/INR: ₹{ethInr}</span>

        {/* EUA Info */}
        {euaPrice && (
          <>
            &nbsp;|&nbsp;
            <span className={euaChange >= 0 ? 'rate-up' : 'rate-down'}>
              🏛 EUA: €{euaPrice}/tCO₂e ({euaChange >= 0 ? `+${euaChange}%` : `${euaChange}%`})
            </span>
            &nbsp;|&nbsp;
            <span>🔊 Vol: {euaVolume}</span>
          </>
        )}
      </div>
    </div>
  );
};

export default LiveRates;
