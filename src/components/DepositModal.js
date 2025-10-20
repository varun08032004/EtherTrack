import React, { useState } from 'react';
import './DepositModal.css';

const DepositModal = ({ onClose }) => {
    const [method, setMethod] = useState('UPI');
    const [inputValue, setInputValue] = useState('');

    const handleSubmit = () => {
        if (!inputValue) {
            alert(`Please enter your ${method === 'UPI' ? 'UPI ID' : 'Bank Details'}`);
            return;
        }
        alert(`Deposit request submitted successfully via ${method}`);
        onClose(); // Close the modal after submission
    };

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Deposit Funds</h2>

                <label>Choose Payment Method:</label>
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                    <option value="UPI">UPI</option>
                    <option value="Bank">Bank Transfer</option>
                </select>

                <label>
                    {method === 'UPI' ? 'Enter UPI ID:' : 'Enter Bank Details (IFSC + Account No.):'}
                </label>
                <input
                    type="text"
                    placeholder={method === 'UPI' ? 'yourupi@bank' : 'IFSC + Account Number'}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                />

                <div className="modal-actions">
                    <button onClick={handleSubmit} className="confirm-btn">Submit</button>
                    <button onClick={onClose} className="cancel-btn">Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default DepositModal;
