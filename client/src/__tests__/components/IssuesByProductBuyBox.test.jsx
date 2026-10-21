/**
 * Issues-by-Product Buy Box rows. The server now actually sends `buyBoxDetails`
 * (it was keyed on a field effective-doc rows do not have), and those rows can
 * carry a null percentage or a carried-forward one. Null used to render as
 * "Low" (null < 50) and crash on null.toFixed.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { classifyBuyBoxIssue } from '../../utils/buyBoxIssue.js';
import { ConversionIssuesTable } from '../../Pages/Issues/IssuesByProduct.jsx';

describe('classifyBuyBoxIssue', () => {
  it('confirmed loss is No Buy Box', () => {
    expect(classifyBuyBoxIssue({ buyBoxPercentage: 0, buyBoxLost: true })).toBe('noBuyBox');
    expect(classifyBuyBoxIssue({ buyBoxPercentage: 0 })).toBe('noBuyBox');
  });

  it('a genuine reading under 50% is Low', () => {
    expect(classifyBuyBoxIssue({ buyBoxPercentage: 30, buyBoxLost: false })).toBe('low');
  });

  it('null, missing, carried-forward and healthy percentages are not issues', () => {
    expect(classifyBuyBoxIssue({ buyBoxPercentage: null, buyBoxLost: false })).toBeNull();
    expect(classifyBuyBoxIssue({})).toBeNull();
    expect(classifyBuyBoxIssue({ buyBoxPercentage: 20, buyBoxPercentageCarriedForward: true })).toBeNull();
    expect(classifyBuyBoxIssue({ buyBoxPercentage: 80 })).toBeNull();
    expect(classifyBuyBoxIssue(undefined)).toBeNull();
  });
});

describe('ConversionIssuesTable Buy Box rows', () => {
  const renderWith = (buyBoxDetails) =>
    render(<ConversionIssuesTable product={{ asin: 'B001', buyBoxDetails }} />);

  it('renders No Buy Box for a lost Buy Box', () => {
    renderWith({ childAsin: 'B001', buyBoxPercentage: 0, buyBoxLost: true, sessions: 12, pageViews: 20 });
    expect(screen.getByText('Buy Box | No Buy Box')).toBeInTheDocument();
  });

  it('does not crash or say Low for an unknown (null) percentage', () => {
    renderWith({ childAsin: 'B001', buyBoxPercentage: null, buyBoxLost: false });
    expect(screen.queryByText(/Low Buy Box/)).not.toBeInTheDocument();
    expect(screen.getByText('No conversion issues found')).toBeInTheDocument();
  });

  it('does not say Low for a carried-forward percentage', () => {
    renderWith({ childAsin: 'B001', buyBoxPercentage: 20, buyBoxPercentageCarriedForward: true });
    expect(screen.queryByText(/Low Buy Box/)).not.toBeInTheDocument();
  });

  it('says Low for a genuine low reading', () => {
    renderWith({ childAsin: 'B001', buyBoxPercentage: 30, buyBoxLost: false });
    expect(screen.getByText('Buy Box | Low Buy Box Percentage')).toBeInTheDocument();
  });
});
