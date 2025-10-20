import React, { useEffect, useRef } from 'react';
import './TradingView.css';

const TradingView = ({ symbol = 'CARBON/USD' }) => {
    const chartContainerRef = useRef(null);

    useEffect(() => {
        // Ensure the DOM is fully loaded before executing the script
        if (chartContainerRef.current) {
            const script = document.createElement('script');
            script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
            script.type = 'text/javascript';
            script.async = true;
            script.innerHTML = JSON.stringify({
                symbol: symbol,
                interval: "60",
                theme: "light",
                style: "1",
                locale: "en",
                hide_side_toolbar: false,
                allow_symbol_change: true,
                save_image: false,
                calendar: false,
                support_host: "https://www.tradingview.com"
            });

            chartContainerRef.current.appendChild(script);
        }

        // Cleanup the script when the component unmounts
        return () => {
            if (chartContainerRef.current) {
                chartContainerRef.current.innerHTML = ''; // Clear the container
            }
        };
    }, [symbol]);  // Dependency array includes symbol to refresh when it changes

    return (
        <div className="trading-view">
            <h2>Trading View</h2>
            <div ref={chartContainerRef} className="chart-container"></div>
        </div>
    );
};

export default TradingView;
