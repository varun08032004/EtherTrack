fetch('http://localhost:5000/api/market/listings?standard=ALL&projectType=ALL&sortBy=priceAsc')
  .then(r => r.json())
  .then(d => console.log('API Total:', d.listings?.length, 'count:', d.count, 'Ledger:', d.listings?.filter(x => x.listing_type === 'ledger').length))
  .catch(console.error);