import React from 'react';
import './LegalCompliance.css';

const LegalCompliance = () => {
    return (
        <div className="legal-compliance-container">
            <h1>Legal and Compliance Information</h1>
            <section className="legal-section">
                <h2>Legal Information</h2>
                <p>Here you'll find the legal terms and conditions of using Ethertrack.</p>
                {/* Add more legal information as needed */}
            </section>
            <section className="compliance-section">
                <h2>Compliance Information</h2>
                <p>Information regarding compliance with relevant regulations and standards.</p>
                {/* Add more compliance information as needed */}
            </section>
        </div>
    );
};

export default LegalCompliance;
