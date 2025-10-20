import React from 'react';
import './Footer.css'; // Import the CSS file

const Footer = () => {
  return (
    <footer className="footer">
      <div className="footer-container">
        <div className="footer-logo">
    
        </div>
      </div>
      <div className="footer-copyright">
        <p>&copy; {new Date().getFullYear()} EtherTrack. All Rights Reserved.</p>
      </div>
    </footer>
  );
};

export default Footer;
