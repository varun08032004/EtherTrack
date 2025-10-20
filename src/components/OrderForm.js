import React, { useState, useEffect } from 'react';
import './OrderForm.css';

const OrderForm = ({ onPlaceOrder }) => {
    const [orderType, setOrderType] = useState('Market');
    const [actionType, setActionType] = useState('Buy');
    const [amount, setAmount] = useState('');
    const [limitPrice, setLimitPrice] = useState('');
    const [stopPrice, setStopPrice] = useState('');
    const [currency, setCurrency] = useState('USD');  // Default currency to USD
    const [ethToUsd, setEthToUsd] = useState(null);
    const [usdToInr, setUsdToInr] = useState(null);
    const [carbonCreditPrice, setCarbonCreditPrice] = useState(null); // Carbon credit price
    const [totalPrice, setTotalPrice] = useState(0);

    useEffect(() => {
        // Fetch live prices for ETH to USD, USD to INR and Carbon Credit Price
        const fetchPrices = async () => {
            try {
                const ethPriceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
                const ethPriceData = await ethPriceResponse.json();
                setEthToUsd(ethPriceData.ethereum.usd);

                const usdToInrResponse = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
                const usdToInrData = await usdToInrResponse.json();
                setUsdToInr(usdToInrData.rates.INR);

                // Fetch the carbon credit price
                const carbonPriceResponse = await fetch('https://api.carboncredits.com/v1/price'); // Placeholder for Carbon Credit API
                const carbonPriceData = await carbonPriceResponse.json();
                setCarbonCreditPrice(carbonPriceData.price); // Assuming it returns price in USD per carbon credit
            } catch (error) {
                console.error('Error fetching live prices:', error);
            }
        };

        fetchPrices();
    }, []);

    useEffect(() => {
        // Calculate the total price whenever the amount or currency changes
        if (amount && ethToUsd && usdToInr && carbonCreditPrice) {
            let price = 0;
            switch (currency) {
                case 'ETH':
                    price = amount * carbonCreditPrice / ethToUsd; // Price in ETH for carbon credits
                    break;
                case 'USD':
                    price = amount * carbonCreditPrice; // Price in USD for carbon credits
                    break;
                case 'INR':
                    price = amount * carbonCreditPrice * usdToInr; // Price in INR for carbon credits
                    break;
                default:
                    price = 0;
                    break;
            }
            setTotalPrice(price);
        }
    }, [amount, currency, ethToUsd, usdToInr, carbonCreditPrice]);

    const handleOrder = async () => {
        if (!amount || parseFloat(amount) <= 0) {
            alert('Please enter a valid amount.');
            return;
        }

        if (orderType === 'Limit' && (!limitPrice || parseFloat(limitPrice) <= 0)) {
            alert('Please enter a valid limit price.');
            return;
        }

        if (orderType === 'Stop' && (!stopPrice || parseFloat(stopPrice) <= 0)) {
            alert('Please enter a valid stop price.');
            return;
        }

        const orderData = {
            orderType,
            actionType,
            amount: parseFloat(amount),
            limitPrice: orderType === 'Limit' ? parseFloat(limitPrice) : undefined,
            stopPrice: orderType === 'Stop' ? parseFloat(stopPrice) : undefined,
            currency,  // Send selected currency
            totalPrice, // Send the total price based on selected currency
        };

        try {
            const response = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(orderData),
            });

            const data = await response.json();

            if (response.ok) {
                alert(`${actionType} Order placed successfully!`);
            } else {
                alert(`Order failed: ${data.message || 'An error occurred'}`);
            }
        } catch (error) {
            console.error('Order placement error:', error);
            alert('Order placement failed. Please try again.');
        }
    };

    return (
        <div className="order-form">
            <h2 className="section-title">Order Form</h2>

            <div className="action-buttons">
                <button className={`buy-btn ${actionType === 'Buy' ? 'active' : ''}`} onClick={() => setActionType('Buy')}>Buy</button>
                <button className={`sell-btn ${actionType === 'Sell' ? 'active' : ''}`} onClick={() => setActionType('Sell')}>Sell</button>
            </div>

            <div className="order-type">
                <button className={orderType === 'Market' ? 'active' : ''} onClick={() => setOrderType('Market')}>Market</button>
                <button className={orderType === 'Limit' ? 'active' : ''} onClick={() => setOrderType('Limit')}>Limit</button>
                <button className={orderType === 'Stop' ? 'active' : ''} onClick={() => setOrderType('Stop')}>Stop</button>
            </div>

            <div className="amount-section">
                <label>Amount:</label>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Enter amount" />
            </div>

            {orderType === 'Limit' && (
                <div className="price-section">
                    <label>Limit Price:</label>
                    <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder="Enter limit price" />
                </div>
            )}

            {orderType === 'Stop' && (
                <div className="price-section">
                    <label>Stop Price:</label>
                    <input type="number" value={stopPrice} onChange={(e) => setStopPrice(e.target.value)} placeholder="Enter stop price" />
                </div>
            )}

            <div className="currency-section">
                <label>Currency:</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                    <option value="ETH">ETH</option>
                    <option value="USD">USD</option>
                    <option value="INR">INR</option>
                </select>
            </div>

            <div className="total-price">
                <label>Total Price:</label>
                <p>{totalPrice.toFixed(2)} {currency}</p>
            </div>

            <button className="place-order-btn" onClick={handleOrder}>
                PLACE {actionType.toUpperCase()} ORDER
            </button>
        </div>
    );
};

export default OrderForm;
