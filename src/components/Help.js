import React from 'react';
import './Help.css';

const Help = () => {
    return (
        <div className="help-container">
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
                        <h3>What is blockchain technology?</h3>
                        <p>Blockchain technology is a decentralized digital ledger that records transactions across many computers in a way that the registered transactions cannot be altered retroactively.</p>
                    </li>
                </ul>
            </section>
            <section className="help-section">
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
