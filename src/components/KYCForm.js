import React, { useState, useEffect } from "react";
import { auth } from "../firebaseConfigure";
import { RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import Header from "../components/Header";
import "./KYCForm.css";

const KYCForm = ({ onComplete }) => {
  const [fullName, setFullName] = useState("");
  const [govtId, setGovtId] = useState("");
  const [govtIdType, setGovtIdType] = useState("");
  const [idFile, setIdFile] = useState(null);
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [isOtpSent, setIsOtpSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [confirmationResult, setConfirmationResult] = useState(null);

  const handleFileChange = (e) => setIdFile(e.target.files[0]);

  const setupRecaptcha = () => {
    if (!window.recaptchaVerifier) {
      window.recaptchaVerifier = new RecaptchaVerifier(auth, "recaptcha-container", {
        size: "invisible",
        callback: (response) => {
          console.log("Recaptcha solved");
        },
      });
      window.recaptchaVerifier.render();
    }
  };

  const handleSendOTP = async () => {
    if (!fullName || !govtId || !govtIdType || !idFile || !phoneNumber) {
      alert("Please fill all fields before OTP verification.");
      return;
    }

    setupRecaptcha();

    const appVerifier = window.recaptchaVerifier;

    try {
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, appVerifier);
      setConfirmationResult(confirmation);
      setIsOtpSent(true);
      alert("OTP sent to your phone.");
    } catch (error) {
      console.error("OTP send error:", error);
      alert("Failed to send OTP. Try again.");
    }
  };

  const handleVerifyOTP = async () => {
    if (!otp || !confirmationResult) return alert("Enter valid OTP.");

    try {
      await confirmationResult.confirm(otp);
      setVerified(true);
      alert("OTP verified successfully.");
    } catch (err) {
      alert("Invalid OTP. Please try again.");
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (verified) {
      alert("KYC submitted successfully.");
      onComplete(true);
    } else {
      alert("Please complete OTP verification.");
    }
  };

  // Cleanup on unmount (optional but good practice)
  useEffect(() => {
    return () => {
      if (window.recaptchaVerifier) {
        window.recaptchaVerifier.clear();
        window.recaptchaVerifier = null;
      }
    };
  }, []);

  return (
    <div>
      <Header />

      <div className="kyc-form">
        <h2>KYC Verification</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Full Name:
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </label>

          <label>
            Government ID Number:
            <input type="text" value={govtId} onChange={(e) => setGovtId(e.target.value)} required />
          </label>

          <label>
            Government ID Type:
            <select value={govtIdType} onChange={(e) => setGovtIdType(e.target.value)} required>
              <option value="">Select</option>
              <option value="Aadhaar">Aadhaar</option>
              <option value="PAN">PAN</option>
              <option value="Passport">Passport</option>
              <option value="Voter ID">Voter ID</option>
            </select>
          </label>

          <label>
            Upload ID (PDF/JPG/PNG):
            <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={handleFileChange} required />
          </label>

          <label>
            Mobile Number (+91...):
            <input type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} required />
          </label>

          <div id="recaptcha-container"></div>

          {!isOtpSent ? (
            <button type="button" onClick={handleSendOTP}>Send OTP</button>
          ) : (
            <>
              <input
                type="text"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                placeholder="Enter OTP"
                required
              />
              <button type="button" onClick={handleVerifyOTP}>Verify OTP</button>
            </>
          )}

          <button type="submit" disabled={!verified}>Submit KYC</button>
        </form>
      </div>
    </div>
  );
};

export default KYCForm;
