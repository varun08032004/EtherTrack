// Import necessary libraries and styles
import React, { useState, useEffect, useCallback } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend } from 'chart.js';
import './EmissionTracking.css';

// Register necessary chart components
ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement, Tooltip, Legend);

// Add a loading spinner component
const LoadingSpinner = () => (
    <div className="loading-spinner">
        <div className="spinner"></div>
    </div>
);

// Component for Input Data
const InputData = ({ onAddData }) => {
    const [date, setDate] = useState('');
    const [source, setSource] = useState('');
    const [amount, setAmount] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onAddData({ date, source, amount: parseFloat(amount) });
        setDate('');
        setSource('');
        setAmount('');
    };

    return (
        <div className="input-data">
            <h2>Input Data</h2>
            <form onSubmit={handleSubmit}>
                <label>
                    Date:
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <label>
                    Source:
                    <input type="text" value={source} onChange={(e) => setSource(e.target.value)} required />
                </label>
                <label>
                    Amount (tons):
                    <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
                </label>
                <button type="submit" className="btn-primary">Add Data</button>
            </form>
        </div>
    );
};

// Component for Report Generation
const ReportGeneration = ({ emissions }) => {
    const generateReport = () => {
        // Logic for generating reports, e.g., PDF generation
        console.log('Generating report for emissions:', emissions);
    };

    return (
        <div className="report-generation">
            <h2>Report Generation</h2>
            <button onClick={generateReport} className="btn-secondary">Generate Report</button>
        </div>
    );
};

// Component for Enhanced Analysis
const EnhancedAnalysis = ({ emissions }) => {
    const totalEmissions = emissions.reduce((acc, emission) => acc + emission.amount, 0);
    const averageEmissions = (totalEmissions / emissions.length) || 0;

    return (
        <div className="enhanced-analysis">
            <h2>Enhanced Analysis</h2>
            <p>Total Emissions: {totalEmissions.toFixed(2)} tons</p>
            <p>Average Emissions: {averageEmissions.toFixed(2)} tons</p>
        </div>
    );
};

// Main Emission Tracking Component
const EmissionTracking = () => {
    const [emissions, setEmissions] = useState([]);
    const [filteredEmissions, setFilteredEmissions] = useState([]);
    const [currentView, setCurrentView] = useState('inputData');
    const [loading, setLoading] = useState(false);
    const [filterSource, setFilterSource] = useState('');
    const [filterDate, setFilterDate] = useState('');
    const [filterAmount, setFilterAmount] = useState('');
    const [sortOption, setSortOption] = useState('date');
    const [realTimeEnabled, setRealTimeEnabled] = useState(true);
    const [newEmissionAlert, setNewEmissionAlert] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 5;

    // Fetch Emissions Data Initially and Set Interval for Auto-refresh
    useEffect(() => {
        const fetchEmissionsData = async () => {
            setLoading(true);
            try {
                const fetchedEmissions = await fetchEmissionData();
                setEmissions(fetchedEmissions);
                setFilteredEmissions(fetchedEmissions);
                setNewEmissionAlert('New emission data added.');
            } catch (error) {
                console.error('Error fetching emissions data:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchEmissionsData();

        // Real-time update every minute (if enabled)
        const interval = realTimeEnabled ? setInterval(fetchEmissionsData, 60000) : null;

        return () => clearInterval(interval);
    }, [realTimeEnabled]);

    // Mock function to simulate fetching emissions data
    const fetchEmissionData = async () => {
        // Replace this with your actual data fetching logic
        return [
            { date: '2024-09-01', source: 'Coal', amount: 2.5 },
            { date: '2024-09-02', source: 'Natural Gas', amount: 1.2 },
            { date: '2024-09-02', source: 'Coal', amount: 3.0 },
            { date: '2024-09-03', source: 'Oil', amount: 4.5 },
            { date: '2024-09-04', source: 'Renewable', amount: 0.8 },
            // Add more mock data as needed
        ];
    };

    const handleAddData = (newData) => {
        setEmissions((prevEmissions) => [...prevEmissions, newData]);
        setFilteredEmissions((prevFiltered) => [...prevFiltered, newData]);
        setNewEmissionAlert('New emission data added.');
    };

    const applyFiltersAndSort = useCallback(() => {
        let filtered = emissions;

        if (filterSource) {
            filtered = filtered.filter(emission =>
                emission.source.toLowerCase().includes(filterSource.toLowerCase())
            );
        }

        if (filterDate) {
            filtered = filtered.filter(emission => emission.date === filterDate);
        }

        if (filterAmount) {
            const amountValue = parseFloat(filterAmount);
            filtered = filtered.filter(emission => emission.amount >= amountValue);
        }

        filtered.sort((a, b) => {
            if (sortOption === 'date') {
                return new Date(a.date) - new Date(b.date);
            } else if (sortOption === 'amount') {
                return a.amount - b.amount;
            }
            return 0;
        });

        setFilteredEmissions(filtered);
    }, [emissions, filterSource, filterDate, filterAmount, sortOption]);

    useEffect(() => {
        applyFiltersAndSort();
    }, [applyFiltersAndSort]);

    const handleFilterSourceChange = (e) => {
        const value = e.target.value;
        setFilterSource(value);
    };

    const handleFilterDateChange = (e) => {
        const value = e.target.value;
        setFilterDate(value);
    };

    const handleFilterAmountChange = (e) => {
        const value = e.target.value;
        setFilterAmount(value);
    };

    const handleSortChange = (e) => {
        const option = e.target.value;
        setSortOption(option);
    };

    const handleExportData = () => {
        const csvData = emissions.map(emission => `${emission.date},${emission.source},${emission.amount}`).join('\n');
        const blob = new Blob([csvData], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'emissions_data.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const toggleRealTimeUpdates = () => {
        setRealTimeEnabled(!realTimeEnabled);
    };

    const itemsStart = (currentPage - 1) * itemsPerPage;
    const currentEmissions = filteredEmissions.slice(itemsStart, itemsStart + itemsPerPage);
    const totalPages = Math.ceil(filteredEmissions.length / itemsPerPage);

    return (
        <div className="emission-tracking">
            <h1>Emission Tracking</h1>

            {/* Notification for New Emission Alert */}
            {newEmissionAlert && <div className="notification">{newEmissionAlert}</div>}

            {/* Filters and Export Section */}
            <div className="filters">
                <label>
                    Filter by Source:
                    <input type="text" value={filterSource} onChange={handleFilterSourceChange} />
                </label>
                <label>
                    Filter by Date:
                    <input type="date" value={filterDate} onChange={handleFilterDateChange} />
                </label>
                <label>
                    Filter by Amount:
                    <input type="number" value={filterAmount} onChange={handleFilterAmountChange} />
                </label>
                <label>
                    Sort by:
                    <select value={sortOption} onChange={handleSortChange}>
                        <option value="date">Date</option>
                        <option value="amount">Amount</option>
                    </select>
                </label>
                <button onClick={handleExportData} className="btn-secondary">Export Data</button>
                <button onClick={toggleRealTimeUpdates} className="btn-secondary">
                    {realTimeEnabled ? 'Disable Real-time Updates' : 'Enable Real-time Updates'}
                </button>
            </div>

            {/* Display Loading Spinner */}
            {loading ? <LoadingSpinner /> : (
                <>
                    {/* Input Data Section */}
                    {currentView === 'inputData' && <InputData onAddData={handleAddData} />}

                    {/* Chart Display */}
                    <div className="chart">
                        <Line
                            data={{
                                labels: filteredEmissions.map(emission => emission.date),
                                datasets: [{
                                    label: 'Emissions (tons)',
                                    data: filteredEmissions.map(emission => emission.amount),
                                    borderColor: 'rgba(75,192,192,1)',
                                    backgroundColor: 'rgba(75,192,192,0.2)',
                                    fill: true,
                                }]
                            }}
                            options={{
                                responsive: true,
                                plugins: {
                                    legend: {
                                        display: true,
                                        position: 'top',
                                    },
                                },
                            }}
                        />
                    </div>

                    {/* Enhanced Analysis and Report Generation Sections */}
                    <EnhancedAnalysis emissions={filteredEmissions} />
                    <ReportGeneration emissions={filteredEmissions} />

                    {/* Pagination Controls */}
                    <div className="pagination">
                        <button disabled={currentPage === 1} onClick={() => setCurrentPage(prev => prev - 1)}>Previous</button>
                        <span>Page {currentPage} of {totalPages}</span>
                        <button disabled={currentPage === totalPages} onClick={() => setCurrentPage(prev => prev + 1)}>Next</button>
                    </div>
                </>
            )}
        </div>
    );
};

export default EmissionTracking;
