import React from 'react';
import './Help.css';

const Help = () => {
    return (
        <div className="help-page-container">
            <h1>Help & Support</h1>

            <section className="help-section">
                <h2>Frequently Asked Questions (FAQ)</h2>
                <ul>
                    <li>
                        <h3>How do I reset my password?</h3>
                        <p>To reset your password, go to the <a href="/settings">Settings</a> page and click on "Reset Password". Follow the instructions sent to your email.</p>
                    </li>
                    <li>
                        <h3>How can I contact support?</h3>
                        <p>You can contact support by emailing us at <a href="mailto:support@ethertrack.com">support@ethertrack.com</a> or using the contact form on our <a href="/contact">Contact Us</a> page.</p>
                    </li>
                    <li>
                        <h3>How do I verify my identity (KYC) on EtherTrack?</h3>
                        <p>To verify your identity, navigate to the KYC Verification section under your profile settings. Upload the required documents and follow the instructions provided. Verification may take up to 24 hours.</p>
                    </li>
                    <li>
                        <h3>How can I calculate my carbon footprint?</h3>
                        <p>You can use the Carbon Offset Calculator in the Carbon Credits Trading section. Simply input details like energy consumption, travel data, and lifestyle habits to estimate your carbon footprint.</p>
                    </li>
                    <li>
                        <h3>What is a smart contract, and how does it work in EtherTrack?</h3>
                        <p>A smart contract is a self-executing contract with the terms of the agreement directly written into code. In EtherTrack, smart contracts are used to ensure secure, automated transactions when trading carbon credits.</p>
                    </li>
                    <li>
                        <h3>How do I connect my MetaMask wallet to EtherTrack?</h3>
                        <p>To connect your MetaMask wallet, go to the Carbon Credits Trading section and click the "Connect Wallet" button. Follow the on-screen prompts to securely link your account.</p>
                    </li>
                    <li>
                        <h3>What happens if my transaction fails?</h3>
                        <p>If a transaction fails, check your wallet balance, gas fees, and network connection. If the issue persists, contact our support team for assistance.</p>
                    </li>
                    <li>
                        <h3>How can I track my carbon credit transactions?</h3>
                        <p>Your transaction history is available in the Carbon Credits Trading section under "Transaction History". Here, you can view completed, pending, or failed transactions with full details.</p>
                    </li>
                </ul>
            </section>

            <section className="help-section contact-section">
                <h2>Contact Us</h2>
                <p>If you need further assistance, please reach out to our support team:</p>
                <ul>
                    <li>Email: <a href="mailto:support@ethertrack.com">support@ethertrack.com</a></li>
                    <li>Phone: +1 (123) 456-7890</li>
                </ul>
            </section>
        </div>
    );
};

export default Help;