import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './MyCredits.css';

const MyCredits = () => {
  const navigate = useNavigate();
  const [hasCredits, setHasCredits] = useState(null);
  const [countries, setCountries] = useState([]); // Country options for the Location dropdown
  const [verificationStandards, setVerificationStandards] = useState([]); // Available verification standards

  const [userCredits, setUserCredits] = useState(null); // User's registered credits
  
  // Fetch the list of countries and verification standards
  useEffect(() => {
    const fetchCountries = async () => {
      const countryList = [
        'Australia', 'Brazil', 'Canada', 'China', 'India', 'United States', 'Germany',
        'United Kingdom', 'France', 'Mexico', 'South Africa', 'Japan'
      ];
      setCountries(countryList);
    };

    const fetchVerificationStandards = () => {
      const standardsList = [
        'Verra', 'Gold Standard', 'CDM (Clean Development Mechanism)', 'AIE (American International Standard)',
        'VCS (Verified Carbon Standard)', 'CarbonFix', 'Plan Vivo', 'CERS (Certified Emission Reduction)'
      ];
      setVerificationStandards(standardsList);
    };

    fetchCountries();
    fetchVerificationStandards();
    
    // Simulate fetching user's credits from backend
    const fetchUserCredits = () => {
      const userData = [
        {
          credits: 10, // Example of user registered credits
          type: 'Reforestation',
          category: 'Offset',
          rating: 4,
          location: 'Brazil',
          projectDetails: 'Forest conservation project in the Amazon.',
          verification: 'Verra'
        },
        {
          credits: 20,
          type: 'Renewable Energy',
          category: 'Retirement',
          rating: 5,
          location: 'Canada',
          projectDetails: 'Wind energy project in the Canadian prairies.',
          verification: 'Gold Standard'
        }
      ];
      setUserCredits(userData);
    };

    fetchUserCredits();
  }, []);

  // Handle radio button change for "Do you have carbon credits?"
  const handleHasCreditsChange = (event) => {
    setHasCredits(event.target.value === 'yes');
  };

  // Redirect to the emission tracking page
  const handleRedirectToCalculator = () => {
    navigate('/emission-tracking');
  };

  return (
    <div className="my-credits-container">
      <h2>Do you have carbon credits?</h2>
      <div className="radio-buttons">
        <label>
          <input
            type="radio"
            value="yes"
            onChange={handleHasCreditsChange}
          />
          Yes
        </label>
        <label>
          <input
            type="radio"
            value="no"
            onChange={handleHasCreditsChange}
          />
          No
        </label>
      </div>

      {/* If the user has carbon credits, show the form for entering details */}
      {hasCredits && (
        <div className="credits-form">
          <h3>Carbon Credit Details</h3>
          <form>
            <div className="form-group">
              <label>Type of Carbon Credits</label>
              <select>
                <option value="renewable_energy">Renewable Energy</option>
                <option value="reforestation">Reforestation</option>
                <option value="energy_efficiency">Energy Efficiency</option>
              </select>
            </div>
            <div className="form-group">
              <label>Category</label>
              <select>
                <option value="offset">Offset</option>
                <option value="retirement">Retirement</option>
              </select>
            </div>
            <div className="form-group">
              <label>Rating</label>
              <input type="number" min="1" max="5" />
            </div>
            <div className="form-group">
              <label>Location</label>
              <select>
                {countries.map((country, index) => (
                  <option key={index} value={country}>{country}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Project Details</label>
              <textarea></textarea>
            </div>
            <div className="form-group">
              <label>Amount of Carbon Credits</label>
              <input type="number" />
            </div>
            {/* Adding the new "Verification Standard" dropdown */}
            <div className="form-group">
              <label>Credits Verification Standard</label>
              <select>
                {verificationStandards.map((standard, index) => (
                  <option key={index} value={standard}>{standard}</option>
                ))}
              </select>
            </div>
          </form>
        </div>
      )}

      {/* If the user doesn't have carbon credits, show the option to calculate credits */}
      {!hasCredits && (
        <div className="no-credits">
          <p>If you don't have carbon credits, would you like to calculate them?</p>
          <button onClick={handleRedirectToCalculator}>Calculate Carbon Credits</button>
        </div>
      )}

      {/* Display user's registered credits if they exist */}
      {userCredits && (
        <div className="user-credits">
          <h3>Your Registered Carbon Credits</h3>
          <table className="credits-table">
            <thead>
              <tr>
                <th>Credits</th>
                <th>Type</th>
                <th>Category</th>
                <th>Rating</th>
                <th>Location</th>
                <th>Project Details</th>
                <th>Verification Standard</th>
              </tr>
            </thead>
            <tbody>
              {userCredits.map((credit, index) => (
                <tr key={index}>
                  <td>{credit.credits}</td>
                  <td>{credit.type}</td>
                  <td>{credit.category}</td>
                  <td>{credit.rating}</td>
                  <td>{credit.location}</td>
                  <td>{credit.projectDetails}</td>
                  <td>{credit.verification}</td> {/* Display the verification standard */}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MyCredits;
