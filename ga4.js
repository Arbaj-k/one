/* One website analytics bootstrap.
 * Loads GA4 without inline JavaScript so the homepage Content Security Policy
 * can continue to block inline script execution.
 */
(function (window, document) {
  'use strict';
  window.dataLayer = window.dataLayer || [];
  function gtag() {
    window.dataLayer.push(arguments);
  }
  window.gtag = gtag;
  gtag('js', new Date());
  gtag('config', 'G-HELE44ZGB0');

  var script = document.createElement('script');
  script.async = true;
  script.src = 'https://www.googletagmanager.com/gtag/js?id=G-HELE44ZGB0';
  var firstScript = document.getElementsByTagName('script')[0];
  firstScript.parentNode.insertBefore(script, firstScript);
})(window, document);
