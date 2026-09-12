/** PDF styles must never select any element outside their render root. */
export function scopePdfStyles(css: string, root: string): string {
  if (!/^\[data-pdf-render="[a-zA-Z0-9-]+"\]$/.test(root)) throw new Error("Invalid PDF style scope");
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  const render = (rules: CSSRuleList): string => Array.from(rules).map(rule => {
    if (rule.type === CSSRule.STYLE_RULE) {
      const style = rule as CSSStyleRule;
      // Template selectors are ordinary selector lists, without functional commas.
      const selectors = style.selectorText.split(",").map(value => {
        const selector = value.trim();
        if (/^(body|html|:root)$/.test(selector)) return root;
        if (/^(body|html|:root)\s+/.test(selector)) return selector.replace(/^(body|html|:root)/, root);
        return `${root} ${selector}`;
      });
      return `${selectors.join(",")} { ${style.style.cssText} }`;
    }
    if (rule.type === CSSRule.MEDIA_RULE) {
      const media = rule as CSSMediaRule;
      if (/\bprint\b/.test(media.conditionText)) return "";
      return `@media ${media.conditionText} { ${render(media.cssRules)} }`;
    }
    // Do not copy global @page, @import, font or animation declarations into CRM.
    return "";
  }).join("\n");
  return `${root}, ${root} * { margin:0; padding:0; box-sizing:border-box; }\n${render(sheet.cssRules)}`;
}
