require('dotenv').config({ path: 'C:\\Users\\ASUS\\Desktop\\EtherTrack\\ethertrack-backend\\.env' });
const { getMarketListings } = require('./services/cacheStrategy');

getMarketListings({})
  .then(r => {
    console.log('Total listings:', r.length);
    r.forEach(l => console.log(`  ${l.project_name} (token ${l.token_id}) - type: ${l.listing_type}, amount: ${l.amount}, listing_id: ${l.listing_id}`));
  })
  .catch(console.error);