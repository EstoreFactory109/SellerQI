/**
 * Sum COGS across finance dashboard ASIN rows: cogsPerUnit(asin) × units sold.
 */
export function computeTotalCogs(asinWiseRows, cogsValues) {
  if (!Array.isArray(asinWiseRows) || !cogsValues) return 0;

  let total = 0;
  for (const row of asinWiseRows) {
    const asin = row?.asin;
    if (!asin) continue;
    const perUnit = Number(cogsValues[asin] || 0);
    if (perUnit <= 0) continue;
    const units = Number(row.units ?? row.unitsSold ?? 0);
    if (units <= 0) continue;
    total += perUnit * units;
  }
  return total;
}

export function computeRowCogs(row, cogsValues, asinOverride = null) {
  const asin = asinOverride || row?.asin;
  if (!asin || !cogsValues) return 0;
  const perUnit = Number(cogsValues[asin] || 0);
  if (perUnit <= 0) return 0;
  const units = Number(row?.units ?? row?.unitsSold ?? 0);
  return perUnit * units;
}
