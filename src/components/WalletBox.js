import React, { useEffect, useState } from 'react';
import Web3 from 'web3';
import axios from 'axios';
import { QRCodeCanvas } from 'qrcode.react';
import './WalletBox.css';
import LiveRates from './LiveRates'; // adjust the path

const WalletBox = () => {
    const [account, setAccount] = useState('');
    const [balance, setBalance] = useState('0.00');
    const [usdBalance, setUsdBalance] = useState('0.00');
    const [inrBalance, setInrBalance] = useState('0.00');
    const [carbonCredits, setCarbonCredits] = useState('0');

    const [showDepositModal, setShowDepositModal] = useState(false);
    const [showWithdrawModal, setShowWithdrawModal] = useState(false);

    const [depositAmount, setDepositAmount] = useState('');
    const [withdrawAmount, setWithdrawAmount] = useState('');

    const [paymentMethod, setPaymentMethod] = useState('');
    const [upiID, setUpiID] = useState('');

    const [bankDetails, setBankDetails] = useState({
        accountNumber: '',
        ifscCode: '',
        accountHolderName: ''
    });

    const [errors, setErrors] = useState({});
    const [isMinimized, setIsMinimized] = useState(false);

    // OTP State
    const [otp, setOtp] = useState('');
    const [generatedOtp, setGeneratedOtp] = useState('');
    const [showOtpModal, setShowOtpModal] = useState(false);
    const [otpError, setOtpError] = useState('');

    const generateOtp = () => {
        const newOtp = Math.floor(100000 + Math.random() * 900000).toString();
        setGeneratedOtp(newOtp);
        alert(`🔒 Your OTP is: ${newOtp}`); // For demonstration (replace with actual email/SMS logic)
    };

    const handleVerifyOtp = () => {
        if (otp === generatedOtp) {
            showNotification(`✅ Transaction Successful!`, 'success');
            setShowOtpModal(false);
            setOtp('');
            setGeneratedOtp('');
        } else {
            setOtpError('❌ Invalid OTP. Please try again.');
        }
    };
    
    
    // Transaction History
    const [transactions, setTransactions] = useState([]);
    const [filteredTransactions, setFilteredTransactions] = useState([]);
    const [filter, setFilter] = useState('all');
    const [currentPage, setCurrentPage] = useState(1);
    const transactionsPerPage = 5;
    const [showHistoryModal, setShowHistoryModal] = useState(false);

    // Notification State
    const [notification, setNotification] = useState(null);

   // Show Notification Function  
    const showNotification = (message, type = 'success') => {
    setNotification({ message, type });

    // Auto-dismiss after 5 seconds
    setTimeout(() => setNotification(null), 5000);
    };
    
    // Confirmation State
const [confirmation, setConfirmation] = useState({
    show: false,
    type: '', // 'deposit' or 'withdraw'
    amount: '',
    callback: null
});


    // Load Wallet Data
   const loadWallet = async () => {
    if (window.ethereum) {
        const web3 = new Web3(window.ethereum);
        try {
            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            web3.eth.defaultAccount = accounts[0];
            console.log('Accounts:', accounts);

            if (!accounts.length) {
                showNotification('⚠️ No accounts found. Please connect your wallet.', 'error');
                return;
            }

            setAccount(accounts[0]);

            const balanceWei = await web3.eth.getBalance(accounts[0]);
            console.log('Balance (Wei):', balanceWei);

            const ethBalance = web3.utils.fromWei(balanceWei, 'ether');
            console.log('Balance (ETH):', ethBalance);

            setBalance(ethBalance);

            const { data } = await axios.get(
                'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=inr,usd'
            );

            console.log('Exchange Rates:', data);

            setUsdBalance((parseFloat(ethBalance) * data.ethereum.usd).toFixed(2));
            setInrBalance((parseFloat(ethBalance) * data.ethereum.inr).toFixed(2));

            setCarbonCredits((parseFloat(ethBalance) * 100).toFixed(0));
        } catch (error) {
            console.error("Failed to connect wallet or fetch rates:", error);
            showNotification('⚠️ Error fetching wallet data. Please try again.', 'error');
        }
    } else {
        showNotification('❌ MetaMask not found. Please install it.', 'error');
    }
};


    const disconnectWallet = () => {
    setAccount('');
    setBalance('0.00');
    setUsdBalance('0.00');
    setInrBalance('0.00');
    setCarbonCredits('0');
    showNotification('👋 Wallet disconnected successfully.');
};


    const handleBankDetailsChange = (e) => {
        const { name, value } = e.target;
        setBankDetails({ ...bankDetails, [name]: value });
    };

    // Filter Transactions
    const filterTransactions = (filterType) => {
        setFilter(filterType);
        if (filterType === 'all') {
            setFilteredTransactions(transactions);
        } else {
            const filtered = transactions.filter(tx => tx.type.toLowerCase() === filterType.toLowerCase());
            setFilteredTransactions(filtered);
        }
    };

    // Pagination Logic
    const totalPages = Math.ceil(filteredTransactions.length / transactionsPerPage);
    const currentTransactions = filteredTransactions.slice(
        (currentPage - 1) * transactionsPerPage,
        currentPage * transactionsPerPage
    );
    const handlePreviousPage = () => setCurrentPage((prev) => Math.max(prev - 1, 1));
    const handleNextPage = () => setCurrentPage((prev) => Math.min(prev + 1, totalPages));

    // CSV Export
    const handleExportCSV = () => {
        const csvContent = [
            ['Type', 'Amount', 'Currency', 'Payment Method', 'Date & Time', 'Status'],
            ...filteredTransactions.map(tx => [
                tx.type,
                tx.amount,
                tx.currency,
                tx.paymentMethod,
                new Date(tx.date).toLocaleString(),
                tx.status
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);

        const link = document.createElement('a');
        link.href = url;
        link.download = 'transaction_history.csv';
        link.click();
    };

    // Validation for Deposit & Withdrawal
    const validateFields = (amount, isDeposit = false) => {
        const newErrors = {};

        if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
            newErrors.amount = 'Valid amount is required.';
        }

        if (!paymentMethod) {
            newErrors.paymentMethod = 'Please select a payment method.';
        }

        if (paymentMethod === 'upi' && !/^[a-zA-Z0-9.-]+@[a-zA-Z]{3,}$/.test(upiID)) {
            newErrors.upiID = 'Invalid UPI ID format.';
        }

        if (paymentMethod === 'bank') {
            if (!bankDetails.accountNumber) newErrors.accountNumber = 'Account number is required.';
            if (!bankDetails.ifscCode || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankDetails.ifscCode)) {
                newErrors.ifscCode = 'Invalid IFSC code format.';
            }
            if (!bankDetails.accountHolderName) newErrors.accountHolderName = 'Account holder name is required.';
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmitDeposit = () => {
        if (validateFields(depositAmount, true)) {
            if (parseFloat(depositAmount) >= 5000) {
                generateOtp();  // Generate OTP for large transactions
                setShowOtpModal(true); // Show OTP Modal
            } else {
                showNotification(`✅ Deposit of ₹${depositAmount} successful!`, 'success');
                setShowDepositModal(false);
            }
        } else {
            showNotification('❌ Deposit failed. Please fix the errors.', 'error');
        }
    };

    const handleSubmitWithdraw = () => {
        if (validateFields(withdrawAmount, false)) {
            if (parseFloat(withdrawAmount) >= 5000) {
                generateOtp();  // Generate OTP for large transactions
                setShowOtpModal(true); // Show OTP Modal
            } else {
                showNotification(`✅ Withdrawal of ₹${withdrawAmount} successful!`, 'success');
                setShowWithdrawModal(false);
            }
        } else {
            showNotification('❌ Withdrawal failed. Please fix the errors.', 'error');
        }
    };

    useEffect(() => {
        loadWallet();  // Initial load
    const interval = setInterval(() => loadWallet(), 30000); // Auto-refresh every 30 seconds
    return () => clearInterval(interval); // Clean up on unmount
}, []);

    return (
  <>
    <LiveRates />
    <div className={`wallet-box ${isMinimized ? 'minimized' : ''}`}>
      <div className="wallet-header">
        Wallet
        <button
          className="minimize-btn"
          onClick={() => setIsMinimized(!isMinimized)}
        >
          {isMinimized ? 'Expand' : 'Minimize'}
        </button>
      </div>

      {!isMinimized && (
        <div className="wallet-info">
          {account ? (
            <>
              <p><strong>🟢 Account:</strong> {account}</p>
              <p><strong>Total Balance (ETH):</strong> {balance} ETH</p>
              <p><strong>Total Balance (USD):</strong> ${usdBalance}</p>
              <p><strong>Total Balance (INR):</strong> ₹{inrBalance}</p>
              <p><strong>Carbon Credits:</strong> {carbonCredits} CARBON</p>
              <button
                className="wallet-btn disconnect-btn"
                onClick={disconnectWallet}
              >
                Disconnect Wallet
              </button>
            </>
          ) : (
            <>
              <p><strong>🔴 Wallet not connected</strong></p>
              <button
                className="wallet-btn connect-btn"
                onClick={loadWallet}
              >
                Connect Wallet
              </button>
            </>
          )}

          <div className="wallet-actions">
            <button className="wallet-btn" onClick={() => setShowDepositModal(true)}>Deposit</button>
            <button className="wallet-btn" onClick={() => setShowWithdrawModal(true)}>Withdraw</button>
            <button className="wallet-btn" onClick={loadWallet}>Reconnect Wallet</button>
            <button className="wallet-btn" onClick={() => setShowHistoryModal(true)}>Transaction History</button>
          </div>
        </div>
      )}
    </div>
  </>
);


            
            {/* OTP Confirmation Modal */}
{showOtpModal && (
    <div className="modal">
        <div className="modal-content">
            <h4>OTP Verification</h4>
            <p>Enter the OTP sent to your registered email/phone.</p>

            <input 
                type="text"
                placeholder="Enter OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={6}
            />

            {otpError && <p className="error-text">{otpError}</p>}

            <div className="otp-actions">
                <button 
                    className="modal-btn"
                    onClick={handleVerifyOtp}
                >
                    Verify OTP
                </button>

                <button 
                    className="modal-btn cancel-btn"
                    onClick={() => setShowOtpModal(false)}
                >
                    Cancel
                </button>

                <button 
                    className="modal-btn resend-btn"
                    onClick={generateOtp}
                >
                    Resend OTP
                </button>
            </div>
        </div>
    </div>
)}

            
            {/* Notification Alert */}
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
                <button 
                    className="modal-btn"
                    onClick={() => {
                        confirmation.callback();
                        setConfirmation({ show: false });
                    }}
                >
                    Confirm
                </button>

                <button 
                    className="modal-btn cancel-btn"
                    onClick={() => setConfirmation({ show: false })}
                >
                    Cancel
                </button>
            </div>
        </div>
    </div>
)}


            {/* Transaction History Modal */}
            {showHistoryModal && (
                <div className="modal">
                    <div className="modal-content">
                        <h4>Transaction History</h4>

                        {/* Filter Options */}
                        <div className="filter-options">
                            {['all', 'deposit', 'withdrawal', 'failed'].map((type) => (
                                <button 
                                    key={type} 
                                    className={`filter-btn ${filter === type ? 'active' : ''}`}
                                    onClick={() => filterTransactions(type)}
                                >
                                    {type.charAt(0).toUpperCase() + type.slice(1)}
                                </button>
                            ))}
                        </div>

                        {/* Transaction Table */}
                        <table className="history-table">
                            <thead>
                                <tr>
                                    <th>Type</th>
                                    <th>Amount</th>
                                    <th>Payment Method</th>
                                    <th>Reference ID</th>
                                    <th>Date & Time</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {currentTransactions.map((transaction, index) => (
                                    <tr key={index}>
                                        <td>{transaction.type}</td>
                                        <td>{transaction.amount}</td>
                                        <td>{transaction.paymentMethod}</td>
                                        <td>{transaction.referenceID || 'N/A'}</td> {/* Display Reference ID */}
                                        <td>{new Date(transaction.date).toLocaleString()}</td>
                                        <td>{transaction.status}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

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

            <input 
                type="number" 
                placeholder="Enter Amount (INR)" 
                value={depositAmount} 
                onChange={(e) => setDepositAmount(e.target.value)} 
            />

            <select 
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
            >
                <option value="">Select Payment Method</option>
                <option value="upi">UPI</option>
                <option value="qr">QR Code</option>
                <option value="bank">Bank Transfer</option>
            </select>

            {/* UPI ID & Reference ID for UPI */}
            {paymentMethod === 'upi' && (
                <>
                    <input 
                        type="text" 
                        placeholder="Enter UPI ID" 
                        value={upiID} 
                        onChange={(e) => setUpiID(e.target.value)} 
                    />
                    <input 
                        type="text" 
                        placeholder="Enter Reference ID (Required)" 
                        value={bankDetails.referenceID}
                        onChange={(e) => setBankDetails({ ...bankDetails, referenceID: e.target.value })}
                    />
                </>
            )}

            {/* QR Code Display & Reference ID */}
            {paymentMethod === 'qr' && (
                <>
                    <div className="qr-code">
                        <QRCodeCanvas value={account} />
                    </div>
                    <input 
                        type="text" 
                        placeholder="Enter Reference ID (Required)" 
                        value={bankDetails.referenceID}
                        onChange={(e) => setBankDetails({ ...bankDetails, referenceID: e.target.value })}
                    />
                </>
            )}

            {/* Bank Details & Reference ID (Optional) */}
            {paymentMethod === 'bank' && (
                <>
                    <input 
                        type="text" 
                        placeholder="Account Number" 
                        name="accountNumber" 
                        onChange={handleBankDetailsChange} 
                    />
                    <input 
                        type="text" 
                        placeholder="IFSC Code" 
                        name="ifscCode" 
                        onChange={handleBankDetailsChange} 
                    />
                    <input 
                        type="text" 
                        placeholder="Account Holder Name" 
                        name="accountHolderName" 
                        onChange={handleBankDetailsChange} 
                    />
                    <input 
                        type="text" 
                        placeholder="Enter Reference ID (Optional)" 
                        value={bankDetails.referenceID}
                        onChange={(e) => setBankDetails({ ...bankDetails, referenceID: e.target.value })}
                    />
                </>
            )}

            {/* Confirm & Cancel Buttons */}
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

            <input 
                type="number" 
                placeholder="Enter Amount (INR)" 
                value={withdrawAmount} 
                onChange={(e) => setWithdrawAmount(e.target.value)}
            />

            <select 
                value={paymentMethod} 
                onChange={(e) => setPaymentMethod(e.target.value)}
            >
                <option value="">Select Payment Method</option>
                <option value="upi">UPI</option>
                <option value="bank">Bank Transfer</option>
            </select>

            {paymentMethod === 'upi' && (
                <input 
                    type="text" 
                    placeholder="Enter UPI ID" 
                    value={upiID} 
                    onChange={(e) => setUpiID(e.target.value)}
                />
            )}

            {paymentMethod === 'bank' && (
                <>
                    <input 
                        type="text" 
                        placeholder="Account Number" 
                        name="accountNumber" 
                        onChange={handleBankDetailsChange} 
                    />
                    <input 
                        type="text" 
                        placeholder="IFSC Code" 
                        name="ifscCode" 
                        onChange={handleBankDetailsChange} 
                    />
                    <input 
                        type="text" 
                        placeholder="Account Holder Name" 
                        name="accountHolderName" 
                        onChange={handleBankDetailsChange} 
                    />
                </>
            )}

            <button className="modal-btn" onClick={handleSubmitWithdraw}>Confirm Withdrawal</button>
            <button className="modal-btn cancel-btn" onClick={() => setShowWithdrawModal(false)}>Cancel</button>
        </div>
    </div>
)}

    
};

export default WalletBox;
