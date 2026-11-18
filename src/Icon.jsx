/* The handful of line icons the library uses (from the Melsoft site's set). */
const Icon = ({ name, size = 20, color = "currentColor", strokeWidth = 1.6, style, ...rest }) => {
  const props = {
    width: size, height: size, viewBox: "0 0 24 24",
    fill: "none", stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round",
    /* Icons here are always decorative — every control that uses one either
       has visible text beside it or its own aria-label. Hiding them from the
       accessibility tree keeps them out of accessible-name computation (a
       stray icon inside a labelled button makes its name disagree with its
       visible text, which breaks voice control) and stops IE-era SVG focus
       stops. Pass aria-hidden={false} on the rare icon that carries meaning
       on its own, and give it an aria-label at the same time. */
    "aria-hidden": true,
    focusable: "false",
    style, ...rest,
  };
  switch (name) {
    case "chevron-right": return <svg {...props}><polyline points="9 6 15 12 9 18"/></svg>;
    case "chevron-left": return <svg {...props}><polyline points="15 6 9 12 15 18"/></svg>;
    case "arrow-right": return <svg {...props}><line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/></svg>;
    case "arrow-up-right": return <svg {...props}><line x1="7" y1="17" x2="17" y2="7"/><polyline points="9 7 17 7 17 15"/></svg>;
    case "search": return <svg {...props}><circle cx="11" cy="11" r="7"/><line x1="20" y1="20" x2="16.5" y2="16.5"/></svg>;
    case "close": return <svg {...props}><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>;
    case "play": return <svg {...props} fill={color} stroke="none"><polygon points="6 4 20 12 6 20 6 4"/></svg>;
    case "check": return <svg {...props}><polyline points="5 13 10 18 19 7"/></svg>;
    case "mail": return <svg {...props}><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>;
    case "camera": return <svg {...props}><path d="M3 9a2 2 0 0 1 2-2h1.5l1.2-2h6.6l1.2 2H19a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.4"/></svg>;
    case "film": return <svg {...props}><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="4" x2="7" y2="20"/><line x1="17" y1="4" x2="17" y2="20"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="8" x2="7" y2="8"/><line x1="17" y1="8" x2="21" y2="8"/><line x1="3" y1="16" x2="7" y2="16"/><line x1="17" y1="16" x2="21" y2="16"/></svg>;
    default: return null;
  }
};

export default Icon;
