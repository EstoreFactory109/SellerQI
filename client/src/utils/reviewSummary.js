/**
 * The four boxes from GET /api/review/summary. Amazon does not link a review to an
 * order, so "Reviews received" is new ratings on the seller's products this month.
 */
export function reviewSummaryBoxes(summary) {
  const month = summary?.monthStart
    ? new Date(summary.monthStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    : null;
  const num = (v) => (Number.isFinite(v) ? v : null);
  const unchecked = num(summary?.inWindowUnchecked) || 0;
  return [
    {
      label: 'Eligible right now',
      value: num(summary?.eligibleNow),
      note: !summary ? 'Not available yet'
        : unchecked > 0 ? `+${unchecked.toLocaleString()} more in the request window, not checked with Amazon`
          : 'Amazon confirms a request can be sent',
    },
    {
      label: 'Requested this month',
      value: num(summary?.requestedThisMonth),
      note: summary ? `Sent since ${month}` : 'Not available yet',
    },
    {
      label: 'Reviews received',
      value: summary?.ratingsThisMonth ? num(summary.ratingsThisMonth.count) : null,
      note: !summary ? 'Not available yet'
        : summary.ratingsThisMonth ? 'New ratings on your products this month'
          : "Appears after this month's ratings check",
    },
    {
      label: 'Window closed',
      value: num(summary?.windowClosedThisMonth),
      note: summary ? 'Closed this month without a request' : 'Not available yet',
    },
  ];
}

