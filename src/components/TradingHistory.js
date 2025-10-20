import React, { useState } from 'react';
import './TradingHistory.css';

const TradingHistory = () => {
    const mockData = [
        { market: 'CARBON/USD', size: 10, price: 20.5, time: '14:30' },
        { market: 'CARBON/EUR', size: 5, price: 18.2, time: '14:32' },
        { market: 'CARBON/GBP', size: 8, price: 22.1, time: '14:35' },
        { market: 'CARBON/USD', size: 9, price: 11.4, time: '11:25' },
        { market: 'CARBON/USD', size: 7, price: 21.3, time: '14:40' },
        { market: 'CARBON/EUR', size: 4, price: 19.5, time: '14:50' },
        { market: 'CARBON/GBP', size: 3, price: 20.0, time: '15:00' },
        { market: 'CARBON/USD', size: 6, price: 17.8, time: '15:10' },
        { market: 'CARBON/USD', size: 5, price: 20.0, time: '15:15' },
        { market: 'CARBON/EUR', size: 10, price: 18.7, time: '15:25' },
    ];

    const itemsPerPage = 5;
    const [currentPage, setCurrentPage] = useState(1);

    const indexOfLastEntry = currentPage * itemsPerPage;
    const indexOfFirstEntry = indexOfLastEntry - itemsPerPage;
    const currentEntries = mockData.slice(indexOfFirstEntry, indexOfLastEntry);

    const totalPages = Math.ceil(mockData.length / itemsPerPage);

    const handlePageChange = (pageNumber) => {
        setCurrentPage(pageNumber);
    };

    return (
        <div className="trade-history">
            <h3>Trading History</h3>
            <table>
                <thead>
                    <tr>
                        <th>Market</th>
                        <th>Size</th>
                        <th>Price (USD)</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    {currentEntries.map((entry, index) => (
                        <tr key={index}>
                            <td>{entry.market}</td>
                            <td>{entry.size}</td>
                            <td>{entry.price}</td>
                            <td>{entry.time}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            <div className="pagination">
                <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                >
                    Prev
                </button>
                {[...Array(totalPages)].map((_, index) => (
                    <button
                        key={index}
                        onClick={() => handlePageChange(index + 1)}
                        className={currentPage === index + 1 ? 'active' : ''}
                    >
                        {index + 1}
                    </button>
                ))}
                <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === totalPages}
                >
                    Next
                </button>
            </div>
        </div>
    );
};

export default TradingHistory;
