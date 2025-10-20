import axios from 'axios';

const BASE_URL = 'https://api.carboncredits.com/v1';
const API_TOKEN = process.env.REACT_APP_CARBON_API_TOKEN;
const API_SECRET = process.env.REACT_APP_CARBON_API_SECRET;

const headers = {
    'Authorization': `Bearer ${API_TOKEN}`,
    'X-Secret': API_SECRET,
    'Content-Type': 'application/json'
};

export const fetchVerifiedCredits = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/credits`, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching verified credits:', error);
        return [];
    }
};

export const fetchOrderBook = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/orderbook`, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching order book:', error);
        return { buyOrders: [], sellOrders: [] };
    }
};

export const fetchRealTimePrices = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/market/prices`, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching real-time prices:', error);
        return {};
    }
};

export const fetchPriceHistory = async () => {
    try {
        const response = await axios.get(`${BASE_URL}/market/price-history`, { headers });
        return response.data;
    } catch (error) {
        console.error('Error fetching price history:', error);
        return [];
    }
};

// Additional Feature: Placing Orders (Market, Limit, Stop-Loss)
export const placeOrder = async (orderType, creditId, amount, price = 0) => {
    try {
        const response = await axios.post(
            `${BASE_URL}/orders`,
            { orderType, creditId, amount, price },
            { headers }
        );
        return response.data;
    } catch (error) {
        console.error(`Error placing ${orderType} order:`, error);
        return null;
    }
};