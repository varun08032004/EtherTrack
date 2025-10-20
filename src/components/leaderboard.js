import React, { useState, useEffect } from 'react';
import './leaderboard.css';

const sampleData = [
    { rank: 1, name: 'Alice', volume: 15000 },
    { rank: 2, name: 'Bob', volume: 12000 },
    { rank: 3, name: 'Charlie', volume: 11000 },
    { rank: 4, name: 'Dave', volume: 9000 },
    { rank: 5, name: 'Eve', volume: 7500 },
    { rank: 6, name: 'Frank', volume: 7000 },
    { rank: 7, name: 'Grace', volume: 6500 },
    { rank: 8, name: 'Hank', volume: 6000 },
    { rank: 9, name: 'Ivy', volume: 5500 },
    { rank: 10, name: 'Jack', volume: 5000 },
];

const Leaderboard = () => {
    const [traders, setTraders] = useState(sampleData);
    const [sortOrder, setSortOrder] = useState('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const entriesPerPage = 5;

    // Sorting data based on the selected sort order
    useEffect(() => {
        const sortedData = [...traders].sort((a, b) => 
            sortOrder === 'asc' ? a.volume - b.volume : b.volume - a.volume
        );
        setTraders(sortedData);
    }, [sortOrder]);

    // Paginate the data
    const indexOfLastEntry = currentPage * entriesPerPage;
    const indexOfFirstEntry = indexOfLastEntry - entriesPerPage;
    const currentEntries = traders.slice(indexOfFirstEntry, indexOfLastEntry);

    const totalPages = Math.ceil(traders.length / entriesPerPage);

    const handlePageChange = (page) => {
        setCurrentPage(page);
    };

    return (
        <div className="leaderboard-container">
            <h2>Top Traders Leaderboard</h2>
            <div className="sort-controls">
                <button onClick={() => setSortOrder('asc')}>Sort Ascending</button>
                <button onClick={() => setSortOrder('desc')}>Sort Descending</button>
            </div>
            <table className="leaderboard-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Trader Name</th>
                        <th>Total Volume Traded</th>
                    </tr>
                </thead>
                <tbody>
                    {currentEntries.map((trader, index) => (
                        <tr key={index}>
                            <td>{index + 1 + (currentPage - 1) * entriesPerPage}</td>
                            <td>{trader.name}</td>
                            <td>${trader.volume.toLocaleString()}</td>
                        </tr>
                    ))}
                </tbody>
            </table>

            {/* Pagination Controls */}
            <div className="pagination">
                <button 
                    onClick={() => handlePageChange(currentPage - 1)} 
                    disabled={currentPage === 1}
                >
                    Previous
                </button>
                <span>{`Page ${currentPage} of ${totalPages}`}</span>
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

export default Leaderboard;
