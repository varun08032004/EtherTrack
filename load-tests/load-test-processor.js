// Artillery processor for custom logic
module.exports = {
  // Called before each request
  beforeRequest: (requestParams, context, ee, next) => {
    // Add request ID for tracing
    requestParams.headers['X-Request-ID'] = `load-test-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    next();
  },

  // Called after each response
  afterResponse: (requestParams, response, context, ee, next) => {
    // Track metrics
    if (response.statusCode >= 500) {
      ee.emit('counter', 'errors.5xx', 1);
    } else if (response.statusCode >= 400) {
      ee.emit('counter', 'errors.4xx', 1);
    }

    // Track response times
    ee.emit('histogram', 'response_time', response.timings.response);

    // Track specific endpoints
    if (requestParams.url.includes('/api/trades/buy')) {
      ee.emit('counter', 'trades.attempted', 1);
      if (response.statusCode === 200) {
        ee.emit('counter', 'trades.success', 1);
      } else if (response.statusCode === 409) {
        ee.emit('counter', 'trades.conflict', 1);
      }
    }

    next();
  },

  // Custom scenarios
  scenarios: {
    // Concurrent trade attempts for same listing
    concurrentTrade: function* (context, ee) {
      const listingId = context.vars.listingId;
      const authToken = context.vars.authToken;

      // Two virtual users trying to buy same listing
      yield {
        post: {
          url: `/api/trades/buy`,
          headers: {
            Authorization: `Bearer ${authToken}`,
            'Content-Type': 'application/json',
            'X-Request-ID': `concurrent-${Date.now()}-1`
          },
          json: {
            listing_id: listingId,
            quantity: 1,
            price_per_credit: 1500,
            payment_mode: 'inr',
            idempotency_key: `concurrent-test-1-${Date.now()}`
          }
        }
      };
    }
  }
};