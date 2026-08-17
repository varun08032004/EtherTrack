// services/pdfQueue.js — EtherTrack PDF Generation Queue
// Offloads PDF generation to a background worker pool to keep API responsive
'use strict';

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { generateReport } = require('./pdfGenerator');
const { generateTradeInvoice, generateTradeBill, generateCertificatePDF } = require('./invoice');
const { sendTradeInvoiceEmail, sendTradeBillEthEmail } = require('./email');
const logger = require('./logger');

// Configuration
const WORKER_COUNT = parseInt(process.env.PDF_WORKER_COUNT) || 2;
const MAX_QUEUE_SIZE = parseInt(process.env.PDF_MAX_QUEUE_SIZE) || 100;
const JOB_TIMEOUT_MS = parseInt(process.env.PDF_JOB_TIMEOUT_MS) || 120000; // 2 minutes

// Job queue
const jobQueue = [];
let activeWorkers = 0;
let browserPool = [];

// Initialize Puppeteer browser pool
async function initBrowserPool() {
  for (let i = 0; i < WORKER_COUNT; i++) {
    try {
      const browser = await puppeteer.launch({
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
          '--allow-file-access-from-files',
          '--disable-web-security',
        ],
        headless: 'new',
      });
      browserPool.push(browser);
      console.log(`[pdfQueue] Worker ${i + 1}/${WORKER_COUNT} started`);
    } catch (e) {
      console.error(`[pdfQueue] Failed to start worker ${i + 1}:`, e.message);
    }
  }
}

// Job types
const JOB_TYPES = {
  REPORT: 'report',
  TRADE_INVOICE: 'trade_invoice',
  TRADE_BILL: 'trade_bill',
  CERTIFICATE: 'certificate',
};

// Job structure
class PDFJob {
  constructor(type, data, resolve, reject) {
    this.id = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.type = type;
    this.data = data;
    this.resolve = resolve;
    this.reject = reject;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedAt = null;
    this.attempts = 0;
  }
}

// Add job to queue
function enqueueJob(type, data) {
  return new Promise((resolve, reject) => {
    if (jobQueue.length >= MAX_QUEUE_SIZE) {
      reject(new Error('PDF queue full - try again later'));
      return;
    }
    const job = new PDFJob(type, data, resolve, reject);
    jobQueue.push(job);
    processQueue();
  });
}

// Process queue
async function processQueue() {
  if (activeWorkers >= WORKER_COUNT || jobQueue.length === 0) return;
  
  const job = jobQueue.shift();
  if (!job) return;
  
  activeWorkers++;
  job.startedAt = Date.now();
  job.attempts++;
  
  try {
    let result;
    switch (job.type) {
      case 'report':
        result = await generateReport(job.data.type, job.data.data);
        break;
      case 'trade_invoice':
        result = await generateTradeInvoice(job.data);
        break;
      case 'trade_bill':
        result = await generateTradeBill(job.data);
        break;
      case 'certificate':
        result = await generateCertificatePDF(job.data);
        break;
      default:
        throw new Error(`Unknown job type: ${job.type}`);
    }
    
    job.completedAt = Date.now();
    job.resolve(result);
    
    // Log performance metrics
    const duration = job.completedAt - job.startedAt;
    console.log(`[pdfQueue] Job ${job.id} (${job.type}) completed in ${duration}ms`);
    
  } catch (err) {
    job.completedAt = Date.now();
    console.error(`[pdfQueue] Job ${job.id} (${job.type}) failed:`, err.message);
    
    // Retry logic
    if (job.attempts < 3) {
      jobQueue.unshift(job); // Retry at front of queue
    } else {
      job.reject(err);
    }
  } finally {
    activeWorkers--;
    processQueue(); // Process next job
  }
}

// Public API
const pdfQueue = {
  // Generate report (BRSR, GHG, CDP, TCFD, GRI)
  generateReport: (type, data) => enqueueJob('report', { type, data }),
  
  // Generate trade invoice
  generateTradeInvoice: (data) => enqueueJob('trade_invoice', data),
  
  // Generate trade bill (ETH payment)
  generateTradeBill: (data) => enqueueJob('trade_bill', data),
  
  // Generate certificate
  generateCertificate: (data) => enqueueJob('certificate', data),
  
  // Queue status
  getStatus: () => ({
    queueLength: jobQueue.length,
    activeWorkers,
    maxWorkers: WORKER_COUNT,
    browserPoolSize: browserPool.length,
  }),
  
  // Graceful shutdown
  async shutdown() {
    console.log('[pdfQueue] Shutting down...');
    // Wait for active jobs to complete (max 30s)
    const timeout = setTimeout(() => {
      console.warn('[pdfQueue] Forced shutdown after timeout');
      process.exit(1);
    }, 30000);
    
    while (activeWorkers > 0 || jobQueue.length > 0) {
      await new Promise(r => setTimeout(r, 100));
    }
    
    clearTimeout(timeout);
    
    // Close browser pool
    for (const browser of browserPool) {
      try {
        await browser.close();
      } catch (e) {
        console.warn('[pdfQueue] Error closing browser:', e.message);
      }
    }
    browserPool = [];
    console.log('[pdfQueue] Shutdown complete');
  },
};

// Initialize on module load
initBrowserPool().catch(e => console.error('[pdfQueue] Failed to init:', e));

// Handle graceful shutdown
process.on('SIGTERM', () => pdfQueue.shutdown());
process.on('SIGINT', () => pdfQueue.shutdown());

module.exports = { pdfQueue, enqueueJob, PDFJob };