import React, { useEffect, useState } from 'react';
import './OrderBook.css';

const ITEMS_PER_PAGE = 18;

const OrderBook = () => {
    const [buyOrders, setBuyOrders] = useState([]);
    const [sellOrders, setSellOrders] = useState([]);
    const [showBuyOrders, setShowBuyOrders] = useState(true);
    const [showSellOrders, setShowSellOrders] = useState(false);
    const [sortBy, setSortBy] = useState('price');
    const [currentPage, setCurrentPage] = useState(1);

    useEffect(() => {
        const sampleData = {
            buyOrders: [
                { id: 1, marketSize: 100, asset: "CO2 Token", price: 45.50 },
                { id: 2, marketSize: 200, asset: "Green Energy", price: 43.80 },
                { id: 3, marketSize: 150, asset: "Eco Coin", price: 40.20 },
                { id: 4, marketSize: 250, asset: "Nature Credits", price: 39.90 },
                { id: 5, marketSize: 180, asset: "Solar Credit", price: 38.70 },
                { id: 6, marketSize: 300, asset: "Wind Token", price: 36.40 },
                { id: 7, marketSize: 80, asset: "BioFuel Credit", price: 34.50 },
                { id: 8, marketSize: 220, asset: "Ocean Carbon", price: 33.20 },
                { id: 9, marketSize: 90, asset: "Nature Green", price: 32.00 },
                { id: 10, marketSize: 50, asset: "Air Clean", price: 30.10 },
                { id: 11, marketSize: 120, asset: "SolarWave", price: 28.50 },
                { id: 12, marketSize: 60, asset: "EcoToken", price: 27.20 },
                { id: 13, marketSize: 170, asset: "Nature Drive", price: 25.40 },
                { id: 14, marketSize: 190, asset: "GreenWorld", price: 23.70 },
                { id: 15, marketSize: 210, asset: "Carbon Boost", price: 21.90 },
                { id: 16, marketSize: 300, asset: "Solar", price: 23.00}
            ],
            sellOrders: [
                { id: 1, marketSize: 150, asset: "CO2 Token", price: 46.00 },
                { id: 2, marketSize: 250, asset: "Green Energy", price: 44.50 },
                { id: 3, marketSize: 120, asset: "Eco Coin", price: 41.00 },
                { id: 4, marketSize: 200, asset: "Nature Credits", price: 40.00 },
                { id: 5, marketSize: 300, asset: "Solar Credit", price: 39.50 },
                { id: 6, marketSize: 400, asset: "Wind Token", price: 37.00 },
                { id: 7, marketSize: 90, asset: "BioFuel Credit", price: 35.80 },
                { id: 8, marketSize: 260, asset: "Ocean Carbon", price: 34.00 },
                { id: 9, marketSize: 100, asset: "Nature Green", price: 32.80 },
                { id: 10, marketSize: 150, asset: "Air Clean", price: 31.50 },
                { id: 11, marketSize: 80, asset: "SolarWave", price: 29.00 },
                { id: 12, marketSize: 200, asset: "EcoToken", price: 28.00 },
                { id: 13, marketSize: 140, asset: "Nature Drive", price: 26.70 },
                { id: 14, marketSize: 180, asset: "GreenWorld", price: 24.50 },
                { id: 15, marketSize: 210, asset: "Carbon Boost", price: 22.30 }
            ]
        };
        setBuyOrders(sampleData.buyOrders);
        setSellOrders(sampleData.sellOrders);
    }, []);

    const calculateSpread = () => {
        if (!buyOrders.length || !sellOrders.length) return "-";
        const highestBid = Math.max(...buyOrders.map(order => order.price));
        const lowestAsk = Math.min(...sellOrders.map(order => order.price));
        return (lowestAsk - highestBid).toFixed(2);
    };

     const sortOrders = (orders) => {
        return [...orders].sort((a, b) => a[sortBy] - b[sortBy]);
    };

    const paginatedOrders = (orders) => {
        const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
        return orders.slice(startIndex, startIndex + ITEMS_PER_PAGE);
    };

    const handleOrderClick = (order) => {
        alert(`Selected Order:\nAsset: ${order.asset}\nPrice: ${order.price} USD\nMarket Size: ${order.marketSize}`);
    };

    const totalPages = (orders) => Math.ceil(orders.length / ITEMS_PER_PAGE);

    return (
        <div className="order-book">
            <h2>Order Book</h2>

            <div className="order-book-controls">
                <button onClick={() => { setShowBuyOrders(true); setShowSellOrders(false); setCurrentPage(1); }}>Buy Orders</button>
                <button onClick={() => { setShowBuyOrders(false); setShowSellOrders(true); setCurrentPage(1); }}>Sell Orders</button>
            </div>

            <div className="sort-controls">
                <label>Sort By:</label>
                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                    <option value="price">Price</option>
                    <option value="marketSize">Market Size</option>
                    <option value="asset">Asset/Group</option>
                </select>
            </div>

            <div className="order-list">
                {showBuyOrders && (
                    <div className="order-column buy-orders">
                        <h3>Buy Orders</h3>
                        <div className="order-header">
                        
                            <span>Market Size</span>
                            <span>Asset/Group</span>
                            <span>Price</span>
                        </div>
                        {paginatedOrders(sortOrders(buyOrders)).map(order => (
                            <div 
                                key={order.id} 
                                className="buy-order order-item"
                                onClick={() => handleOrderClick(order)}
                            >
                                <span>{order.marketSize}</span>
                                <span>{order.asset}</span>
                                <span className="price-up">{order.price} USD</span>
                            </div>
                        ))}
                    </div>
                )}

                {showSellOrders && (
                    <div className="order-column sell-orders">
                        <h3>Sell Orders</h3>
                        <div className="order-header">
                            <span>Market Size</span>
                            <span>Asset/Group</span>
                            <span>Price</span>
                        </div>
                        {paginatedOrders(sortOrders(sellOrders)).map(order => (
                            <div 
                                key={order.id} 
                                className="sell-order order-item"
                                onClick={() => handleOrderClick(order)}
                            >
                                <span>{order.marketSize}</span>
                                <span>{order.asset}</span>
                                <span className="price-down">{order.price} USD</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Pagination Controls */}
            <div className="pagination">
                <button 
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))} 
                    disabled={currentPage === 1}
                >
                    Previous
                </button>
                <span>Page {currentPage} of {totalPages(showBuyOrders ? buyOrders : sellOrders)}</span>
                <button 
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages(showBuyOrders ? buyOrders : sellOrders)))}
                    disabled={currentPage === totalPages(showBuyOrders ? buyOrders : sellOrders)}
                >
                    Next
                </button>
            </div>

            <div className="spread">
                Spread: {calculateSpread()} USD
            </div>
        </div>
    );
};



export default OrderBook;
