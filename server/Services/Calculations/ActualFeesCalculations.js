/**
 * Calculate fees based on region, dimensions, weight, and category
 * @param {string} region - Region code (e.g., "AUS", "USA")
 * @param {number} longest - Longest dimension in cm
 * @param {number} median - Median dimension in cm
 * @param {number} shortest - Shortest dimension in cm
 * @param {number} weight - Weight in grams
 * @param {string} category - Product category (e.g., "Apparel")
 * @returns {number} Calculated fee amount
 */
const calculateFees = (region, longest, median, shortest, weight, category) => {
    let result = 0.0;

    if (region === "AU") {
        if (longest > 105 && median > 60 && shortest > 60) {
            if (weight > 25000) {
                result = 27.17 + ((weight / 1000) * 1.43);
            } else if (weight > (20000 - 500)) {
                result = 24.61;
            } else if (weight > (15000 - 500)) {
                result = 18.09;
            } else if (weight > (10000 - 500)) {
                result = 16.57;
            } else if (weight > (5000 - 500)) {
                result = 12.15;
            } else if (weight > 0) {
                result = 9.42;
            }
        } else if (longest > 61 && median > 46 && shortest > 46) {
            if (weight > (20000 - 500)) {
                result = 20.45;
            } else if (weight > (15000 - 500)) {
                result = 17.97;
            } else if (weight > (10000 - 500)) {
                result = 16.02;
            } else if (weight > (9000 - 500)) {
                result = 12.73;
            } else if (weight > (8000 - 500)) {
                result = 12.22;
            } else if (weight > (7000 - 500)) {
                result = 11.69;
            } else if (weight > (6000 - 500)) {
                result = 10.67;
            } else if (weight > (5000 - 500)) {
                result = 10.66;
            } else if (weight > (4000 - 500)) {
                result = 10.16;
            } else if (weight > (3000 - 500)) {
                result = 9.64;
            } else if (weight > (2000 - 500)) {
                result = 9.12;
            } else if (weight > (1000 - 500)) {
                result = 8.25;
            } else if (weight > 0) {
                result = 7.52;
            }
        } else if (longest > 45 && median > 34 && shortest > 26) {
            if (weight > (1750 - 500)) {
                result = 7.97;
            } else if (weight > (1500 - 500)) {
                result = 7.68;
            } else if (weight > (1250 - 500)) {
                result = 7.40;
            } else if (weight > (1000 - 500)) {
                result = 7.21;
            } else if (weight > 0) {
                result = 7.11;
            }
        } else if (longest > 33 && median > 23 && shortest > 5) {
            if (weight > (11000 - 125)) {
                result = 13.19;
            } else if (weight > (10000 - 125)) {
                result = 12.58;
            } else if (weight > (9000 - 125)) {
                result = 11.87;
            } else if (weight > (8000 - 125)) {
                result = 11.22;
            } else if (weight > (7000 - 125)) {
                result = 10.66;
            } else if (weight > (6000 - 125)) {
                result = 10.22;
            } else if (weight > (5000 - 125)) {
                result = 9.66;
            } else if (weight > (4000 - 125)) {
                result = 9.29;
            } else if (weight > (3000 - 125)) {
                result = 8.75;
            } else if (weight > (2000 - 125)) {
                result = 8.25;
            } else if (weight > (1500 - 125)) {
                result = 7.61;
            } else if (weight > (1000 - 125)) {
                result = 7.16;
            } else if (weight > (500 - 125)) {
                result = 6.66;
            } else if (weight > (250 - 125)) {
                result = 4.78;
            } else if (weight > 0) {
                result = 3.94;
            }
        } else if (longest > 33 && median > 23 && shortest > 2.5) {
            if (weight > (500 - 25)) {
                result = 6.65;
            } else if (weight > (250 - 25)) {
                result = 4.78;
            } else if (weight > 0) {
                result = 3.94;
            }
        } else if (longest > 20 && median > 15 && shortest > 1) {
            if (weight > (250 - 25)) {
                result = 2.94;
            } else if (weight > (100 - 25)) {
                result = 2.11;
            } else if (weight > 0) {
                result = 2.04;
            }
        } else {
            result = 2.04;
        }
    } else if (region === "US") {
        if (category === "Apparel") {
            if (longest > 108 && (longest + median + shortest) > 165) {
                result = 158.49 + (((weight - 90) < 0 ? 0 : weight - 90) * 0.83);
            } else if (longest > 60 && longest < 108 && (longest + median + shortest) > 130 && (longest + median + shortest) < 165) {
                result = 86.71 + (((weight - 90) < 0 ? 0 : weight - 90) * 0.83);
            } else if (longest > 60 && longest < 108 && (longest + median + shortest) < 130) {
                result = 13.37 + (((weight - 1) < 0 ? 0 : weight - 1) * 0.46);
            } else if (longest < 60 && longest > 18 && (longest + median + shortest) < 130) {
                result = 9.39 + (((weight - 1) < 0 ? 0 : weight - 1) * 0.40);
            } else if (longest < 18 && longest > 15 && median < 14 && median > 12 && shortest < 8 && shortest > 0.75) {
                if (weight > 3) {
                    result = 7.01 + (((weight - 3) < 0 ? 0 : weight - 3) * 0.32);
                } else if (weight > 2) {
                    result = 6.83;
                } else if (weight > 1) {
                    result = 6.10;
                } else if (weight > (12.0 / 16.0)) {
                    result = 5.32;
                } else if (weight > (6.0 / 16.0)) {
                    result = 4.62;
                } else {
                    result = 4.43;
                }
            } else {
                if (weight > (12.0 / 16.0)) {
                    result = 4.15;
                } else if (weight > (6.0 / 16.0)) {
                    result = 3.60;
                } else {
                    result = 3.43;
                }
            }
        } else {
            if (longest > 108 && (longest + median + shortest) > 165) {
                result = 158.49 + (((weight - 90) < 0 ? 0 : weight - 90) * 0.83);
            } else if (longest > 60 && longest < 108 && (longest + median + shortest) > 130 && (longest + median + shortest) < 165) {
                result = 86.71 + (((weight - 90) < 0 ? 0 : weight - 90) * 0.83);
            } else if (longest > 60 && longest < 108 && (longest + median + shortest) < 130) {
                result = 13.37 + (((weight - 1) < 0 ? 0 : weight - 1) * 0.46);
            } else if (longest < 60 && longest > 18 && (longest + median + shortest) < 130) {
                result = 9.39 + (((weight - 1) < 0 ? 0 : weight - 1) * 0.40);
            } else if (longest < 18 && longest > 15 && median < 14 && median > 12 && shortest < 8 && shortest > 0.75) {
                if (weight > 3) {
                    result = 6.44 + (((weight - 3) < 0 ? 0 : weight - 3) * 0.32);
                } else if (weight > 2) {
                    result = 6.08;
                } else if (weight > 1) {
                    result = 5.40;
                } else if (weight > (12.0 / 16.0)) {
                    result = 4.75;
                } else if (weight > (6.0 / 16.0)) {
                    result = 3.96;
                } else {
                    result = 3.72;
                }
            } else {
                if (weight > (12.0 / 16.0)) {
                    result = 3.77;
                } else if (weight > (6.0 / 16.0)) {
                    result = 3.22;
                } else {
                    result = 3.07;
                }
            }
        }
    }

    return result;
};

module.exports = {
    calculateFees
};

