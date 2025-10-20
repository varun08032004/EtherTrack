import React, { useState } from 'react';
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import './PhoneVerification.css'; // Optional CSS

const PhoneVerification = () => {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [confirmationResult, setConfirmationResult] = useState(null);
  const [message, setMessage] = useState('');

  const handleSendOtp = () => {
    const auth = getAuth();

    window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', {
      'size': 'invisible',
      'callback': () => handleSendOtp(),
    }, auth);

    signInWithPhoneNumber(auth, phone, window.recaptchaVerifier)
      .then((result) => {
        setConfirmationResult(result);
        setMessage('OTP sent to your phone.');
      })
      .catch((error) => {
        setMessage(`Error: ${error.message}`);
      });
  };

  const handleVerifyOtp = () => {
    if (confirmationResult && otp) {
      confirmationResult.confirm(otp)
        .then((result) => {
          setMessage('✅ Phone number verified successfully!');
        })
        .catch((error) => {
          setMessage('❌ Invalid OTP. Please try again.');
        });
    }
  };

  return (
    <div className="phone-verification">
      <h3>📱 Phone Verification</h3>
      <input
        type="tel"
        placeholder="+91XXXXXXXXXX"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <button onClick={handleSendOtp}>Send OTP</button>

      {confirmationResult && (
        <>
          <input
            type="text"
            placeholder="Enter OTP"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
          />
          <button onClick={handleVerifyOtp}>Verify OTP</button>
        </>
      )}

      <div id="recaptcha-container"></div>
      <p>{message}</p>
    </div>
  );
};

export default PhoneVerification;
