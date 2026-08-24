/**
 * The PPC Dashboard's ads-performance banner used to read "Your ads are
 * profitable overall" whenever ROAS >= 1, in green.
 *
 * ROAS is ad-attributed SALES divided by ad SPEND — it has no product cost
 * (COGS, referral/FBA fees) in it, so it cannot support a profit claim. A
 * seller whose margin is thinner than their ACoS is still losing money on
 * every ad-driven sale despite a healthy-looking ROAS. Only the other
 * direction is unconditionally true: if ad-attributed sales don't even cover
 * ad spend (ROAS < 1), that is a real loss regardless of margin.
 *
 * So this reports what ROAS actually measures, without the unsupported
 * profit/loss label on the ROAS >= 1 side.
 */
export function getAdsPerformanceVerdict(roas) {
    const coversSpend = Number(roas) >= 1;
    return {
        coversSpend,
        accentColorKey: coversSpend ? 'good' : 'fix',
    };
}
