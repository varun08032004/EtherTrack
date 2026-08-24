fetch('http://localhost:5000/api/market/listings')
  .then(r => r.json())
  .then(d => {
    if (d.listings && d.listings.length > 0) {
      console.log('First listing keys:', Object.keys(d.listings[0]));
      console.log('First listing:', JSON.stringify(d.listings[0], null, 2));
    } else {
      console.log('No listings');
    }
  })
  .catch(console.error);