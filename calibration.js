'use strict';

function estimateOffset(errors) {
  const median = values => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const center = median(errors);
  const deviations = errors.map(value => Math.abs(value - center));
  const spread = median(deviations);
  const inliers = errors.filter(value => Math.abs(value - center) <= Math.max(25, spread * 3));
  return {
    offset: Math.round(median(inliers)),
    spread: Math.round(spread),
    consistent: inliers.length >= 18 && spread <= 25
  };
}

if (typeof module !== 'undefined') module.exports = { estimateOffset };
