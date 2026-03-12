import React, { useEffect, useState } from 'react';
import Web3 from 'web3';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';
import './WalletBox.css';
import LiveRates from './LiveRates';

const WalletBox = () => {
    const [account, setAccount]           = useState('');
    const [balance, setBalance]           = useState('0.00');
    const [usdBalance, setUsdBalance]     = useState('0.00');
    const [inrBalance, setInrBalance]     = useState('0.00');
    const [carbonCredits, setCarbonCredits] = useState('0');

    const [showDepositModal, setShowDepositModal]   = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);

    const [depositAmount, setDepositAmount]   = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');

    const [paymentMethod, setPaymentMethod] = useState('');
    const [upiID, setUpiID]                 = useState('');

    const [bankDetails, setBankDetails] = useState({
        accountNumber: '', ifscCode: '', accountHolderName: '', referenceID: ''
    });

    const [errors, setErrors]       = useState({});
    const [isMinimized, setIsMinimized] = useState(false);

    // OTP State
    const [otp, setOtp]                       = useState('');
    const [generatedOtp, setGeneratedOtp]     = useState('');
    const [showOtpModal, setShowOtpModal]     = useState(false);
    const [otpError, setOtpError]             = useState('');

    // Transaction History
    const [transactions, setTransactions]               = useState([]);
    const [filteredTransactions, setFilteredTransactions] = useState([]);
    const [filter, setFilter]                           = useState('all');
    const [currentPage, setCurrentPage]                 = useState(1);
    const transactionsPerPage                           = 5;
    const [showHistoryModal, setShowHistoryModal]       = useState(false);

    // Notification
    const [notification, setNotification] = useState(null);

    // Confirmation
    const [confirmation, setConfirmation] = useState({
        show: false, type: '', amount: '', callback: null
    });

    const showNotification = (message, type = 'success') => {
        setNotification({ message, type });
        setTimeout(() => setNotification(null), 5000);
    };

    const generateOtp = () => {
        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(newOtp);
        alert(`🔒 Your OTP is: ${newOtp}`);
    };

    const handleVerifyOtp = () => {
        if (otp === generatedOtp) {
            showNotification('✅ Transaction Successful!', 'success');
            setShowOtpModal(false);
            setOtp('');
            setGeneratedOtp('');
        } else {
            setOtpError('❌ Invalid OTP. Please try again.');
        }
    };

    // ── FIXED: Silent wallet load — NO popup, NO forced connection ────
    const loadWallet = async (forceConnect = false) => {
        if (!window.ethereum) {
            showNotification('❌ MetaMask not found. Please install it.', 'error');
            return;
        }

        const web3 = new Web3(window.ethereum);

        try {
            // ✅ KEY FIX: use eth_accounts (silent) not eth_requestAccounts (popup)
            // Only use eth_requestAccounts when user explicitly clicks "Connect Wallet"
            const accounts = forceConnect
                ? await window.ethereum.request({ method: 'eth_requestAccounts' })
                : await window.ethereum.request({ method: 'eth_accounts' });

            if (!accounts || !accounts.length) {
                // Not connected — just show disconnected state, no popup
                setAccount('');
                return;
            }

            setAccount(accounts[0]);

            const balanceWei = await web3.eth.getBalance(accounts[0]);
            const ethBalance = web3.utils.fromWei(balanceWei, 'ether');
            setBalance(parseFloat(ethBalance).toFixed(4));

            try {
                const { data } = await axios.get(
                    'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr,usd'
                );
                setUsdBalance((parseFloat(ethBalance) * data.ethereum.usd).toFixed(2));
                setInrBalance((parseFloat(ethBalance) * data.ethereum.inr).toFixed(2));
            } catch {
                // CoinGecko rate limit — just skip, don't crash
            }

            setCarbonCredits((parseFloat(ethBalance) * 100).toFixed(0));

        } catch (error) {
            console.error('Wallet load error:', error);
            // Don't show error on silent load — only on explicit connect
            if (forceConnect) {
                showNotification('⚠️ Error connecting wallet. Please try again.', 'error');
            }
        }
    };

    // ── User explicitly clicks Connect Wallet ─────────────────────────
    const connectWallet = () => loadWallet(true);

    const disconnectWallet = () => {
        setAccount('');
        setBalance('0.00');
        setUsdBalance('0.00');
        setInrBalance('0.00');
        setCarbonCredits('0');
        showNotification('👋 Wallet disconnected.');
    };

    const handleBankDetailsChange = (e) => {
        const { name, value } = e.target;
        setBankDetails({ ...bankDetails, [name]: value });
    };

    // Filter Transactions
    const filterTransactions = (filterType) => {
        setFilter(filterType);
        setFilteredTransactions(
            filterType === 'all'
                ? transactions
                : transactions.filter(tx => tx.type.toLowerCase() === filterType.toLowerCase())
        );
    };

    // Pagination
    const totalPages          = Math.ceil(filteredTransactions.length / transactionsPerPage);
    const currentTransactions = filteredTransactions.slice(
        (currentPage - 1) * transactionsPerPage,
        currentPage * transactionsPerPage
    );
    const handlePreviousPage = () => setCurrentPage(p => Math.max(p - 1, 1));
    const handleNextPage     = () => setCurrentPage(p => Math.min(p + 1, totalPages));

    // CSV Export
    const handleExportCSV = () => {
        const csvContent = [
            ['Type', 'Amount', 'Currency', 'Payment Method', 'Date & Time', 'Status'],
            ...filteredTransactions.map(tx => [
                tx.type, tx.amount, tx.currency, tx.paymentMethod,
                new Date(tx.date).toLocaleString(), tx.status
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url  = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'transaction_history.csv';
        link.click();
    };

    // Validation
    const validateFields = (amount) => {
        const newErrors = {};
        if (!amount || isNaN(amount) || parseFloat(amount) <= 0)
            newErrors.amount = 'Valid amount is required.';
        if (!paymentMethod)
            newErrors.paymentMethod = 'Please select a payment method.';
        if (paymentMethod === 'upi' && !/^[a-zA-Z0-9.-]+@[a-zA-Z]{3,}$/.test(upiID))
            newErrors.upiID = 'Invalid UPI ID format.';
        if (paymentMethod === 'bank') {
            if (!bankDetails.accountNumber) newErrors.accountNumber = 'Account number is required.';
            if (!bankDetails.ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankDetails.ifscCode))
                newErrors.ifscCode = 'Invalid IFSC code.';
            if (!bankDetails.accountHolderName) newErrors.accountHolderName = 'Account holder name is required.';
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmitDeposit = () => {
        if (validateFields(depositAmount)) {
            if (parseFloat(depositAmount) >= 5000) {
                generateOtp();
                setShowOtpModal(true);
            } else {
                showNotification(`✅ Deposit of ₹${depositAmount} successful!`);
                setShowDepositModal(false);
            }
        } else {
            showNotification('❌ Deposit failed. Please fix the errors.', 'error');
        }
    };

    const handleSubmitWithdraw = () => {
        if (validateFields(withdrawAmount)) {
            if (parseFloat(withdrawAmount) >= 5000) {
                generateOtp();
                setShowOtpModal(true);
            } else {
                showNotification(`✅ Withdrawal of ₹${withdrawAmount} successful!`);
                setShowWithdrawModal(false);
            }
        } else {
            showNotification('❌ Withdrawal failed. Please fix the errors.', 'error');
        }
    };

    // ── FIXED: Silent check on mount, no interval hammering MetaMask ──
    useEffect(() => {
        loadWallet(false); // silent — only reads already-connected accounts

        // Listen for account switches in MetaMask
        if (window.ethereum) {
            const handleAccountsChanged = (accounts) => {
                if (accounts.length) {
                    loadWallet(false);
                } else {
                    disconnectWallet();
                }
            };
            window.ethereum.on('accountsChanged', handleAccountsChanged);
            return () => window.ethereum.removeListener('accountsChanged', handleAccountsChanged);
        }
    }, []); // ← runs once on mount, NO 30-second interval

    return (
        <>
            <LiveRates />
            <div className={`wallet-box ${isMinimized ? 'minimized' : ''}`}>
                <div className="wallet-header">
                    Wallet
                    <button className="minimize-btn" onClick={() => setIsMinimized(!isMinimized)}>
                        {isMinimized ? 'Expand' : 'Minimize'}
                    </button>
                </div>

                {!isMinimized && (
                    <div className="wallet-info">
                        {account ? (
                            <>
                                <p><strong>🟢 Account:</strong> {account.slice(0,6)}...{account.slice(-4)}</p>
                                <p><strong>Balance (ETH):</strong> {balance} ETH</p>
                                <p><strong>Balance (USD):</strong> ${usdBalance}</p>
                                <p><strong>Balance (INR):</strong> ₹{inrBalance}</p>
                                <p><strong>Carbon Credits:</strong> {carbonCredits} CARBON</p>
                                <button className="wallet-btn disconnect-btn" onClick={disconnectWallet}>
                                    Disconnect Wallet
                                </button>
                            </>
                        ) : (
                            <>
                                <p><strong>🔴 Wallet not connected</strong></p>
                                <button className="wallet-btn connect-btn" onClick={connectWallet}>
                                    Connect Wallet
                                </button>
                            </>
                        )}

                        <div className="wallet-actions">
                            <button className="wallet-btn" onClick={() => setShowDepositModal(true)}>Deposit</button>
                            <button className="wallet-btn" onClick={() => setShowWithdrawModal(true)}>Withdraw</button>
                            <button className="wallet-btn" onClick={connectWallet}>Reconnect Wallet</button>
                            <button className="wallet-btn" onClick={() => setShowHistoryModal(true)}>Transaction History</button>
                        </div>
                    </div>
                )}
            </div>

            {/* OTP Modal */}
            {showOtpModal && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>OTP Verification</h4>
                        <p>Enter the OTP sent to your registered email/phone.</p>
                        <input type="text" placeholder="Enter OTP" value={otp}
                            onChange={e => setOtp(e.target.value)} maxLength={6}/>
                        {otpError && <p className="error-text">{otpError}</p>}
                        <div className="otp-actions">
                            <button className="modal-btn" onClick={handleVerifyOtp}>Verify OTP</button>
                            <button className="modal-btn cancel-btn" onClick={() => setShowOtpModal(false)}>Cancel</button>
                            <button className="modal-btn resend-btn" onClick={generateOtp}>Resend OTP</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Notification */}
            {notification && (
                <div className={`notification ${notification.type}`}>
                    {notification.message}
                </div>
            )}

            {/* Confirmation Popup */}
            {confirmation.show && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>Confirm {confirmation.type === 'deposit' ? 'Deposit' : 'Withdrawal'}</h4>
                        <p>Are you sure you want to {confirmation.type} ₹{confirmation.amount}?</p>
                        <div className="confirmation-actions">
                            <button className="modal-btn" onClick={() => {
                                confirmation.callback();
                                setConfirmation({ show: false });
                            }}>Confirm</button>
                            <button className="modal-btn cancel-btn"
                                onClick={() => setConfirmation({ show: false })}>Cancel</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Transaction History Modal */}
            {showHistoryModal && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>Transaction History</h4>
                        <div className="filter-options">
                            {['all', 'deposit', 'withdrawal', 'failed'].map(type => (
                                <button key={type}
                                    className={`filter-btn ${filter === type ? 'active' : ''}`}
                                    onClick={() => filterTransactions(type)}>
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </button>
                            ))}
                        </div>
                        <table className="history-table">
                            <thead>
                                <tr>
                                    <th>Type</th><th>Amount</th><th>Payment Method</th>
                                    <th>Reference ID</th><th>Date & Time</th><th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentTransactions.map((tx, i) => (
                                    <tr key={i}>
                                        <td>{tx.type}</td>
                                        <td>{tx.amount}</td>
                                        <td>{tx.paymentMethod}</td>
                                        <td>{tx.referenceID || 'N/A'}</td>
                                        <td>{new Date(tx.date).toLocaleString()}</td>
                                        <td>{tx.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ display:'flex', gap:8, marginTop:12 }}>
                            <button className="modal-btn" onClick={handlePreviousPage} disabled={currentPage===1}>← Prev</button>
                            <span style={{ padding:'8px', fontSize:12 }}>{currentPage} / {totalPages||1}</span>
                            <button className="modal-btn" onClick={handleNextPage} disabled={currentPage===totalPages}>Next →</button>
                        </div>
                        <button className="modal-btn" onClick={handleExportCSV}>Download CSV</button>
                        <button className="modal-btn cancel-btn" onClick={() => setShowHistoryModal(false)}>Close</button>
                    </div>
                </div>
            )}

            {/* Deposit Modal */}
            {showDepositModal && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>Deposit Funds</h4>
                        <input type="number" placeholder="Enter Amount (INR)"
                            value={depositAmount} onChange={e => setDepositAmount(e.target.value)}/>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                            <option value="">Select Payment Method</option>
                            <option value="upi">UPI</option>
                            <option value="qr">QR Code</option>
                            <option value="bank">Bank Transfer</option>
                        </select>
                        {paymentMethod === 'upi' && (
                            <>
                                <input type="text" placeholder="Enter UPI ID"
                                    value={upiID} onChange={e => setUpiID(e.target.value)}/>
                                <input type="text" placeholder="Reference ID (Required)"
                                    value={bankDetails.referenceID}
                                    onChange={e => setBankDetails({...bankDetails, referenceID:e.target.value})}/>
                            </>
                        )}
                        {paymentMethod === 'qr' && (
                            <>
                                <div className="qr-code"><QRCodeCanvas value={account}/></div>
                                <input type="text" placeholder="Reference ID (Required)"
                                    value={bankDetails.referenceID}
                                    onChange={e => setBankDetails({...bankDetails, referenceID:e.target.value})}/>
                            </>
                        )}
                        {paymentMethod === 'bank' && (
                            <>
                                <input type="text" placeholder="Account Number"
                                    name="accountNumber" onChange={handleBankDetailsChange}/>
                                <input type="text" placeholder="IFSC Code"
                                    name="ifscCode" onChange={handleBankDetailsChange}/>
                                <input type="text" placeholder="Account Holder Name"
                                    name="accountHolderName" onChange={handleBankDetailsChange}/>
                                <input type="text" placeholder="Reference ID (Optional)"
                                    value={bankDetails.referenceID}
                                    onChange={e => setBankDetails({...bankDetails, referenceID:e.target.value})}/>
                            </>
                        )}
                        {errors.amount      && <p className="error-text">{errors.amount}</p>}
                        {errors.paymentMethod && <p className="error-text">{errors.paymentMethod}</p>}
                        {errors.upiID       && <p className="error-text">{errors.upiID}</p>}
                        <button className="modal-btn" onClick={handleSubmitDeposit}>Confirm Deposit</button>
                        <button className="modal-btn cancel-btn" onClick={() => setShowDepositModal(false)}>Cancel</button>
                    </div>
                </div>
            )}

            {/* Withdraw Modal */}
            {showWithdrawModal && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>Withdraw Funds</h4>
                        <input type="number" placeholder="Enter Amount (INR)"
                            value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)}/>
                        <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                            <option value="">Select Payment Method</option>
                            <option value="upi">UPI</option>
                            <option value="bank">Bank Transfer</option>
                        </select>
                        {paymentMethod === 'upi' && (
                            <input type="text" placeholder="Enter UPI ID"
                                value={upiID} onChange={e => setUpiID(e.target.value)}/>
                        )}
                        {paymentMethod === 'bank' && (
                            <>
                                <input type="text" placeholder="Account Number"
                                    name="accountNumber" onChange={handleBankDetailsChange}/>
                                <input type="text" placeholder="IFSC Code"
                                    name="ifscCode" onChange={handleBankDetailsChange}/>
                                <input type="text" placeholder="Account Holder Name"
                                    name="accountHolderName" onChange={handleBankDetailsChange}/>
                            </>
                        )}
                        {errors.amount        && <p className="error-text">{errors.amount}</p>}
                        {errors.paymentMethod && <p className="error-text">{errors.paymentMethod}</p>}
                        <button className="modal-btn" onClick={handleSubmitWithdraw}>Confirm Withdrawal</button>
                        <button className="modal-btn cancel-btn" onClick={() => setShowWithdrawModal(false)}>Cancel</button>
                    </div>
                </div>
            )}
        </>
    );
};

export default WalletBox;