/* @ds-bundle: {"format":3,"namespace":"TrackieDesignSystem_25ca21","components":[{"name":"TrackieLogo","sourcePath":"components/brand/TrackieLogo.jsx"},{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"BarChart","sourcePath":"components/charts/BarChart.jsx"},{"name":"LineChart","sourcePath":"components/charts/LineChart.jsx"},{"name":"Avatar","sourcePath":"components/data-display/Avatar.jsx"},{"name":"Badge","sourcePath":"components/data-display/Badge.jsx"},{"name":"Card","sourcePath":"components/data-display/Card.jsx"},{"name":"KpiCard","sourcePath":"components/data-display/KpiCard.jsx"},{"name":"MoneyText","sourcePath":"components/data-display/MoneyText.jsx"},{"name":"StatusBadge","sourcePath":"components/data-display/StatusBadge.jsx"},{"name":"STATUS_KINDS","sourcePath":"components/data-display/StatusBadge.jsx"},{"name":"DataTable","sourcePath":"components/data-table/DataTable.jsx"},{"name":"Checkbox","sourcePath":"components/forms/Checkbox.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Dialog","sourcePath":"components/overlay/Dialog.jsx"},{"name":"Tooltip","sourcePath":"components/overlay/Tooltip.jsx"}],"sourceHashes":{"components/brand/TrackieLogo.jsx":"e17a045b038f","components/buttons/Button.jsx":"60e107663885","components/buttons/IconButton.jsx":"ccb6f342baa6","components/charts/BarChart.jsx":"5204ed039d02","components/charts/LineChart.jsx":"d463b0ea961f","components/data-display/Avatar.jsx":"ff8d72140fac","components/data-display/Badge.jsx":"d399e41854c4","components/data-display/Card.jsx":"5b9639026cc6","components/data-display/KpiCard.jsx":"94be9430cff6","components/data-display/MoneyText.jsx":"06d384094a84","components/data-display/StatusBadge.jsx":"040a5599e171","components/data-table/DataTable.jsx":"8f12b11a66ae","components/forms/Checkbox.jsx":"4583d4b34516","components/forms/Input.jsx":"5bc86d738287","components/forms/Select.jsx":"d7e593c14ce6","components/forms/Switch.jsx":"f56138bc4091","components/navigation/Tabs.jsx":"153cebcf0f9b","components/overlay/Dialog.jsx":"e5ac94f64164","components/overlay/Tooltip.jsx":"5f528dbf0a6f"},"inlinedExternals":[],"unexposedExports":[{"name":"formatINR","sourcePath":"components/data-display/MoneyText.jsx"},{"name":"formatINRCompact","sourcePath":"components/data-display/MoneyText.jsx"}]} */

(() => {

const __ds_ns = (window.TrackieDesignSystem_25ca21 = window.TrackieDesignSystem_25ca21 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/TrackieLogo.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Trackie logo — the tracked-value mark (a climbing path resolving to a gold
 * "value" node) plus the wordmark. Inherits the Datagami gold; distinct mark.
 */
function TrackieLogo({
  variant = "full",
  // "full" | "mark" | "icon"
  theme = "light",
  // "light" | "dark" — affects line/word color
  size = 32,
  // mark height in px (wordmark scales with it)
  className = "",
  style = {},
  ...rest
}) {
  const lineColor = theme === "dark" ? "#E2E8F0" : "#0F172A";
  const nodeColor = theme === "dark" ? "#EDB733" : "#E5A50A";
  const wordColor = theme === "dark" ? "#F8FAFC" : "#0F172A";
  const Mark = /*#__PURE__*/React.createElement("svg", {
    width: size,
    height: size,
    viewBox: "0 0 48 48",
    fill: "none",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "7,33 17,24 24,29 37,13",
    stroke: lineColor,
    strokeWidth: "4.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "37",
    cy: "13",
    r: "5.5",
    fill: nodeColor
  }));
  if (variant === "icon") {
    const r = Math.round(size * 0.234);
    return /*#__PURE__*/React.createElement("svg", _extends({
      width: size,
      height: size,
      viewBox: "0 0 64 64",
      fill: "none",
      className: className,
      style: style,
      role: "img",
      "aria-label": "Trackie"
    }, rest), /*#__PURE__*/React.createElement("rect", {
      width: "64",
      height: "64",
      rx: r,
      fill: theme === "dark" ? "#E5A50A" : "#0F172A"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "16,42 25,33 32,38 47,21",
      stroke: theme === "dark" ? "#0F172A" : "#F1F5F9",
      strokeWidth: "5",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }), /*#__PURE__*/React.createElement("circle", {
      cx: "47",
      cy: "21",
      r: "6.5",
      fill: theme === "dark" ? "#FFFFFF" : "#EDB733"
    }));
  }
  if (variant === "mark") {
    return /*#__PURE__*/React.createElement("span", _extends({
      className: className,
      style: {
        display: "inline-flex",
        ...style
      },
      role: "img",
      "aria-label": "Trackie"
    }, rest), Mark);
  }
  return /*#__PURE__*/React.createElement("span", _extends({
    className: className,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: size * 0.26,
      ...style
    },
    role: "img",
    "aria-label": "Trackie"
  }, rest), Mark, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-sans)",
      fontWeight: 700,
      fontSize: size * 0.95,
      letterSpacing: "-0.025em",
      color: wordColor,
      lineHeight: 1
    }
  }, "Trackie"));
}
Object.assign(__ds_scope, { TrackieLogo });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/TrackieLogo.jsx", error: String((e && e.message) || e) }); }

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Trackie button. Variants map to shadcn/ui: primary (gold), secondary,
 * ghost, destructive. Gold primary uses dark text for AA contrast.
 */
function Button({
  variant = "primary",
  // primary | secondary | ghost | destructive
  size = "md",
  // sm | md | lg
  iconLeft = null,
  iconRight = null,
  disabled = false,
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const cls = ["tk-btn", `tk-btn--${variant}`, size !== "md" ? `tk-btn--${size}` : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls,
    disabled: disabled
  }, rest), iconLeft, children && /*#__PURE__*/React.createElement("span", null, children), iconRight);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/buttons/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Square icon-only button. Same variants/sizes as Button. Always pass aria-label. */
function IconButton({
  variant = "ghost",
  size = "md",
  disabled = false,
  type = "button",
  className = "",
  children,
  ...rest
}) {
  const cls = ["tk-btn", "tk-btn--icon", `tk-btn--${variant}`, size !== "md" ? `tk-btn--${size}` : "", className].filter(Boolean).join(" ");
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    className: cls,
    disabled: disabled
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/charts/BarChart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Minimal SVG bar chart. Supports sign-aware coloring (positive/negative) or a
 * fixed tone. Data: [{ label, value }]. Calm, gridline-light, fintech style.
 */
function BarChart({
  data = [],
  height = 200,
  signed = false,
  tone = "brand",
  formatY,
  className = "",
  ...rest
}) {
  const w = 560,
    h = height,
    padB = 28,
    padL = 8,
    padT = 12;
  const max = Math.max(1, ...data.map(d => Math.abs(d.value)));
  const innerH = h - padB - padT;
  const bw = data.length ? (w - padL) / data.length : 0;
  const barW = Math.min(38, bw * 0.56);
  const zeroY = signed ? padT + innerH / 2 : padT + innerH;
  const scale = signed ? innerH / 2 / max : innerH / max;
  const fillClass = v => signed ? v >= 0 ? "tk-chart__bar tk-chart__bar--positive" : "tk-chart__bar tk-chart__bar--negative" : tone === "positive" ? "tk-chart__bar tk-chart__bar--positive" : tone === "negative" ? "tk-chart__bar tk-chart__bar--negative" : "tk-chart__bar";
  return /*#__PURE__*/React.createElement("svg", _extends({
    className: ["tk-chart", className].filter(Boolean).join(" "),
    viewBox: `0 0 ${w} ${h}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet"
  }, rest), /*#__PURE__*/React.createElement("g", {
    className: "tk-chart__grid"
  }, [0, 0.5, 1].map(t => /*#__PURE__*/React.createElement("line", {
    key: t,
    x1: padL,
    x2: w,
    y1: padT + innerH * t,
    y2: padT + innerH * t
  }))), signed && /*#__PURE__*/React.createElement("line", {
    className: "tk-chart__grid",
    x1: padL,
    x2: w,
    y1: zeroY,
    y2: zeroY,
    style: {
      stroke: "var(--border-strong)"
    }
  }), data.map((d, i) => {
    const cx = padL + bw * i + bw / 2;
    const barH = Math.abs(d.value) * scale;
    const y = d.value >= 0 ? zeroY - barH : zeroY;
    return /*#__PURE__*/React.createElement("g", {
      key: i
    }, /*#__PURE__*/React.createElement("rect", {
      className: fillClass(d.value),
      x: cx - barW / 2,
      y: y,
      width: barW,
      height: Math.max(2, barH),
      rx: "3"
    }), /*#__PURE__*/React.createElement("text", {
      className: "tk-chart__axis",
      x: cx,
      y: h - 9,
      textAnchor: "middle"
    }, d.label));
  }));
}
Object.assign(__ds_scope, { BarChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/BarChart.jsx", error: String((e && e.message) || e) }); }

// components/charts/LineChart.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Minimal SVG line chart with soft area fill. Data: [{ label, value }].
 * tone: "brand" | "info" | "positive" | "negative".
 */
function LineChart({
  data = [],
  height = 200,
  tone = "brand",
  area = true,
  dots = true,
  className = "",
  ...rest
}) {
  const w = 560,
    h = height,
    padB = 28,
    padX = 10,
    padT = 14;
  const vals = data.map(d => d.value);
  const max = Math.max(...vals, 0),
    min = Math.min(...vals, 0);
  const range = max - min || 1;
  const innerH = h - padB - padT;
  const stepX = data.length > 1 ? (w - padX * 2) / (data.length - 1) : 0;
  const px = i => padX + stepX * i;
  const py = v => padT + innerH - (v - min) / range * innerH;
  const linePts = data.map((d, i) => `${px(i)},${py(d.value)}`).join(" ");
  const areaPts = data.length ? `${padX},${padT + innerH} ${linePts} ${px(data.length - 1)},${padT + innerH}` : "";
  const stroke = tone === "info" ? "var(--info)" : tone === "positive" ? "var(--positive)" : tone === "negative" ? "var(--negative)" : "var(--primary)";
  return /*#__PURE__*/React.createElement("svg", _extends({
    className: ["tk-chart", className].filter(Boolean).join(" "),
    viewBox: `0 0 ${w} ${h}`,
    width: "100%",
    preserveAspectRatio: "xMidYMid meet"
  }, rest), /*#__PURE__*/React.createElement("g", {
    className: "tk-chart__grid"
  }, [0, 0.5, 1].map(t => /*#__PURE__*/React.createElement("line", {
    key: t,
    x1: padX,
    x2: w - padX,
    y1: padT + innerH * t,
    y2: padT + innerH * t
  }))), area && areaPts && /*#__PURE__*/React.createElement("polygon", {
    className: "tk-chart__area",
    points: areaPts,
    style: {
      fill: stroke
    }
  }), /*#__PURE__*/React.createElement("polyline", {
    className: "tk-chart__line",
    points: linePts,
    style: {
      stroke
    }
  }), dots && data.map((d, i) => /*#__PURE__*/React.createElement("circle", {
    key: i,
    className: "tk-chart__dot",
    cx: px(i),
    cy: py(d.value),
    r: "3.5",
    style: {
      stroke
    }
  })), data.map((d, i) => /*#__PURE__*/React.createElement("text", {
    key: i,
    className: "tk-chart__axis",
    x: px(i),
    y: h - 9,
    textAnchor: "middle"
  }, d.label)));
}
Object.assign(__ds_scope, { LineChart });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/charts/LineChart.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Circular initials/image avatar. */
function Avatar({
  name = "",
  src,
  size = 32,
  className = "",
  ...rest
}) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase();
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["tk-avatar", className].filter(Boolean).join(" "),
    style: {
      width: size,
      height: size,
      fontSize: size * 0.4
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: name,
    style: {
      width: "100%",
      height: "100%",
      objectFit: "cover"
    }
  }) : initials);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Badge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Small status/label pill. Tones map to the semantic palette. */
function Badge({
  tone = "neutral",
  dot = false,
  className = "",
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("span", _extends({
    className: ["tk-badge", `tk-badge--${tone}`, className].filter(Boolean).join(" ")
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    className: "tk-badge__dot"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Badge.jsx", error: String((e && e.message) || e) }); }

// components/data-display/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Generic surface container. Compose header/body or just pass children with `pad`. */
function Card({
  title,
  subtitle,
  action,
  pad = false,
  flat = false,
  className = "",
  children,
  ...rest
}) {
  const cls = ["tk-card", flat ? "tk-card--flat" : "", pad ? "tk-card--pad" : "", className].filter(Boolean).join(" ");
  if (!title && !subtitle && !action) return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, rest), children);
  return /*#__PURE__*/React.createElement("div", _extends({
    className: cls
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "tk-card__header",
    style: {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "space-between",
      gap: "var(--space-4)"
    }
  }, /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("h3", {
    className: "tk-card__title"
  }, title), subtitle && /*#__PURE__*/React.createElement("p", {
    className: "tk-card__sub"
  }, subtitle)), action), /*#__PURE__*/React.createElement("div", {
    className: "tk-card__body"
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/Card.jsx", error: String((e && e.message) || e) }); }

// components/data-display/MoneyText.jsx
try { (() => {
/** Format a number as Indian-grouped currency (lakh/crore): 1234567 → ₹12,34,567. */
function formatINR(value, {
  paise = false,
  symbol = true
} = {}) {
  if (value == null || isNaN(value)) return "—";
  const neg = value < 0;
  const abs = Math.abs(value);
  const s = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0
  }).format(abs);
  return `${neg ? "−" : ""}${symbol ? "₹" : ""}${s}`;
}

/** Compact Indian format: 12_40_000 → ₹12.4L, 23_000_000 → ₹2.3Cr. */
function formatINRCompact(value) {
  if (value == null || isNaN(value)) return "—";
  const neg = value < 0;
  const abs = Math.abs(value);
  let out;
  if (abs >= 1e7) out = (abs / 1e7).toFixed(abs >= 1e8 ? 0 : 1).replace(/\.0$/, "") + "Cr";else if (abs >= 1e5) out = (abs / 1e5).toFixed(abs >= 1e6 ? 0 : 1).replace(/\.0$/, "") + "L";else if (abs >= 1e3) out = (abs / 1e3).toFixed(0) + "K";else out = String(abs);
  return `${neg ? "−" : ""}₹${out}`;
}

/**
 * Right-aligned currency text — mono tabular, sign-aware coloring.
 * tone: "auto" colors by sign; "plain" stays neutral.
 */
function MoneyText({
  value,
  paise = false,
  compact = false,
  tone = "plain",
  symbol = true,
  className = "",
  style = {}
}) {
  const str = compact ? formatINRCompact(value) : formatINR(value, {
    paise,
    symbol
  });
  const cls = ["money"]; // base mono tabular
  if (tone === "auto") cls.push(value < 0 ? "money--negative" : value > 0 ? "money--positive" : "money--muted");
  cls.push(className);
  return /*#__PURE__*/React.createElement("span", {
    className: cls.filter(Boolean).join(" "),
    style: style
  }, str);
}
Object.assign(__ds_scope, { formatINR, formatINRCompact, MoneyText });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/MoneyText.jsx", error: String((e && e.message) || e) }); }

// components/data-display/KpiCard.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * KPI / metric card for dashboards. Shows an overline label, a large mono
 * figure, and an optional delta (auto up/down coloring) + corner icon.
 */
function KpiCard({
  label,
  value,
  // number (formatted as INR) or pre-formatted node
  compact = true,
  delta,
  // e.g. "+12.4%" string, or number
  deltaDirection,
  // "up" | "down" — inferred from delta sign if omitted
  icon = null,
  caption,
  className = "",
  ...rest
}) {
  const dir = deltaDirection || (typeof delta === "number" ? delta >= 0 ? "up" : "down" : undefined);
  const deltaText = typeof delta === "number" ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta)}%` : delta;
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["tk-card", "tk-kpi", className].filter(Boolean).join(" ")
  }, rest), /*#__PURE__*/React.createElement("div", {
    className: "tk-kpi__head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tk-kpi__label"
  }, label), icon && /*#__PURE__*/React.createElement("span", {
    className: "tk-kpi__icon"
  }, icon)), /*#__PURE__*/React.createElement("div", {
    className: "tk-kpi__value"
  }, typeof value === "number" ? /*#__PURE__*/React.createElement(__ds_scope.MoneyText, {
    value: value,
    compact: compact
  }) : value), (delta != null || caption) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: "var(--space-2)"
    }
  }, delta != null && /*#__PURE__*/React.createElement("span", {
    className: `tk-kpi__delta tk-kpi__delta--${dir}`
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, dir === "up" ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "7",
    y1: "17",
    x2: "17",
    y2: "7"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "9 7 17 7 17 15"
  })) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("line", {
    x1: "7",
    y1: "7",
    x2: "17",
    y2: "17"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 9 17 17 9 17"
  }))), deltaText), caption && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: "var(--text-caption)",
      color: "var(--text-muted)"
    }
  }, caption)));
}
Object.assign(__ds_scope, { KpiCard });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/KpiCard.jsx", error: String((e && e.message) || e) }); }

// components/data-display/StatusBadge.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Invoice / payment lifecycle status. Maps a status to its semantic tone + dot. */
const STATUS = {
  draft: {
    tone: "neutral",
    label: "Draft"
  },
  raised: {
    tone: "info",
    label: "Raised"
  },
  "partially-paid": {
    tone: "pending",
    label: "Partially Paid"
  },
  pending: {
    tone: "pending",
    label: "Pending"
  },
  paid: {
    tone: "positive",
    label: "Paid"
  },
  overdue: {
    tone: "negative",
    label: "Overdue"
  }
};
function StatusBadge({
  status = "draft",
  className = "",
  ...rest
}) {
  const s = STATUS[status] || STATUS.draft;
  return /*#__PURE__*/React.createElement(__ds_scope.Badge, _extends({
    tone: s.tone,
    dot: true,
    className: className
  }, rest), s.label);
}
const STATUS_KINDS = Object.keys(STATUS);
Object.assign(__ds_scope, { StatusBadge, STATUS_KINDS });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-display/StatusBadge.jsx", error: String((e && e.message) || e) }); }

// components/data-table/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Financial data table — money columns (mono tabular, sign-aware), click-to-sort
 * headers, row hover, optional selection. Columns:
 *   { key, header, align?, type?: "money"|"text"|"node", compact?, tone?, render? }
 */
function DataTable({
  columns = [],
  rows = [],
  defaultSort,
  selectable = false,
  className = "",
  ...rest
}) {
  const [sort, setSort] = React.useState(defaultSort || null); // { key, dir }
  const [selected, setSelected] = React.useState(() => new Set());
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const col = columns.find(c => c.key === sort.key);
    const data = [...rows].sort((a, b) => {
      const av = a[sort.key],
        bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return av - bv;
      return String(av).localeCompare(String(bv));
    });
    return sort.dir === "desc" ? data.reverse() : data;
  }, [rows, sort, columns]);
  const toggleSort = key => setSort(s => s && s.key === key ? {
    key,
    dir: s.dir === "asc" ? "desc" : "asc"
  } : {
    key,
    dir: "asc"
  });
  const toggleRow = i => setSelected(prev => {
    const n = new Set(prev);
    n.has(i) ? n.delete(i) : n.add(i);
    return n;
  });
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["tk-table-wrap", className].filter(Boolean).join(" ")
  }, rest), /*#__PURE__*/React.createElement("table", {
    className: "tk-table"
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    style: {
      width: 36
    }
  }), columns.map(c => {
    const isNum = c.type === "money" || c.align === "right";
    const isSorted = sort && sort.key === c.key;
    return /*#__PURE__*/React.createElement("th", {
      key: c.key,
      className: [isNum ? "tk-th--num" : "", c.sortable !== false ? "tk-th--sortable" : ""].filter(Boolean).join(" "),
      "aria-sort": isSorted ? sort.dir === "asc" ? "ascending" : "descending" : undefined,
      onClick: c.sortable !== false ? () => toggleSort(c.key) : undefined,
      style: {
        width: c.width
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "tk-sort",
      style: {
        justifyContent: isNum ? "flex-end" : "flex-start"
      }
    }, c.header, c.sortable !== false && /*#__PURE__*/React.createElement("svg", {
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: "2.5",
      strokeLinecap: "round",
      strokeLinejoin: "round"
    }, isSorted ? sort.dir === "asc" ? /*#__PURE__*/React.createElement("polyline", {
      points: "18 15 12 9 6 15"
    }) : /*#__PURE__*/React.createElement("polyline", {
      points: "6 9 12 15 18 9"
    }) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
      points: "8 9 12 5 16 9"
    }), /*#__PURE__*/React.createElement("polyline", {
      points: "16 15 12 19 8 15"
    })))));
  }))), /*#__PURE__*/React.createElement("tbody", null, sorted.map((row, i) => /*#__PURE__*/React.createElement("tr", {
    key: row.id ?? i,
    "data-selected": selected.has(i) || undefined,
    onClick: selectable ? () => toggleRow(i) : undefined,
    style: selectable ? {
      cursor: "pointer"
    } : undefined
  }, selectable && /*#__PURE__*/React.createElement("td", {
    style: {
      width: 36
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "tk-check",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: selected.has(i),
    onChange: () => toggleRow(i)
  }), /*#__PURE__*/React.createElement("span", {
    className: "tk-check__box"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "20 6 9 17 4 12"
  }))))), columns.map(c => {
    const isNum = c.type === "money" || c.align === "right";
    let content;
    if (c.render) content = c.render(row[c.key], row);else if (c.type === "money") content = /*#__PURE__*/React.createElement(__ds_scope.MoneyText, {
      value: row[c.key],
      compact: c.compact,
      tone: c.tone || "plain"
    });else content = row[c.key];
    return /*#__PURE__*/React.createElement("td", {
      key: c.key,
      className: isNum ? "tk-td--num" : ""
    }, content);
  }))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data-table/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/forms/Checkbox.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Checkbox with the gold-filled checked state. */
function Checkbox({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "tk-check",
    style: disabled ? {
      opacity: 0.5,
      cursor: "not-allowed"
    } : undefined
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "tk-check__box",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "3.5",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, /*#__PURE__*/React.createElement("polyline", {
    points: "20 6 9 17 4 12"
  }))), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input with optional label, hint/error, and a leading affix (e.g. ₹).
 * Set `money` for right-aligned tabular figures.
 */
function Input({
  label,
  hint,
  error,
  leadingAffix,
  money = false,
  id,
  className = "",
  ...rest
}) {
  const inputId = id || (label ? `tk-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const input = /*#__PURE__*/React.createElement("input", _extends({
    id: inputId,
    className: ["tk-input", money ? "tk-input--money" : "", leadingAffix ? "tk-input--lead" : "", className].filter(Boolean).join(" "),
    "aria-invalid": error ? "true" : undefined
  }, rest));
  const field = leadingAffix ? /*#__PURE__*/React.createElement("span", {
    className: "tk-input-wrap"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tk-affix tk-affix--lead"
  }, leadingAffix), input) : input;
  if (!label && !hint && !error) return field;
  return /*#__PURE__*/React.createElement("span", {
    className: "tk-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "tk-label",
    htmlFor: inputId
  }, label), field, (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: ["tk-hint", error ? "tk-hint--error" : ""].filter(Boolean).join(" ")
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Native select styled to match Input, with a custom chevron. */
function Select({
  label,
  hint,
  error,
  id,
  className = "",
  children,
  ...rest
}) {
  const selId = id || (label ? `tk-${label.replace(/\s+/g, "-").toLowerCase()}` : undefined);
  const select = /*#__PURE__*/React.createElement("select", _extends({
    id: selId,
    className: ["tk-select", className].filter(Boolean).join(" "),
    "aria-invalid": error ? "true" : undefined
  }, rest), children);
  if (!label && !hint && !error) return select;
  return /*#__PURE__*/React.createElement("span", {
    className: "tk-field"
  }, label && /*#__PURE__*/React.createElement("label", {
    className: "tk-label",
    htmlFor: selId
  }, label), select, (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: ["tk-hint", error ? "tk-hint--error" : ""].filter(Boolean).join(" ")
  }, error || hint));
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Toggle switch — gold track when on. */
function Switch({
  label,
  checked,
  defaultChecked,
  onChange,
  disabled,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "tk-switch",
    style: disabled ? {
      opacity: 0.5,
      cursor: "not-allowed"
    } : undefined,
    title: typeof label === "string" ? label : undefined
  }, /*#__PURE__*/React.createElement("input", _extends({
    type: "checkbox",
    role: "switch",
    checked: checked,
    defaultChecked: defaultChecked,
    onChange: onChange,
    disabled: disabled
  }, rest)), /*#__PURE__*/React.createElement("span", {
    className: "tk-switch__track",
    "aria-hidden": "true"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tk-switch__thumb"
  })), label && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "var(--space-2)",
      fontSize: "var(--text-body)"
    }
  }, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Underlined tabs. Controlled (value/onChange) or uncontrolled (defaultValue).
 * `variant="segment"` renders a segmented control instead.
 */
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  variant = "underline",
  className = "",
  ...rest
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? (tabs[0] && tabs[0].value));
  const active = value !== undefined ? value : internal;
  const select = v => {
    if (value === undefined) setInternal(v);
    onChange && onChange(v);
  };
  if (variant === "segment") {
    return /*#__PURE__*/React.createElement("div", _extends({
      className: ["tk-segment", className].filter(Boolean).join(" "),
      role: "tablist"
    }, rest), tabs.map(t => /*#__PURE__*/React.createElement("button", {
      key: t.value,
      role: "tab",
      "data-state": active === t.value ? "active" : "inactive",
      onClick: () => select(t.value)
    }, t.label)));
  }
  return /*#__PURE__*/React.createElement("div", _extends({
    className: ["tk-tabs", className].filter(Boolean).join(" "),
    role: "tablist"
  }, rest), tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.value,
    className: "tk-tab",
    role: "tab",
    "aria-selected": active === t.value,
    "data-state": active === t.value ? "active" : "inactive",
    onClick: () => select(t.value)
  }, t.label, t.count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 6,
      fontFamily: "var(--font-mono)",
      fontSize: "var(--text-caption)",
      color: "var(--text-muted)"
    }
  }, t.count))));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Dialog.jsx
try { (() => {
/** Modal dialog with overlay. Controlled via `open` + `onClose`. */
function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  children,
  width = 460,
  className = ""
}) {
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "tk-overlay",
    onMouseDown: e => {
      if (e.target === e.currentTarget) onClose && onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: ["tk-dialog", className].filter(Boolean).join(" "),
    style: {
      maxWidth: width
    },
    role: "dialog",
    "aria-modal": "true",
    "aria-label": typeof title === "string" ? title : undefined
  }, (title || description) && /*#__PURE__*/React.createElement("div", {
    className: "tk-dialog__head"
  }, /*#__PURE__*/React.createElement("div", null, title && /*#__PURE__*/React.createElement("h2", {
    className: "tk-dialog__title"
  }, title), description && /*#__PURE__*/React.createElement("p", {
    className: "tk-dialog__desc"
  }, description)), /*#__PURE__*/React.createElement("button", {
    className: "tk-btn tk-btn--icon tk-btn--ghost tk-btn--sm",
    onClick: onClose,
    "aria-label": "Close"
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 24 24",
    width: "16",
    height: "16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2",
    strokeLinecap: "round"
  }, /*#__PURE__*/React.createElement("line", {
    x1: "18",
    y1: "6",
    x2: "6",
    y2: "18"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "6",
    y1: "6",
    x2: "18",
    y2: "18"
  })))), /*#__PURE__*/React.createElement("div", {
    className: "tk-dialog__body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "tk-dialog__foot"
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Tooltip.jsx
try { (() => {
/** Hover/focus tooltip. Wraps its trigger child; pass `label` for the content. */
function Tooltip({
  label,
  side = "top",
  children,
  className = ""
}) {
  const [show, setShow] = React.useState(false);
  return /*#__PURE__*/React.createElement("span", {
    className: ["tk-tooltip", className].filter(Boolean).join(" "),
    onMouseEnter: () => setShow(true),
    onMouseLeave: () => setShow(false),
    onFocus: () => setShow(true),
    onBlur: () => setShow(false)
  }, children, show && /*#__PURE__*/React.createElement("span", {
    className: "tk-tooltip__pop",
    role: "tooltip"
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Tooltip.jsx", error: String((e && e.message) || e) }); }

__ds_ns.TrackieLogo = __ds_scope.TrackieLogo;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.BarChart = __ds_scope.BarChart;

__ds_ns.LineChart = __ds_scope.LineChart;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Badge = __ds_scope.Badge;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.KpiCard = __ds_scope.KpiCard;

__ds_ns.MoneyText = __ds_scope.MoneyText;

__ds_ns.StatusBadge = __ds_scope.StatusBadge;

__ds_ns.STATUS_KINDS = __ds_scope.STATUS_KINDS;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.Checkbox = __ds_scope.Checkbox;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Dialog = __ds_scope.Dialog;

__ds_ns.Tooltip = __ds_scope.Tooltip;

})();
