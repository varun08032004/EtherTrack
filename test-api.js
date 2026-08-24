fetch('http://localhost:5000/api/market/listings')
  .then(r => r.json())
  .then(d => console.log('Total:', d.listings?.length, 'Ledger:', d.listings?.filter(x => x.listing_type === 'ledger').length, 'Wallet:', d.listings?.filter(x => x.listing_type === 'wallet').length))
  .catch(console.error);