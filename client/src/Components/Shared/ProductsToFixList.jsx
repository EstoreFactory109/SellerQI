import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { COLORS } from './tokens.js';
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js';

/**
 * The products carrying the most recoverable money, with what to do about each.
 *
 * Rendered on three surfaces (Dashboard, Profitability, Your Products) from one
 * component and one endpoint, so the three cannot show a seller different answers
 * to the same question. Money and ordering are computed server-side by
 * TaskOpportunityGroupsService; this only presents them.
 *
 * Two honesty rules are enforced here rather than left to each caller:
 *  - an amount containing inferred ad attribution is marked with "*", matching the
 *    convention used elsewhere for estimated figures
 *  - a product advertised but missing from the catalogue is labelled as such,
 *    because that is usually the actual problem
 */
const ProductsToFixList = ({
    products = [],
    currency = '$',
    loading = false,
    limit,
    compact = false,
    onProductClick
}) => {
    const navigate = useNavigate();
    const shown = typeof limit === 'number' ? products.slice(0, limit) : products;

    // Land on this product's individual tasks rather than a differently-scoped page.
    const openProduct = (asin) => {
        if (onProductClick) return onProductClick(asin);
        navigate(`/seller-central-checker/tasks?asin=${encodeURIComponent(asin)}`);
    };

    if (loading) {
        return (
            <div className='flex flex-col gap-2'>
                {[0, 1, 2].map((i) => (
                    <div
                        key={i}
                        className='h-14 rounded-xl animate-pulse'
                        style={{ background: COLORS.surfaceElevated || 'rgba(255,255,255,.04)' }}
                    />
                ))}
            </div>
        );
    }

    if (shown.length === 0) {
        return (
            <div className='py-6 text-center text-sm' style={{ color: COLORS.textSecondary }}>
                No products need attention right now.
            </div>
        );
    }

    return (
        <div className='flex flex-col gap-2'>
            {shown.map((p, index) => {
                const hasMoney = (p.profitImpact || 0) > 0;
                const issues = (p.taskCount || 0) + (p.adsTaskCount || 0);

                return (
                    <motion.button
                        key={p.asin}
                        type='button'
                        onClick={() => openProduct(p.asin)}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.18, delay: index * 0.03 }}
                        className='w-full text-left rounded-xl border p-3.5 transition-colors'
                        style={{ borderColor: COLORS.border, background: COLORS.surface }}
                    >
                        <div className='flex items-start gap-3'>
                            <span
                                className='flex-none w-5 h-5 rounded-md flex items-center justify-center text-[11px] font-bold mt-0.5'
                                style={{ background: 'rgba(59,130,246,.14)', color: '#7EA8F8' }}
                            >
                                {p.rank || index + 1}
                            </span>

                            <div className='flex-1 min-w-0'>
                                <div className='flex items-center gap-2 flex-wrap'>
                                    <span
                                        className='text-[13px] font-semibold truncate'
                                        style={{ color: COLORS.textPrimary, maxWidth: compact ? '13rem' : '22rem' }}
                                        title={p.productName}
                                    >
                                        {p.productName || p.asin}
                                    </span>
                                    <span className='text-[11px] tabular-nums flex-none' style={{ color: COLORS.textMuted }}>
                                        {p.asin}
                                    </span>
                                    {p.notInCatalogue && (
                                        <span
                                            className='text-[10px] font-semibold px-1.5 py-0.5 rounded flex-none'
                                            style={{ background: 'rgba(239,68,68,.16)', color: '#f87171' }}
                                        >
                                            not listed
                                        </span>
                                    )}
                                </div>

                                {p.why && (
                                    <p className='m-0 mt-1 text-[12px] leading-5' style={{ color: COLORS.textSecondary }}>
                                        {p.why}
                                    </p>
                                )}

                                {!compact && p.action && (
                                    <p className='m-0 mt-1 text-[12px] leading-5' style={{ color: COLORS.textMuted }}>
                                        <span style={{ color: COLORS.textMuted }}>Do this — </span>
                                        {p.action}
                                    </p>
                                )}

                                <div className='mt-1.5 text-[11px]' style={{ color: COLORS.textMuted }}>
                                    {issues} issue{issues === 1 ? '' : 's'}
                                    {(p.categories || []).length > 0 && ` · ${p.categories.join(', ')}`}
                                    {/* Ad waste is already INSIDE the profit figure — a
                                        product's loss has its wasted spend subtracted
                                        already — so it reads as a component, not an addition. */}
                                    {(p.adWasteComponent || 0) > 0 && hasMoney && (
                                        ` · of which ~${formatCurrencyWithLocale(p.adWasteComponent, currency)} wasted ad spend`
                                    )}
                                </div>
                            </div>

                            <div className='flex-none text-right'>
                                {hasMoney && (
                                    <div
                                        className='text-sm font-bold tabular-nums whitespace-nowrap'
                                        style={{ color: COLORS.good }}
                                    >
                                        {formatCurrencyWithLocale(p.profitImpact, currency)}
                                        {p.amountIsEstimated ? '*' : ''}
                                    </div>
                                )}
                                <div className='text-[10px] mt-0.5' style={{ color: COLORS.textMuted }}>
                                    {hasMoney ? 'profit impact' : 'to review'}
                                </div>
                                {/* Capital is a different quantity from profit, so it gets
                                    its own line and is never folded into the figure above. */}
                                {(p.capitalTiedUp || 0) > 0 && (
                                    <div className='text-[10px] mt-1 whitespace-nowrap' style={{ color: COLORS.textMuted }}>
                                        {formatCurrencyWithLocale(p.capitalTiedUp, currency)} capital
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.button>
                );
            })}
        </div>
    );
};

export default ProductsToFixList;
