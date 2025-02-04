import React, { useState, useEffect } from 'react';
import './BlockchainWallet.css';

const BlockchainWallet = () => {
    // State for wallet details
    const [walletAddress, setWalletAddress] = useState('');
    const [balance, setBalance] = useState(0);
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        // Fetch wallet details on component mount
        fetchWalletDetails();
    }, ); // Add an empty dependency array to run once on mount

    const fetchWalletDetails = async () => {
        setLoading(true);
        setError('');
        try {
            const address = '0x1234567890abcdef'; // Example address
            setWalletAddress(address);

            // Simulate fetching balance
            const fetchedBalance = await fetchBalance(address);
            setBalance(fetchedBalance);

            // Simulate fetching transactions
            const fetchedTransactions = await fetchTransactions(address);
            setTransactions(fetchedTransactions);
        } catch (error) {
            console.error('Error fetching wallet details:', error);
            setError('Failed to fetch wallet details.');
        } finally {
            setLoading(false);
        }
    };

    const fetchBalance = async (address) => {
        // Replace with actual API call to fetch balance
        return 123.45; // Example balance
    };

    const fetchTransactions = async (address) => {
        // Replace with actual API call to fetch transactions
        return [
            { id: 1, date: '2024-08-21', amount: -50.0, description: 'Payment to Vendor' },
            { id: 2, date: '2024-08-20', amount: 100.0, description: 'Deposit' },
        ];
    };

    return (
        <div className="blockchain-wallet-container">
            <div className="wallet-header">
                <h1>Blockchain Wallet</h1>
                <button className="btn-primary" onClick={fetchWalletDetails} disabled={loading}>
                    {loading ? 'Refreshing...' : 'Refresh'}
                </button>
            </div>
            {error && <div className="error-message">{error}</div>}
            <div className="wallet-details">
                <h2>Wallet Address:</h2>
                <p>{walletAddress || 'Loading...'}</p>
                <h2>Balance:</h2>
                <p>${balance.toFixed(2)}</p>
            </div>
            <div className="wallet-transactions">
                <h2>Transaction History:</h2>
                <ul>
                    {transactions.length ? (
                        transactions.map(tx => (
                            <li key={tx.id}>
                                <span>{tx.date}</span> - 
                                <span>{tx.description}</span> - 
                                <span>{tx.amount > 0 ? '+' : ''}${tx.amount.toFixed(2)}</span>
                            </li>
                        ))
                    ) : (
                        <li>No transactions available</li>
                    )}
                </ul>
            </div>
        </div>
    );
};

export default BlockchainWallet;
