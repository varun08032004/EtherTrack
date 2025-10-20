import { useState, useEffect } from 'react';

const useLivePrice = () => {
    const [priceInUSD, setPriceInUSD] = useState(null);
    const [priceInINR, setPriceInINR] = useState(null);
    const [priceInETH, setPriceInETH] = useState(null);

    useEffect(() => {
        const fetchPrices = async () => {
            const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,inr,eth');
            const data = await res.json();
            setPriceInUSD(data.ethereum.usd);
            setPriceInINR(data.ethereum.inr);
            setPriceInETH(1); // Since 1 ETH = 1 ETH
        };

        fetchPrices();
        const interval = setInterval(fetchPrices, 30000); // Refresh every 30 seconds

        return () => clearInterval(interval);
    }, []);

    return { priceInUSD, priceInINR, priceInETH };
};
