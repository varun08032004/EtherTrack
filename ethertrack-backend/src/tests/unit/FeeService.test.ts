// Unit Tests - Fee Calculation

import { FeeService } from '../../services/fee/FeeService.ts';
import { defaultTaxCalculator } from '../../domain/types.ts';

describe('FeeService', () => {
  let feeService;

  beforeEach(() => {
    feeService = new FeeService(defaultTaxCalculator, 100, '27AAAAA0000A1Z5', '27');
  });

  describe('calculateFees', () => {
    it('should calculate fees correctly for INR trade', () => {
      const grossAmount = 100000; // ₹1000.00 in paise
      const buyerFeeBps = 50; // 0.5%
      const sellerFeeBps = 50; // 0.5%

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      expect(result.buyerFee).toBe(500); // 0.5% of 100000 = 500 paise = ₹5.00
      expect(result.sellerFee).toBe(500);
      expect(result.buyerTotalDebit).toBe(grossAmount + result.buyerFee + result.buyerTax.totalTax);
      expect(result.sellerNetCredit).toBe(grossAmount - result.sellerFee - result.sellerTax.totalTax);
      expect(result.platformRevenue).toBe(result.buyerFee + result.sellerFee);
    });

    it('should use integer arithmetic (no floating point)', () => {
      const grossAmount = 123456; // ₹1234.56
      const buyerFeeBps = 50;
      const sellerFeeBps = 50;

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      // All values should be integers (paise)
      expect(Number.isInteger(result.buyerFee)).toBe(true);
      expect(Number.isInteger(result.sellerFee)).toBe(true);
      expect(Number.isInteger(result.buyerTax.totalTax)).toBe(true);
      expect(Number.isInteger(result.sellerTax.totalTax)).toBe(true);
      expect(Number.isInteger(result.buyerTotalDebit)).toBe(true);
      expect(Number.isInteger(result.sellerNetCredit)).toBe(true);
    });

    it('should satisfy financial invariant: buyerTotalDebit = sellerNetCredit + platformRevenue + taxes', () => {
      const grossAmount = 500000; // ₹5000.00
      const buyerFeeBps = 50;
      const sellerFeeBps = 50;

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      const totalTaxes = result.buyerTax.totalTax + result.sellerTax.totalTax;
      const expected = result.sellerNetCredit + result.platformRevenue + totalTaxes;
      
      expect(result.buyerTotalDebit).toBe(expected);
    });

    it('should calculate GST correctly at 18%', () => {
      const grossAmount = 100000;
      const buyerFeeBps = 50;
      const sellerFeeBps = 50;

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      const totalFee = result.buyerFee + result.sellerFee; // 1000 paise
      const expectedGST = Math.round(totalFee * 0.18); // 180 paise
      
      expect(result.buyerTax.totalTax + result.sellerTax.totalTax).toBe(expectedGST);
    });

    it('should split GST equally between CGST and SGST for intra-state', () => {
      const grossAmount = 100000;
      const buyerFeeBps = 50;
      const sellerFeeBps = 50;

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      const totalGST = result.buyerTax.totalTax + result.sellerTax.totalTax;
      const totalCGST = result.buyerTax.cgst + result.sellerTax.cgst;
      const totalSGST = result.buyerTax.sgst + result.sellerTax.sgst;

      expect(totalCGST + totalSGST).toBe(totalGST);
      expect(totalCGST).toBe(Math.floor(totalGST / 2));
      expect(totalSGST).toBe(totalGST - totalCGST);
    });

    it('should handle different fee rates for buyer and seller', () => {
      const grossAmount = 100000;
      const buyerFeeBps = 75; // 0.75%
      const sellerFeeBps = 25; // 0.25%

      const result = feeService.calculateFees(grossAmount, buyerFeeBps, sellerFeeBps);

      expect(result.buyerFee).toBe(750); // 0.75% of 100000
      expect(result.sellerFee).toBe(250); // 0.25% of 100000
    });
  });

  describe('Tax Calculation', () => {
    it('should calculate tax breakdown correctly', () => {
      const feeAmount = 1000; // ₹10.00
      const taxContext = {
        buyerGstin: null,
        sellerGstin: null,
        platformGstin: '27AAAAA0000A1Z5',
        placeOfSupply: '27',
        transactionType: 'B2B'
      };

      const tax = defaultTaxCalculator.calculate(feeAmount, 'BUYER', taxContext);

      expect(tax.taxableAmount).toBe(feeAmount);
      expect(tax.taxRate).toBe(0.18);
      expect(tax.totalTax).toBe(Math.round(feeAmount * 0.18));
      expect(tax.cgst + tax.sgst + tax.igst).toBe(tax.totalTax);
      expect(tax.hsCode).toBe('999799');
    });

    it('should handle IGST for inter-state transactions', () => {
      const feeAmount = 1000;
      const taxContext = {
        buyerGstin: '29AAAAA0000A1Z5', // Karnataka
        sellerGstin: '27AAAAA0000A1Z5', // Maharashtra
        platformGstin: '27AAAAA0000A1Z5',
        placeOfSupply: '29', // Karnataka (buyer state)
        transactionType: 'B2B'
      };

      const tax = defaultTaxCalculator.calculate(feeAmount, 'BUYER', taxContext);

      // For inter-state, should be IGST
      expect(tax.igst).toBeGreaterThan(0);
      expect(tax.cgst).toBe(0);
      expect(tax.sgst).toBe(0);
    });
  });
});