// src/utils/fetchHelpers.js
// Retry logic + abort controller helpers for all API calls

/**
 * Retries an async function with exponential backoff.
 * Usage:
 *   const data = await fetchWithRetry(() => apiFetch('/api/portfolio/my-credits'));
 */
export const fetchWithRetry = async (fn, retries = 3, delay = 800) => {
  try {
    return await fn();
  } catch (err) {
    if (err.name === 'AbortError') throw err; // never retry aborted requests
    if (retries === 0) throw err;
    await new Promise(r => setTimeout(r, delay));
    return fetchWithRetry(fn, retries - 1, delay * 2);
  }
};

/**
 * Creates an AbortController and returns the signal + a cleanup function.
 * Usage in useEffect:
 *   const { signal, abort } = makeAbortable();
 *   apiFetch('/api/...', { signal });
 *   return abort; // cleanup
 */
export const makeAbortable = () => {
  const controller = new AbortController();
  return {
    signal: controller.signal,
    abort:  () => controller.abort(),
  };
};

/**
 * Wraps apiFetch with abort + retry.
 * Ignores AbortError so unmounted components don't log errors.
 */
export const safeFetch = async (apiFetch, url, options = {}, retries = 2) => {
  try {
    return await fetchWithRetry(() => apiFetch(url, options), retries);
  } catch (err) {
    if (err.name === 'AbortError') return null;
    throw err;
  }
};