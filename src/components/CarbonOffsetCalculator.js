import React, { useState, useEffect } from 'react';
import './CarbonOffsetCalculator.css';

const CarbonOffsetCalculator = () => {
    const [activity, setActivity] = useState('car');
    const [value, setValue] = useState('');
    const [carbonCredits, setCarbonCredits] = useState(0);
    const [error, setError] = useState(null);

    // Function to calculate carbon emissions dynamically
    const calculateCarbonCredits = (activity, value) => {
        let emissions = 0;
        if (activity === 'car') {
            emissions = value * 0.0003;
        } else if (activity === 'plane') {
            emissions = value * 0.2;
        } else if (activity === 'electricity') {
            emissions = value * 0.0005;
        }
        return emissions;
    };

    // Effect hook to update the calculation in real time
    useEffect(() => {
        if (value && !isNaN(value) && value > 0) {
            setCarbonCredits(calculateCarbonCredits(activity, parseFloat(value)));
            setError(null);
        } else {
            setCarbonCredits(0);
            setError(value ? 'Please enter a valid positive number.' : null);
        }
    }, [activity, value]);

    return (
        <div className="calculator-container">
            <h2>Carbon Offset Calculator</h2>
            <div>
                <label>Activity Type:</label>
                <select value={activity} onChange={(e) => setActivity(e.target.value)}>
                    <option value="car">Car</option>
                    <option value="plane">Plane</option>
                    <option value="electricity">Electricity</option>
                </select>
            </div>

            <div>
                <label>Value:</label>
                <input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Enter value (miles, kWh, etc.)"
                />
            </div>

            {error && <p className="error">{error}</p>}

            {carbonCredits > 0 && (
                <div className="results-container">
                    <h3>Results:</h3>
                    <p>Carbon Emissions: {carbonCredits.toFixed(4)} tons of CO2</p>
                    <p>Carbon Credits Needed: {carbonCredits.toFixed(4)} credits</p>
                </div>
            )}
        </div>
    );
};

export default CarbonOffsetCalculator;
