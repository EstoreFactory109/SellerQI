import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SuggestionList from '../../Components/ProfitibilityDashboard/SuggestionList.jsx';

describe('SuggestionList', () => {
  // Used to fall through to "Profit margin is only 0.0%" for a product with no sales.
  const issue = { asin: 'B1', productName: 'Widget', issueType: 'ad_spend_no_sales', sales: 0, adsSpend: 40, netProfit: -40, profitMargin: 0 };

  // The card shows the server's recommendation text, so the server wording is what
  // the seller reads for this issue type.
  it('shows the loss and the server recommendation', () => {
    render(<SuggestionList issuesData={[{ ...issue, recommendation: { title: 'Ad Spend With No Sales', description: 'This product had ad spend but no sales recorded in this period, so all of that spend is lost.' } }]} />);
    expect(screen.getByText('Losing $40.00')).toBeInTheDocument();
    expect(screen.getByText(/had ad spend but no sales/)).toBeInTheDocument();
  });
});
