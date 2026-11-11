/* The one definition of "a block of home page copy", shared by the copy switch at run time
   (js/copy-switch.js embeds it) and by the tooling that lists the blocks. */
function krCopyBlocks(doc) {
  var BLOCK = 'h1,h2,h3,h4,p,li,figcaption,blockquote,dt,dd';
  var SKIP = '.rail, #client-perspectives figure, .hero-source, .hero-method, .globe-bar, .globe-card, .globe-tip, .globe-zoom, .visually-hidden, form, .req, [aria-live], .strip-value, .hero-chart, .map, .copy-switch, script, style';
  var out = [];
  var scopes = doc.querySelectorAll('main, .site-footer .footer-brand');
  for (var s = 0; s < scopes.length; s++) {
    var els = scopes[s].querySelectorAll(BLOCK);
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (el.closest(SKIP) || el.querySelector(BLOCK)) continue;
      if (!el.textContent.replace(/\s+/g, '')) continue;
      out.push(el);
    }
  }
  return out;
}
