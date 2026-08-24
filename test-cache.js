require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { getMarketListings } = require('./ethertrack-backend/services/cacheStrategy');

getMarketListings({})
  .then(r => {
    console.log('Total:', r.length);
    console.log('Ledger:', r.filter(x => x.listing_type === 'ledger').length);
    console.log('Wallet:', r.filter(x => x.listing_type === 'wallet').length);
    console.log('First few:', r.slice(0,3).map(x => ({token: x.token_id, amount: x.amount, type: x.listing_type})));
  })
  .catch(console.error);