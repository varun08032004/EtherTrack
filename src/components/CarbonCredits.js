// Import necessary libraries and styles
import React, { useState, useEffect } from 'react';
import './CarbonCredits.css';

// Mock data for available carbon credits
const initialCredits = [
    { id: 1, type: 'Renewable Energy Certificate', price: 0.5, available: 100 },
    { id: 2, type: 'Reforestation Credit', price: 0.75, available: 200 },
    { id: 3, type: 'Emission Reduction Credit', price: 1.0, available: 150 },
];

// Mock data for leaderboard and top traders
const topTraders = [
    { name: 'Alice', totalCredits: 500 },
    { name: 'Bob', totalCredits: 450 },
    { name: 'Charlie', totalCredits: 400 },
];

const CarbonCreditsTrading = () => {
    const [credits, setCredits] = useState(initialCredits);
    const [transactionHistory, setTransactionHistory] = useState([]);
    const [wallet, setWallet] = useState({ totalCredits: 0, recentTransactions: [] });
    const [alerts, setAlerts] = useState([]);
    const [filter, setFilter] = useState({ type: '', minPrice: '', maxPrice: '' });
    const [orderBook, setOrderBook] = useState([]);
    const [topTradersList, setTopTradersList] = useState(topTraders);
    const [newAlert, setNewAlert] = useState('');
    const [transactionFeeRate] = useState(0.05); // 5% transaction fee
    const [isAuthenticated, setIsAuthenticated] = useState(false); // User authentication state

    // Simulate WebSocket connection for real-time price updates
    useEffect(() => {
        const socket = new WebSocket('ws://example.com/prices'); // Replace with your WebSocket URL

        socket.onmessage = (event) => {
            const updatedCredits = JSON.parse(event.data);
            setCredits(updatedCredits);
            checkPriceAlerts(updatedCredits);
        };

        return () => socket.close();
    }, []);

    // Function to handle user authentication (simplified)
    const handleLogin = () => {
        setIsAuthenticated(true);
    };

    const handleLogout = () => {
        setIsAuthenticated(false);
    };

    // Function to handle buying credits
    const handleBuy = (credit) => {
        const amount = prompt(`Enter amount to buy for ${credit.type}:`);
        if (amount && amount <= credit.available) {
            const fee = amount * transactionFeeRate; // Calculate transaction fee
            const totalCost = amount * credit.price + fee; // Total cost including fee

            if (wallet.totalCredits >= totalCost) {
                const newTransaction = {
                    date: new Date().toLocaleString(),
                    type: 'Buy',
                    amount: amount,
                    fee: fee,
                    status: 'Completed',
                };
                setTransactionHistory([...transactionHistory, newTransaction]);
                setWallet((prev) => ({
                    ...prev,
                    totalCredits: prev.totalCredits - totalCost,
                    recentTransactions: [...prev.recentTransactions, newTransaction],
                }));
                setCredits(credits.map((c) =>
                    c.id === credit.id ? { ...c, available: c.available - amount } : c
                ));
                updateOrderBook('Buy', credit.type, amount, credit.price); // Update order book
            } else {
                alert('Insufficient funds in wallet!');
            }
        } else {
            alert('Invalid amount!');
        }
    };

    // Function to handle selling credits
    const handleSell = (credit) => {
        const amount = prompt(`Enter amount to sell for ${credit.type}:`);
        if (amount && amount <= wallet.totalCredits) {
            const fee = amount * transactionFeeRate; // Calculate transaction fee
            const totalEarnings = amount * credit.price - fee; // Total earnings minus fee

            const newTransaction = {
                date: new Date().toLocaleString(),
                type: 'Sell',
                amount: amount,
                fee: fee,
                status: 'Completed',
            };
            setTransactionHistory([...transactionHistory, newTransaction]);
            setWallet((prev) => ({
                ...prev,
                totalCredits: prev.totalCredits + totalEarnings,
                recentTransactions: [...prev.recentTransactions, newTransaction],
            }));
            setCredits(credits.map((c) =>
                c.id === credit.id ? { ...c, available: c.available + amount } : c
            ));
            updateOrderBook('Sell', credit.type, amount, credit.price); // Update order book
        } else {
            alert('Invalid amount!');
        }
    };

    // Function to update the order book
    const updateOrderBook = (type, creditType, amount, price) => {
        setOrderBook((prevOrders) => [
            ...prevOrders,
            { type, creditType, amount, price, date: new Date().toLocaleString() },
        ]);
    };

    // Function to check and handle price alerts
    const checkPriceAlerts = (updatedCredits) => {
        updatedCredits.forEach((credit) => {
            if (credit.price > 1.25) {
                setAlerts((prev) => [...prev, `${credit.type} has increased to ${credit.price} ETH!`]);
            }
        });
    };

    // Function to apply filters
    const applyFilter = () => {
        return credits.filter((credit) => {
            const { type, minPrice, maxPrice } = filter;
            return (
                (type ? credit.type.toLowerCase().includes(type.toLowerCase()) : true) &&
                (minPrice ? credit.price >= minPrice : true) &&
                (maxPrice ? credit.price <= maxPrice : true)
            );
        });
    };

    // Add New Alert
    const addNewAlert = () => {
        setAlerts((prev) => [...prev, `New Alert: ${newAlert} ETH`]);
        setNewAlert('');
    };

    // Remove Alert
    const removeAlert = (index) => {
        setAlerts(alerts.filter((_, i) => i !== index));
    };

    return (
        <div className="carbon-credits-trading">
            <h1>Carbon Credits Trading</h1>

            {/* User Authentication */}
            <div className="auth">
                {isAuthenticated ? (
                    <div>
                        <h3>Welcome back!</h3>
                        <button onClick={handleLogout}>Logout</button>
                    </div>
                ) : (
                    <div>
                        <h3>Please log in to trade</h3>
                        <button onClick={handleLogin}>Login</button>
                    </div>
                )}
            </div>

            {/* Real-Time Market Data */}
            <div className="market-ticker">
                <h2>Market Data</h2>
                <marquee>
                    {credits.map((credit) => (
                        <span key={credit.id}>{credit.type}: {credit.price} ETH&nbsp;&nbsp;|&nbsp;&nbsp;</span>
                    ))}
                </marquee>
            </div>

            {/* Alerts Section */}
            <div className="alerts">
                <h2>Alerts</h2>
                {alerts.map((alert, index) => (
                    <div key={index} className="alert">
                        {alert}
                        <button onClick={() => removeAlert(index)}>Remove</button>
                    </div>
                ))}
            </div>

            {/* Add New Alert */}
            <div className="alerts-management">
                <h3>Manage Alerts</h3>
                <input
                    type="number"
                    placeholder="Set Price Alert"
                    value={newAlert}
                    onChange={(e) => setNewAlert(e.target.value)}
                />
                <button onClick={addNewAlert}>Add Alert</button>
            </div>

            {/* Trading Interface */}
            <div className="trading-interface">
                <h2>Available Carbon Credits</h2>
                <div className="filter">
                    <input
                        type="text"
                        placeholder="Type"
                        value={filter.type}
                        onChange={(e) => setFilter({ ...filter, type: e.target.value })}
                    />
                    <input
                        type="number"
                        placeholder="Min Price"
                        value={filter.minPrice}
                        onChange={(e) => setFilter({ ...filter, minPrice: e.target.value })}
                    />
                    <input
                        type="number"
                        placeholder="Max Price"
                        value={filter.maxPrice}
                        onChange={(e) => setFilter({ ...filter, maxPrice: e.target.value })}
                    />
                    <button onClick={applyFilter}>Apply Filter</button>
                </div>

                <ul>
                    {applyFilter().map((credit) => (
                        <li key={credit.id}>
                            {credit.type} - {credit.price} ETH (Available: {credit.available})
                            <button onClick={() => handleBuy(credit)}>Buy</button>
                            <button onClick={() => handleSell(credit)}>Sell</button>
                        </li>
                    ))}
                </ul>
            </div>

            {/* Transaction History */}
            <div className="transaction-history">
                <h2>Transaction History</h2>
                <ul>
                    {transactionHistory.map((txn, index) => (
                        <li key={index}>
                            {txn.date}: {txn.type} {txn.amount} credits (Fee: {txn.fee} ETH) - Status: {txn.status}
                        </li>
                    ))}
                </ul>
            </div>

            {/* Leaderboard */}
            <div className="leaderboard">
                <h2>Top Traders</h2>
                <ul>
                    {topTradersList.map((trader, index) => (
                        <li key={index}>
                            {trader.name} - {trader.totalCredits} credits
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default CarbonCreditsTrading;
