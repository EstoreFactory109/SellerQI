/**
 * The eStore Factory report look, in one place.
 *
 * Taken from the Monthly Performance Report the team designed by hand
 * (Falcon Technology, February 2026): white page, blue headings and figures,
 * a red accent rule and section bars, grey stat tiles, a pale blue Key Takeaway
 * box, a blue-headed table and a navy/red footer band, set in Poppins.
 *
 * The emailed PDF (reportPdf.js) reads everything from here. The downloaded
 * copy (client/src/Components/ESF/ReportDocumentPreview.jsx) keeps a mirror of
 * BRAND and its own copy of the logo, since the client cannot import server
 * code — those are the things to keep in step. Charts are not mirrored: they are drawn here
 * once, as SVG, and travel inside the report payload to both renderers.
 */
const path = require('path');

const BRAND = Object.freeze({
    blue: '#0B4F8C',       // headings, figures, table header
    navy: '#0A3A66',       // footer end blocks
    red: '#E3342F',        // accent rule, section bars, footer centre
    teal: '#12A3B4',       // a change for the better
    ink: '#1F2937',        // body text
    muted: '#6B7280',      // labels, subtitles, notes
    faint: '#9CA3AF',
    tile: '#F3F5F8',
    tileBorder: '#DCE1E8',
    takeaway: '#EAF1F8',
    zebra: '#F5F7FA',
    grid: '#E1E6ED',
    white: '#FFFFFF',
});

const COMPANY = 'eStore Factory';

const FONT_DIR = path.resolve(__dirname, '../../assets/fonts/poppins');
const FONT_FILES = Object.freeze({
    normal: path.join(FONT_DIR, 'Poppins-Regular.ttf'),
    bold: path.join(FONT_DIR, 'Poppins-Bold.ttf'),
    italics: path.join(FONT_DIR, 'Poppins-Italic.ttf'),
    bolditalics: path.join(FONT_DIR, 'Poppins-SemiBoldItalic.ttf'),
});

/**
 * The eStore Factory logo, drawn at the top of every page. An 800px copy of
 * the brand PNG (transparent), shipped with the server so a render never
 * fetches anything. client/src/assets/Logo/esf-logo.png is the same file.
 */
const BRAND_DIR = path.resolve(__dirname, '../../assets/brand');
const LOGO_FILE = path.join(BRAND_DIR, 'esf-logo.png');
/** Width over height, so the header can size it without reading the file. */
const LOGO_ASPECT = 800 / 116;

/* ------------------------------------------------------------ currency */

let poppins = null;
const poppinsFont = () => {
    if (poppins === null) {
        try { poppins = require('fontkit').openSync(FONT_FILES.normal); } catch { poppins = false; }
    }
    return poppins;
};

/** Can Poppins draw every character of this text? */
const drawable = (text) => {
    const font = poppinsFont();
    if (!font) return /^[\x20-\x7E£€¥]*$/.test(String(text));
    return [...String(text)].every((ch) => font.hasGlyphForCodePoint(ch.codePointAt(0)));
};

/**
 * The currency prefix a report can actually print. Poppins covers $, £, €, ₹,
 * zł and ₺; the Gulf symbols it lacks get the ISO code ("AED 1,234"), since a
 * missing glyph prints as nothing at all.
 */
const printableCurrency = (country, requested) => {
    const { getCurrencyCode, getCurrencySymbol } = require('../../utils/marketplaceCurrency.js');
    const symbol = requested ?? getCurrencySymbol(country);
    if (drawable(symbol)) return symbol;
    const code = getCurrencyCode(country);
    return code ? `${code} ` : '';
};

/* -------------------------------------------------------------- charts */

const escapeXml = (value) => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * An axis ceiling whose four gridlines all land on round numbers: 3,250 ->
 * 4,000 (1k steps), 44,692 -> 50,000; 70.1 -> 80. Rounding the ceiling alone
 * gave 5,000 and gridlines at 1.25k, 2.5k, 3.75k.
 */
const niceMax = (value) => {
    if (!(value > 0)) return 1;
    const raw = value / 4;
    const power = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].find((s) => s * power >= raw) * power;
    return step * 4;
};

const CHART_W = 260;
const CHART_H = 170;
const PLOT = { left: 38, right: CHART_W - 8, top: 30, bottom: CHART_H - 20 };

const legend = (series) => {
    let x = PLOT.left;
    return series.map((s) => {
        const item = `<rect x="${x}" y="8" width="8" height="8" rx="1.5" fill="${s.color}"/>`
            + `<text x="${x + 11}" y="15" font-family="Poppins" font-size="7" fill="${BRAND.ink}">${escapeXml(s.name)}</text>`;
        x += 18 + s.name.length * 3.9;
        return item;
    }).join('');
};

const gridAndAxis = (max, formatAxis) => {
    const lines = [];
    for (let i = 0; i <= 4; i += 1) {
        const value = (max / 4) * i;
        const y = PLOT.bottom - ((PLOT.bottom - PLOT.top) * i) / 4;
        lines.push(`<line x1="${PLOT.left}" y1="${y}" x2="${PLOT.right}" y2="${y}" stroke="${BRAND.grid}" stroke-width="0.6"/>`);
        lines.push(`<text x="${PLOT.left - 4}" y="${y + 2.4}" text-anchor="end" font-family="Poppins" font-size="6" fill="${BRAND.muted}">${escapeXml(formatAxis(value))}</text>`);
    }
    return lines.join('');
};

/**
 * Grouped bars, one group per category, the value printed over each bar —
 * the "UK Sales Breakdown" chart of the reference report.
 *
 * @param {object} opts
 * @param {string[]} opts.categories   e.g. ['August', 'September']
 * @param {Array<{name, color, values}>} opts.series
 * @param {(n:number)=>string} opts.formatValue  label over a bar
 * @param {(n:number)=>string} opts.formatAxis   y-axis label
 */
const barChartSvg = ({ categories, series, formatValue, formatAxis }) => {
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0))));
    const groupWidth = (PLOT.right - PLOT.left) / categories.length;
    const barWidth = Math.min(26, (groupWidth * 0.78) / series.length);
    const scaleY = (v) => PLOT.bottom - ((PLOT.bottom - PLOT.top) * Math.max(v || 0, 0)) / max;

    const bars = categories.map((category, ci) => {
        const groupStart = PLOT.left + groupWidth * ci + (groupWidth - barWidth * series.length) / 2;
        const parts = series.map((s, si) => {
            const value = s.values[ci];
            if (value === null || value === undefined) return '';
            const x = groupStart + barWidth * si;
            const y = scaleY(value);
            return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barWidth - 1.5).toFixed(1)}" height="${(PLOT.bottom - y).toFixed(1)}" fill="${s.color}"/>`
                + `<text x="${(x + (barWidth - 1.5) / 2).toFixed(1)}" y="${(y - 2.5).toFixed(1)}" text-anchor="middle" font-family="Poppins" font-size="5.5" fill="${BRAND.ink}">${escapeXml(formatValue(value))}</text>`;
        }).join('');
        const label = `<text x="${(PLOT.left + groupWidth * (ci + 0.5)).toFixed(1)}" y="${PLOT.bottom + 11}" text-anchor="middle" font-family="Poppins" font-size="7" fill="${BRAND.ink}">${escapeXml(category)}</text>`;
        return parts + label;
    }).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">`
        + legend(series) + gridAndAxis(max, formatAxis) + bars
        + `<line x1="${PLOT.left}" y1="${PLOT.bottom}" x2="${PLOT.right}" y2="${PLOT.bottom}" stroke="${BRAND.faint}" stroke-width="0.7"/>`
        + '</svg>';
};

/**
 * One line per series across the categories, each point labelled — the
 * "ACOS vs TACOS" chart of the reference report. A null point is left out
 * rather than drawn at zero.
 */
const lineChartSvg = ({ categories, series, formatValue, formatAxis }) => {
    const max = niceMax(Math.max(0, ...series.flatMap((s) => s.values.map((v) => v || 0))) * 1.15);
    const step = categories.length > 1 ? (PLOT.right - PLOT.left - 30) / (categories.length - 1) : 0;
    const xAt = (i) => PLOT.left + 15 + step * i;
    const yAt = (v) => PLOT.bottom - ((PLOT.bottom - PLOT.top) * v) / max;

    const lines = series.map((s, si) => {
        const points = s.values.map((v, i) => (v === null || v === undefined ? null : [xAt(i), yAt(v), v])).filter(Boolean);
        if (!points.length) return '';
        const path = points.length > 1
            ? `<polyline points="${points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="1.8"/>`
            : '';
        // Labels sit above the upper line and below the lower, as in the reference.
        const above = si === 0;
        const dots = points.map(([x, y, v]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="${s.color}"/>`
            + `<text x="${x.toFixed(1)}" y="${(above ? y - 6 : y + 11).toFixed(1)}" text-anchor="middle" font-family="Poppins" font-size="6.5" fill="${s.color}">${escapeXml(formatValue(v))}</text>`).join('');
        return path + dots;
    }).join('');

    const labels = categories.map((c, i) => `<text x="${xAt(i).toFixed(1)}" y="${PLOT.bottom + 11}" text-anchor="middle" font-family="Poppins" font-size="7" fill="${BRAND.ink}">${escapeXml(c)}</text>`).join('');

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${CHART_W}" height="${CHART_H}" viewBox="0 0 ${CHART_W} ${CHART_H}">`
        + legend(series) + gridAndAxis(max, formatAxis) + lines + labels
        + '</svg>';
};

module.exports = {
    BRAND,
    COMPANY,
    FONT_DIR,
    FONT_FILES,
    BRAND_DIR,
    LOGO_FILE,
    LOGO_ASPECT,
    CHART_W,
    CHART_H,
    drawable,
    printableCurrency,
    barChartSvg,
    lineChartSvg,
    escapeXml,
    niceMax,
};
