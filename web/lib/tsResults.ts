/**
 * ASDS 5306 (Applied Time Series Analysis) results, Group 3. Values are copied from the group's report
 * and presentation (validation: 731 origins, 2024-2025; final test: 302 origins, 2026-01-01 to 10-29;
 * 24 leads from a midnight America/Chicago origin). The site only displays them.
 */
export const MODELS = ["Ridge", "SARIMA", "Naive 24", "Holt–Winters", "Naive 168"] as const;
export const MODEL_COLOR: Record<string, string> = {
  Ridge: "#e6612a", SARIMA: "#1c5ba6", "Naive 24": "#6b7785", "Holt–Winters": "#1f8f88", "Naive 168": "#b4bcc5",
};

export const METHODS = [
  { name: "Naive 24", what: "Previous day, same UTC hour" },
  { name: "Naive 168", what: "Previous week, same UTC hour" },
  { name: "Holt–Winters", what: "AAA, additive daily season, on log load" },
  { name: "SARIMA", what: "ARMA(1,1) or MA(1) on the lag-24 difference, chosen per series on validation" },
  { name: "Ridge", what: "One model per series and lead 1–24: load lags, 24 h and 168 h summaries, calendar" },
];

export const ARMA = [
  { cand: "AR(1)", aic: -298854.6, ar: "1.0179", ma: "none", resid: "−0.112 / 0.325" },
  { cand: "MA(1)", aic: -193185.8, ar: "none", ma: "1.0074", resid: "0.044 / 0.145" },
  { cand: "ARMA(1,1)", aic: -339514.9, ar: "1.0258", ma: "1.3044", resid: "−0.166 / 0.289" },
];
export const HOLT_WINTERS = { level: 0.812, trend: 0.00069, seasonal: 1.0 };

export const SARIMA_FORMS = [
  { series: "Coast", form: "ARMA(1,1)", val: 1135.7 }, { series: "East", form: "ARMA(1,1)", val: 184.3 },
  { series: "Far West", form: "MA(1)", val: 244.3 }, { series: "North", form: "MA(1)", val: 159.1 },
  { series: "North Central", form: "ARMA(1,1)", val: 1597.1 }, { series: "South Central", form: "ARMA(1,1)", val: 787.2 },
  { series: "Southern", form: "ARMA(1,1)", val: 327.9 }, { series: "West", form: "ARMA(1,1)", val: 93.4 },
  { series: "System", form: "ARMA(1,1)", val: 3307.5 },
];

export const VALIDATION_RMSE = { Ridge: 2866.5, SARIMA: 3307.5, "Naive 24": 3497.9, "Holt–Winters": 3734.2, "Naive 168": 6479.6 };
export const TEST = {
  Ridge: { rmse: 2752.6, mae: 1902.6, bias: -242.3, mase: 0.789 },
  SARIMA: { rmse: 3065.1, mae: 2035.7, bias: 104.2, mase: 0.844 },
  "Naive 24": { rmse: 3370.2, mae: 2394.3, bias: -8.0, mase: 0.993 },
  "Holt–Winters": { rmse: 3827.1, mae: 2772.7, bias: 494.8, mase: 1.15 },
  "Naive 168": { rmse: 6329.8, mae: 4588.9, bias: -57.5, mase: 1.904 },
};

export const ZONES_TEST = [
  { series: "Coast", ridge: 923.9, sarima: 1138.2, naive: 1161.8, gain: 20.5 },
  { series: "North Central", ridge: 1243.4, sarima: 1489.4, naive: 1531.2, gain: 18.8 },
  { series: "South Central", ridge: 665.8, sarima: 750.1, naive: 804.6, gain: 17.2 },
  { series: "Southern", ridge: 281.8, sarima: 303.4, naive: 333.0, gain: 15.4 },
  { series: "North", ridge: 112.9, sarima: 131.4, naive: 132.2, gain: 14.6 },
  { series: "East", ridge: 159.2, sarima: 164.0, naive: 181.4, gain: 12.2 },
  { series: "Far West", ridge: 279.2, sarima: 302.7, naive: 306.0, gain: 8.8 },
  { series: "West", ridge: 117.0, sarima: 119.6, naive: 118.1, gain: 0.9 },
  { series: "System", ridge: 2752.6, sarima: 3065.1, naive: 3370.2, gain: 18.3 },
];

export const LEADS = [
  { lead: 1, Ridge: 341.6, SARIMA: 339.9, "Naive 24": 2839.7 },
  { lead: 6, Ridge: 1644.6, SARIMA: 1746.6, "Naive 24": 2879.1 },
  { lead: 12, Ridge: 2100.1, SARIMA: 2792.7, "Naive 24": 3161.1 },
  { lead: 18, Ridge: 4357.2, SARIMA: 4436.7, "Naive 24": 4210.3 },
  { lead: 24, Ridge: 2734.4, SARIMA: 3208.4, "Naive 24": 2936.4 },
];
export const SEASONS = [
  { season: "Winter", Ridge: 2895, SARIMA: 2977, "Naive 24": 3712 },
  { season: "Spring", Ridge: 3162, SARIMA: 3636, "Naive 24": 3806 },
  { season: "Summer", Ridge: 2335, SARIMA: 2692, "Naive 24": 2800 },
  { season: "Fall", Ridge: 2512, SARIMA: 2704, "Naive 24": 3090 },
];
export const PEAK_BIAS = [
  { what: "High-load hours", Ridge: -975.8, SARIMA: -44.4, "Naive 24": -543.8 },
  { what: "Daily peak hour", Ridge: -1770.4, SARIMA: -420.0, "Naive 24": -592.7 },
];

export const ZONE_PROFILES = [
  { zone: "Coast", mean: 13455.8, cv: 0.228, acf24: 0.932, acf168: 0.844, trend: 0.91, seas: 0.777 },
  { zone: "East", mean: 1683.4, cv: 0.255, acf24: 0.908, acf168: 0.77, trend: 0.819, seas: 0.633 },
  { zone: "Far West", mean: 5087.4, cv: 0.335, acf24: 0.993, acf168: 0.978, trend: 0.992, seas: 0.351 },
  { zone: "North", mean: 1159.4, cv: 0.361, acf24: 0.966, acf168: 0.919, trend: 0.945, seas: 0.56 },
  { zone: "North Central", mean: 14461.4, cv: 0.277, acf24: 0.916, acf168: 0.776, trend: 0.854, seas: 0.668 },
  { zone: "South Central", mean: 7870.4, cv: 0.28, acf24: 0.932, acf168: 0.82, trend: 0.875, seas: 0.702 },
  { zone: "Southern", mean: 3959.0, cv: 0.249, acf24: 0.931, acf168: 0.81, trend: 0.894, seas: 0.77 },
  { zone: "West", mean: 1338.6, cv: 0.233, acf24: 0.935, acf168: 0.814, trend: 0.835, seas: 0.539 },
];
