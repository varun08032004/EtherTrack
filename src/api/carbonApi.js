// api function to fetch the price of carbon credits from TradingView or another API
export const getCarbonCreditPriceFromAPI = async (currency) => {
    try {
        const response = await fetch(`https://api.tradingview.com/carbon-market/price?currency=${currency}`);
        
        if (response.ok) {
            const data = await response.json();
            return data.price; // Assuming the response has 'price' field
        } else {
            throw new Error('Failed to fetch price data');
        }
    } catch (error) {
        console.error(error);
        return null;
    }
};
