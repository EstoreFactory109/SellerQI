import React from 'react'

// Marketplace shown as flag + Amazon domain (e.g. "🇺🇸 Amazon.com") instead of the full country name.
export const marketplaceMeta = {
    US: { flag: '🇺🇸', domain: 'Amazon.com' },
    CA: { flag: '🇨🇦', domain: 'Amazon.ca' },
    MX: { flag: '🇲🇽', domain: 'Amazon.com.mx' },
    BR: { flag: '🇧🇷', domain: 'Amazon.com.br' },
    IE: { flag: '🇮🇪', domain: 'Amazon.ie' },
    UK: { flag: '🇬🇧', domain: 'Amazon.co.uk' },
    DE: { flag: '🇩🇪', domain: 'Amazon.de' },
    FR: { flag: '🇫🇷', domain: 'Amazon.fr' },
    IT: { flag: '🇮🇹', domain: 'Amazon.it' },
    ES: { flag: '🇪🇸', domain: 'Amazon.es' },
    NL: { flag: '🇳🇱', domain: 'Amazon.nl' },
    BE: { flag: '🇧🇪', domain: 'Amazon.com.be' },
    SE: { flag: '🇸🇪', domain: 'Amazon.se' },
    PL: { flag: '🇵🇱', domain: 'Amazon.pl' },
    ZA: { flag: '🇿🇦', domain: 'Amazon.co.za' },
    TR: { flag: '🇹🇷', domain: 'Amazon.com.tr' },
    SA: { flag: '🇸🇦', domain: 'Amazon.sa' },
    AE: { flag: '🇦🇪', domain: 'Amazon.ae' },
    EG: { flag: '🇪🇬', domain: 'Amazon.eg' },
    IN: { flag: '🇮🇳', domain: 'Amazon.in' },
    JP: { flag: '🇯🇵', domain: 'Amazon.co.jp' },
    SG: { flag: '🇸🇬', domain: 'Amazon.sg' },
    AU: { flag: '🇦🇺', domain: 'Amazon.com.au' },
}

const MarketplaceLabel = ({ countryCode, textClassName = '' }) => {
    const meta = marketplaceMeta[countryCode]
    if (!meta) return <span className={textClassName}>{countryCode || 'Marketplace'}</span>
    return (
        <span className="inline-flex items-center gap-1.5">
            <span style={{ fontSize: '13px' }}>{meta.flag}</span>
            <span className={textClassName}>{meta.domain}</span>
        </span>
    )
}

export default MarketplaceLabel
