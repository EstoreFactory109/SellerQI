/**
 * Tests for ConvertToJSON utility
 */

const convertTSVToJson = require('../../utils/ConvertToJSON.js');

describe('convertTSVToJson', () => {
  describe('basic conversion', () => {
    it('should convert simple TSV to JSON array', () => {
      const tsv = 'name\tage\tcity\nJohn\t30\tNew York\nJane\t25\tLos Angeles';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '30', city: 'New York' },
        { name: 'Jane', age: '25', city: 'Los Angeles' },
      ]);
    });

    it('should handle single row of data', () => {
      const tsv = 'name\tage\nJohn\t30';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '30' },
      ]);
    });

    it('should handle single column', () => {
      const tsv = 'name\nJohn\nJane';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John' },
        { name: 'Jane' },
      ]);
    });

    it('should return empty array for header only', () => {
      const tsv = 'name\tage\tcity';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should handle empty values', () => {
      const tsv = 'name\tage\tcity\nJohn\t\tNew York';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '', city: 'New York' },
      ]);
    });

    it('should handle missing values at end of row', () => {
      const tsv = 'name\tage\tcity\nJohn\t30';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '30', city: '' },
      ]);
    });

    it('should handle multiple empty lines', () => {
      const tsv = 'name\tage\n\nJohn\t30\n\nJane\t25\n';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '30' },
        { name: 'Jane', age: '25' },
      ]);
    });

    it('should handle leading/trailing whitespace in lines', () => {
      const tsv = 'name\tage\n  \nJohn\t30\n   \n';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        { name: 'John', age: '30' },
      ]);
    });
  });

  describe('Amazon report format support', () => {
    it('should handle Amazon merchant listings format', () => {
      const tsv = 'seller-sku\tasin\tprice\tquantity\nSKU001\tB000123456\t19.99\t100\nSKU002\tB000789012\t29.99\t50';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        'seller-sku': 'SKU001',
        'asin': 'B000123456',
        'price': '19.99',
        'quantity': '100',
      });
    });

    it('should handle headers with special characters', () => {
      const tsv = 'item-name\titem-description\topen-date\nProduct 1\tDescription 1\t2024-01-01';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        {
          'item-name': 'Product 1',
          'item-description': 'Description 1',
          'open-date': '2024-01-01',
        },
      ]);
    });

    it('should handle values with special characters', () => {
      const tsv = 'name\tdescription\nProduct "A"\tDescription with, commas';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toEqual([
        {
          'name': 'Product "A"',
          'description': 'Description with, commas',
        },
      ]);
    });
  });

  describe('numeric and special data', () => {
    it('should preserve numeric values as strings', () => {
      const tsv = 'id\tamount\nid001\t1234.56';
      
      const result = convertTSVToJson(tsv);
      
      expect(result[0].amount).toBe('1234.56');
      expect(typeof result[0].amount).toBe('string');
    });

    it('should handle negative numbers', () => {
      const tsv = 'id\tamount\nid001\t-1234.56';
      
      const result = convertTSVToJson(tsv);
      
      expect(result[0].amount).toBe('-1234.56');
    });

    it('should handle currency symbols in values', () => {
      const tsv = 'id\tamount\nid001\t$1,234.56';
      
      const result = convertTSVToJson(tsv);
      
      expect(result[0].amount).toBe('$1,234.56');
    });

    it('should handle dates', () => {
      const tsv = 'id\tdate\nid001\t2024-01-15';
      
      const result = convertTSVToJson(tsv);
      
      expect(result[0].date).toBe('2024-01-15');
    });
  });

  describe('large datasets', () => {
    it('should handle large number of rows', () => {
      const headers = 'id\tname\tvalue';
      const rows = Array.from({ length: 1000 }, (_, i) => `id${i}\tname${i}\t${i}`);
      const tsv = [headers, ...rows].join('\n');
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toHaveLength(1000);
      expect(result[0]).toEqual({ id: 'id0', name: 'name0', value: '0' });
      expect(result[999]).toEqual({ id: 'id999', name: 'name999', value: '999' });
    });

    it('should handle large number of columns', () => {
      const numCols = 50;
      const headers = Array.from({ length: numCols }, (_, i) => `col${i}`).join('\t');
      const values = Array.from({ length: numCols }, (_, i) => `val${i}`).join('\t');
      const tsv = `${headers}\n${values}`;
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toHaveLength(1);
      expect(Object.keys(result[0])).toHaveLength(numCols);
      expect(result[0].col0).toBe('val0');
      expect(result[0].col49).toBe('val49');
    });
  });

  describe('newline handling', () => {
    it('should handle \\n newlines', () => {
      const tsv = 'name\tage\nJohn\t30\nJane\t25';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toHaveLength(2);
    });

    it('should handle trailing newline', () => {
      const tsv = 'name\tage\nJohn\t30\n';
      
      const result = convertTSVToJson(tsv);
      
      expect(result).toHaveLength(1);
    });
  });
});
