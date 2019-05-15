// ===============================================
// AdBlock detector
//
// Attempts to detect the presence of Ad Blocker software and notify listener of its existence.
// Copyright (c) 2017 IAB
//
// The BSD-3 License
// Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
// 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
// 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
// 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
// ===============================================

/**
* @name window.adblockDetector
*
* IAB Adblock detector.
* Usage: window.adblockDetector.init(options);
*
* Options object settings
*
*	@prop debug:  boolean
*         Flag to indicate additional debug output should be printed to console
*
*	@prop found: @function
*         Callback function to fire if adblock is detected
*
*	@prop notfound: @function
*         Callback function to fire if adblock is not detected.
*         NOTE: this function may fire multiple times and give false negative
*         responses during a test until adblock is successfully detected.
*
*	@prop complete: @function
*         Callback function to fire once a round of testing is complete.
*         The test result (boolean) is included as a parameter to callback
*
* example: 	window.adblockDetector.init(
				{
					found: function(){ ...},
 					notFound: function(){...}
				}
			);
*
*
*/
"use strict";

(function (win) {
  var version = '1.0';
  var ofs = 'offset',
      cl = 'client';

  var noop = function noop() {};

  var testedOnce = false;
  var testExecuting = false;
  var isOldIEevents = win.addEventListener === undefined;
  /**
  * Options set with default options initialized
  *
  */

  var _options = {
    loopDelay: 50,
    maxLoop: 5,
    debug: true,
    found: noop,
    // function to fire when adblock detected
    notfound: noop,
    // function to fire if adblock not detected after testing
    complete: noop // function to fire after testing completes, passing result as parameter

  };

  function parseAsJson(data) {
    var result, fnData;

    try {
      result = JSON.parse(data);
    } catch (ex) {
      try {
        fnData = new Function("return " + data);
        result = fnData();
      } catch (ex) {
        log('Failed secondary JSON parse', true);
      }
    }

    return result;
  }
  /**
  * Ajax helper object to download external scripts.
  * Initialize object with an options object
  * Ex:
    {
  	  url : 'http://example.org/url_to_download',
  	  method: 'POST|GET',
  	  success: callback_function,
  	  fail:  callback_function
    }
  */


  var AjaxHelper = function AjaxHelper(opts) {
    var xhr = new XMLHttpRequest();
    this.success = opts.success || noop;
    this.fail = opts.fail || noop;
    var me = this;
    var method = opts.method || 'get';
    /**
    * Abort the request
    */

    this.abort = function () {
      try {
        xhr.abort();
      } catch (ex) {}
    };

    function stateChange(vals) {
      if (xhr.readyState == 4) {
        if (xhr.status == 200) {
          me.success(xhr.response);
        } else {
          // failed
          me.fail(xhr.status);
        }
      }
    }

    xhr.onreadystatechange = stateChange;

    function start() {
      xhr.open(method, opts.url, true);
      xhr.send();
    }

    start();
  };
  /**
  * Object tracking the various block lists
  */


  var BlockListTracker = function BlockListTracker() {
    var me = this;
    var externalBlocklistData = {};
    /**
    * Add a new external URL to track
    */

    this.addUrl = function (url) {
      externalBlocklistData[url] = {
        url: url,
        state: 'pending',
        format: null,
        data: null,
        result: null
      };
      return externalBlocklistData[url];
    };
    /**
    * Loads a block list definition
    */


    this.setResult = function (urlKey, state, data) {
      var obj = externalBlocklistData[urlKey];

      if (obj == null) {
        obj = this.addUrl(urlKey);
      }

      obj.state = state;

      if (data == null) {
        obj.result = null;
        return;
      }

      if (typeof data === 'string') {
        try {
          data = parseAsJson(data);
          obj.format = 'json';
        } catch (ex) {
          obj.format = 'easylist'; // parseEasyList(data);
        }
      }

      obj.data = data;
      return obj;
    };
  };

  var listeners = []; // event response listeners

  var baitNode = null;
  var quickBait = {
    cssClass: 'pub_300x250 pub_300x250m pub_728x90 text-ad textAd text_ad text_ads text-ads text-ad-links'
  };
  var baitTriggers = {
    nullProps: [ofs + 'Parent'],
    zeroProps: []
  };
  baitTriggers.zeroProps = [ofs + 'Height', ofs + 'Left', ofs + 'Top', ofs + 'Width', ofs + 'Height', cl + 'Height', cl + 'Width']; // result object

  var exeResult = {
    quick: null,
    remote: null
  };
  var findResult = null; // result of test for ad blocker

  var timerIds = {
    test: 0,
    download: 0
  };

  function isFunc(fn) {
    return typeof fn == 'function';
  }
  /**
  * Make a DOM element
  */


  function makeEl(tag, attributes) {
    var k,
        v,
        el,
        attr = attributes;
    var d = document;
    el = d.createElement(tag);

    if (attr) {
      for (k in attr) {
        if (attr.hasOwnProperty(k)) {
          el.setAttribute(k, attr[k]);
        }
      }
    }

    return el;
  }

  function attachEventListener(dom, eventName, handler) {
    if (isOldIEevents) {
      dom.attachEvent('on' + eventName, handler);
    } else {
      dom.addEventListener(eventName, handler, false);
    }
  }

  function log(message, isError) {
    if (!_options.debug && !isError) {
      return;
    }

    if (win.console && win.console.log) {
      if (isError) {
        console.error('[ABD] ' + message);
      } else {
        console.log('[ABD] ' + message);
      }
    }
  }

  var ajaxDownloads = [];
  /**
  * Load and execute the URL inside a closure function
  */

  function loadExecuteUrl(url) {
    var ajax, result;
    blockLists.addUrl(url); // setup call for remote list

    ajax = new AjaxHelper({
      url: url,
      success: function success(data) {
        log('downloaded file ' + url); // todo - parse and store until use

        result = blockLists.setResult(url, 'success', data);

        try {
          var intervalId = 0,
              retryCount = 0;

          var tryExecuteTest = function tryExecuteTest(listData) {
            if (!testExecuting) {
              beginTest(listData, true);
              return true;
            }

            return false;
          };

          if (findResult == true) {
            return;
          }

          if (tryExecuteTest(result.data)) {
            return;
          } else {
            log('Pause before test execution');
            intervalId = setInterval(function () {
              if (tryExecuteTest(result.data) || retryCount++ > 5) {
                clearInterval(intervalId);
              }
            }, 250);
          }
        } catch (ex) {
          log(ex.message + ' url: ' + url, true);
        }
      },
      fail: function fail(status) {
        log(status, true);
        blockLists.setResult(url, 'error', null);
      }
    });
    ajaxDownloads.push(ajax);
  }
  /**
  * Fetch the external lists and initiate the tests
  */


  function fetchRemoteLists() {
    var i, url;
    var opts = _options;

    for (i = 0; i < opts.blockLists.length; i++) {
      url = opts.blockLists[i];
      loadExecuteUrl(url);
    }
  }

  function cancelRemoteDownloads() {
    var i, aj;

    for (i = ajaxDownloads.length - 1; i >= 0; i--) {
      aj = ajaxDownloads.pop();
      aj.abort();
    }
  } // =============================================================================

  /**
  * Begin execution of the test
  */


  function beginTest(bait) {
    log('start beginTest');

    if (findResult == true) {
      return; // we found it. don't continue executing
    }

    testExecuting = true;
    castBait(bait);
    exeResult.quick = 'testing';
    timerIds.test = setTimeout(function () {
      reelIn(bait, 1);
    }, 5);
  }
  /**
  * Create the bait node to see how the browser page reacts
  */


  function castBait(bait) {
    var i,
        d = document,
        b = d.body;
    var t;
    var baitStyle = 'width: 1px !important; height: 1px !important; position: absolute !important; left: -10000px !important; top: -1000px !important;';

    if (bait == null || typeof bait == 'string') {
      log('invalid bait being cast');
      return;
    }

    if (bait.style != null) {
      baitStyle += bait.style;
    }

    baitNode = makeEl('div', {
      'class': bait.cssClass,
      'style': baitStyle
    });
    log('adding bait node to DOM');
    b.appendChild(baitNode); // touch these properties

    for (i = 0; i < baitTriggers.nullProps.length; i++) {
      t = baitNode[baitTriggers.nullProps[i]];
    }

    for (i = 0; i < baitTriggers.zeroProps.length; i++) {
      t = baitNode[baitTriggers.zeroProps[i]];
    }
  }
  /**
  * Run tests to see if browser has taken the bait and blocked the bait element
  */


  function reelIn(bait, attemptNum) {
    var i, k, v;
    var body = document.body;
    var found = false;

    if (baitNode == null) {
      log('recast bait');
      castBait(bait || quickBait);
    }

    if (typeof bait == 'string') {
      log('invalid bait used', true);

      if (clearBaitNode()) {
        setTimeout(function () {
          testExecuting = false;
        }, 5);
      }

      return;
    }

    if (timerIds.test > 0) {
      clearTimeout(timerIds.test);
      timerIds.test = 0;
    } // test for issues


    if (body.getAttribute('abp') !== null) {
      log('found adblock body attribute');
      found = true;
    }

    for (i = 0; i < baitTriggers.nullProps.length; i++) {
      if (baitNode[baitTriggers.nullProps[i]] == null) {
        if (attemptNum > 4) found = true;
        log('found adblock null attr: ' + baitTriggers.nullProps[i]);
        break;
      }

      if (found == true) {
        break;
      }
    }

    for (i = 0; i < baitTriggers.zeroProps.length; i++) {
      if (found == true) {
        break;
      }

      if (baitNode[baitTriggers.zeroProps[i]] == 0) {
        if (attemptNum > 4) found = true;
        log('found adblock zero attr: ' + baitTriggers.zeroProps[i]);
      }
    }

    if (window.getComputedStyle !== undefined) {
      var baitTemp = window.getComputedStyle(baitNode, null);

      if (baitTemp.getPropertyValue('display') == 'none' || baitTemp.getPropertyValue('visibility') == 'hidden') {
        if (attemptNum > 4) found = true;
        log('found adblock computedStyle indicator');
      }
    }

    testedOnce = true;

    if (found || attemptNum++ >= _options.maxLoop) {
      findResult = found;
      log('exiting test loop - value: ' + findResult);
      notifyListeners();

      if (clearBaitNode()) {
        setTimeout(function () {
          testExecuting = false;
        }, 5);
      }
    } else {
      timerIds.test = setTimeout(function () {
        reelIn(bait, attemptNum);
      }, _options.loopDelay);
    }
  }

  function clearBaitNode() {
    if (baitNode === null) {
      return true;
    }

    try {
      if (isFunc(baitNode.remove)) {
        baitNode.remove();
      }

      document.body.removeChild(baitNode);
    } catch (ex) {}

    baitNode = null;
    return true;
  }
  /**
  * Halt the test and any pending timeouts
  */


  function stopFishing() {
    if (timerIds.test > 0) {
      clearTimeout(timerIds.test);
    }

    if (timerIds.download > 0) {
      clearTimeout(timerIds.download);
    }

    cancelRemoteDownloads();
    clearBaitNode();
  }
  /**
  * Fire all registered listeners
  */


  function notifyListeners() {
    var i, funcs;

    if (findResult === null) {
      return;
    }

    for (i = 0; i < listeners.length; i++) {
      funcs = listeners[i];

      try {
        if (funcs != null) {
          if (isFunc(funcs['complete'])) {
            funcs['complete'](findResult);
          }

          if (findResult && isFunc(funcs['found'])) {
            funcs['found']();
          } else if (findResult === false && isFunc(funcs['notfound'])) {
            funcs['notfound']();
          }
        }
      } catch (ex) {
        log('Failure in notify listeners ' + ex.Message, true);
      }
    }
  }
  /**
  * Attaches event listener or fires if events have already passed.
  */


  function attachOrFire() {
    var fireNow = false;
    var fn;

    if (document.readyState) {
      if (document.readyState == 'complete') {
        fireNow = true;
      }
    }

    fn = function fn() {
      beginTest(quickBait, false);
    };

    if (fireNow) {
      fn();
    } else {
      attachEventListener(win, 'load', fn);
    }
  }

  var blockLists; // tracks external block lists

  /**
  * Public interface of adblock detector
  */

  var impl = {
    /**
    * Version of the adblock detector package
    */
    version: version,

    /**
    * Initialization function. See comments at top for options object
    */
    init: function init(options) {
      var k, v, funcs;

      if (!options) {
        return;
      }

      funcs = {
        complete: noop,
        found: noop,
        notfound: noop
      };

      for (k in options) {
        if (options.hasOwnProperty(k)) {
          if (k == 'complete' || k == 'found' || k == 'notFound') {
            funcs[k.toLowerCase()] = options[k];
          } else {
            _options[k] = options[k];
          }
        }
      }

      listeners.push(funcs);
      blockLists = new BlockListTracker();
      attachOrFire();
    }
  };
  win['adblockDetector'] = impl;
})(window);
"use strict";

function _typeof(obj) { if (typeof Symbol === "function" && _typeof(Symbol.iterator) === "symbol") { _typeof = function (_typeof2) { function _typeof(_x) { return _typeof2.apply(this, arguments); } _typeof.toString = function () { return _typeof2.toString(); }; return _typeof; }(function (obj) { return typeof obj === "undefined" ? "undefined" : _typeof(obj); }); } else { _typeof = function (_typeof3) { function _typeof(_x2) { return _typeof3.apply(this, arguments); } _typeof.toString = function () { return _typeof3.toString(); }; return _typeof; }(function (obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj === "undefined" ? "undefined" : _typeof(obj); }); } return _typeof(obj); }

/*!
 * @preserve
 * jquery.scrolldepth.js | v1.0
 * Copyright (c) 2016 Rob Flaherty (@robflaherty)
 * Licensed under the MIT and GPL licenses.
 */
!function (e) {
  "function" == typeof define && define.amd ? define(["jquery"], e) : "object" == (typeof module === "undefined" ? "undefined" : _typeof(module)) && module.exports ? module.exports = e(require("jquery")) : e(jQuery);
}(function (e) {
  "use strict";

  var n,
      t,
      r,
      o,
      i = {
    minHeight: 0,
    elements: [],
    percentage: !0,
    userTiming: !0,
    pixelDepth: !0,
    nonInteraction: !0,
    gaGlobal: !1,
    gtmOverride: !1,
    trackerName: !1,
    dataLayer: "dataLayer"
  },
      a = e(window),
      l = [],
      c = !1,
      u = 0;
  return e.scrollDepth = function (p) {
    function s(e, i, a, l) {
      var c = p.trackerName ? p.trackerName + ".send" : "send";
      o ? (o({
        event: "ScrollDistance",
        eventCategory: "Scroll Depth",
        eventAction: e,
        eventLabel: i,
        eventValue: 1,
        eventNonInteraction: p.nonInteraction
      }), p.pixelDepth && arguments.length > 2 && a > u && (u = a, o({
        event: "ScrollDistance",
        eventCategory: "Scroll Depth",
        eventAction: "Pixel Depth",
        eventLabel: d(a),
        eventValue: 1,
        eventNonInteraction: p.nonInteraction
      })), p.userTiming && arguments.length > 3 && o({
        event: "ScrollTiming",
        eventCategory: "Scroll Depth",
        eventAction: e,
        eventLabel: i,
        eventTiming: l
      })) : (n && (window[r](c, "event", "Scroll Depth", e, i, 1, {
        nonInteraction: p.nonInteraction
      }), p.pixelDepth && arguments.length > 2 && a > u && (u = a, window[r](c, "event", "Scroll Depth", "Pixel Depth", d(a), 1, {
        nonInteraction: p.nonInteraction
      })), p.userTiming && arguments.length > 3 && window[r](c, "timing", "Scroll Depth", e, l, i)), t && (_gaq.push(["_trackEvent", "Scroll Depth", e, i, 1, p.nonInteraction]), p.pixelDepth && arguments.length > 2 && a > u && (u = a, _gaq.push(["_trackEvent", "Scroll Depth", "Pixel Depth", d(a), 1, p.nonInteraction])), p.userTiming && arguments.length > 3 && _gaq.push(["_trackTiming", "Scroll Depth", e, l, i, 100])));
    }

    function h(e) {
      return {
        "25%": parseInt(.25 * e, 10),
        "50%": parseInt(.5 * e, 10),
        "75%": parseInt(.75 * e, 10),
        "100%": e - 5
      };
    }

    function g(n, t, r) {
      e.each(n, function (n, o) {
        -1 === e.inArray(n, l) && t >= o && (s("Percentage", n, t, r), l.push(n));
      });
    }

    function f(n, t, r) {
      e.each(n, function (n, o) {
        -1 === e.inArray(o, l) && e(o).length && t >= e(o).offset().top && (s("Elements", o, t, r), l.push(o));
      });
    }

    function d(e) {
      return (250 * Math.floor(e / 250)).toString();
    }

    function m() {
      y();
    }

    function v(e, n) {
      var t,
          r,
          o,
          i = null,
          a = 0,
          l = function l() {
        a = new Date(), i = null, o = e.apply(t, r);
      };

      return function () {
        var c = new Date();
        a || (a = c);
        var u = n - (c - a);
        return t = this, r = arguments, 0 >= u ? (clearTimeout(i), i = null, a = c, o = e.apply(t, r)) : i || (i = setTimeout(l, u)), o;
      };
    }

    function y() {
      c = !0, a.on("scroll.scrollDepth", v(function () {
        var n = e(document).height(),
            t = window.innerHeight ? window.innerHeight : a.height(),
            r = a.scrollTop() + t,
            o = h(n),
            i = +new Date() - D;
        return l.length >= p.elements.length + (p.percentage ? 4 : 0) ? (a.off("scroll.scrollDepth"), void (c = !1)) : (p.elements && f(p.elements, r, i), void (p.percentage && g(o, r, i)));
      }, 500));
    }

    var D = +new Date();
    p = e.extend({}, i, p), e(document).height() < p.minHeight || (p.gaGlobal ? (n = !0, r = p.gaGlobal) : "function" == typeof ga ? (n = !0, r = "ga") : "function" == typeof __gaTracker && (n = !0, r = "__gaTracker"), "undefined" != typeof _gaq && "function" == typeof _gaq.push && (t = !0), "function" == typeof p.eventHandler ? o = p.eventHandler : "undefined" == typeof window[p.dataLayer] || "function" != typeof window[p.dataLayer].push || p.gtmOverride || (o = function o(e) {
      window[p.dataLayer].push(e);
    }), e.scrollDepth.reset = function () {
      l = [], u = 0, a.off("scroll.scrollDepth"), y();
    }, e.scrollDepth.addElements = function (n) {
      "undefined" != typeof n && e.isArray(n) && (e.merge(p.elements, n), c || y());
    }, e.scrollDepth.removeElements = function (n) {
      "undefined" != typeof n && e.isArray(n) && e.each(n, function (n, t) {
        var r = e.inArray(t, p.elements),
            o = e.inArray(t, l);
        -1 != r && p.elements.splice(r, 1), -1 != o && l.splice(o, 1);
      });
    }, m());
  }, e.scrollDepth;
});
"use strict";

(function ($) {
  /*
   * Create a Google Analytics event
   * category: Event Category
   * label: Event Label
   * action: Event Action
   * value: optional
  */
  function wp_analytics_tracking_event(type, category, action, label, value) {
    if (typeof ga !== 'undefined') {
      if (typeof value === 'undefined') {
        ga('send', type, category, action, label);
      } else {
        ga('send', type, category, action, label, value);
      }
    } else {
      return;
    }
  }

  if ('undefined' !== typeof analytics_tracking_settings) {
    if ('undefined' !== typeof analytics_tracking_settings.scroll && true === analytics_tracking_settings.scroll.enabled) {
      $.scrollDepth({
        minHeight: analytics_tracking_settings.scroll.minimum_height,
        elements: analytics_tracking_settings.scroll.scroll_elements.split(', '),
        percentage: analytics_tracking_settings.scroll.percentage,
        userTiming: analytics_tracking_settings.scroll.user_timing,
        pixelDepth: analytics_tracking_settings.scroll.pixel_depth,
        nonInteraction: analytics_tracking_settings.scroll.non_interaction
      });
    }

    if ('undefined' !== typeof analytics_tracking_settings.special && true === analytics_tracking_settings.special.enabled) {
      // external links
      $('a[href^="http"]:not([href*="://' + document.domain + '"])').click(function () {
        wp_analytics_tracking_event('event', 'Outbound links', 'Click', this.href);
      }); // mailto links

      $('a[href^="mailto"]').click(function () {
        wp_analytics_tracking_event('event', 'Mails', 'Click', this.href.substring(7));
      }); // tel links

      $('a[href^="tel"]').click(function () {
        wp_analytics_tracking_event('event', 'Telephone', 'Call', this.href.substring(7));
      }); // internal links

      $('a:not([href^="(http:|https:)?//"],[href^="#"],[href^="mailto:"])').click(function () {
        // track downloads
        if ('' !== analytics_tracking_settings.special.download_regex) {
          var url = this.href;
          var checkDownload = new RegExp("\\.(" + analytics_tracking_settings.special.download_regex + ")([\?#].*)?$", "i");
          var isDownload = checkDownload.test(url);

          if (true === isDownload) {
            var checkDownloadExtension = new RegExp("\\.(" + analytics_tracking_settings.special.download_regex + ")([\?#].*)?$", "i");
            var extensionResult = checkDownloadExtension.exec(url);
            var extension = '';

            if (null !== extensionResult) {
              extension = extensionResult[1];
            } else {
              extension = extensionResult;
            } // we can't use the url for the value here, even though that would be nice, because value is supposed to be an integer


            wp_analytics_tracking_event('event', 'Downloads', extension, this.href);
          }
        }
      });
    }

    if ('undefined' !== typeof analytics_tracking_settings.affiliate && true === analytics_tracking_settings.affiliate.enabled) {
      // any link could be an affiliate, i guess?
      $('a').click(function () {
        // track affiliates
        if ('' !== analytics_tracking_settings.affiliate.affiliate_regex) {
          var checkAffiliate = new RegExp("\\.(" + analytics_tracking_settings.affiliate.affiliate_regex + ")([\?#].*)?$", "i");
          var isAffiliate = checkAffiliate.test(url);

          if (true === isAffiliate) {
            wp_analytics_tracking_event('event', 'Affiliate', 'Click', this.href);
          }
        }
      });
    } // link fragments as pageviews
    // does not use the event tracking method


    if ('undefined' !== typeof analytics_tracking_settings.fragment && true === analytics_tracking_settings.fragment.enabled) {
      if (typeof ga !== 'undefined') {
        window.onhashchange = function () {
          ga('send', 'pageview', location.pathname + location.search + location.hash);
        };
      }
    } // basic form submits


    if ('undefined' !== typeof analytics_tracking_settings.form_submissions && true === analytics_tracking_settings.form_submissions.enabled) {
      $('input[type="submit"], button[type="submit"]').click(function (f) {
        var category = $(this).data('ga-category') || 'Form';
        var action = $(this).data('ga-action') || 'Submit';
        var label = $(this).data('ga-label') || this.name || this.value;
        wp_analytics_tracking_event('event', category, action, label);
      });
    }
  }

  $(document).ready(function () {
    if ('undefined' !== typeof analytics_tracking_settings.track_adblocker && true === analytics_tracking_settings.track_adblocker.enabled) {
      if (typeof window.adblockDetector === 'undefined') {
        wp_analytics_tracking_event('event', 'Adblock', 'On', {
          'nonInteraction': 1
        });
      } else {
        window.adblockDetector.init({
          debug: false,
          found: function found() {
            wp_analytics_tracking_event('event', 'Adblock', 'On', {
              'nonInteraction': 1
            });
          },
          notFound: function notFound() {
            wp_analytics_tracking_event('event', 'Adblock', 'Off', {
              'nonInteraction': 1
            });
          }
        });
      }
    }
  });
})(jQuery);
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFkYmxvY2tEZXRlY3Rvci5qcyIsImpxdWVyeS5zY3JvbGxkZXB0aC5taW4uanMiLCJ3cC1ldmVudC10cmFja2luZy5qcyJdLCJuYW1lcyI6WyJ3aW4iLCJ2ZXJzaW9uIiwib2ZzIiwiY2wiLCJub29wIiwidGVzdGVkT25jZSIsInRlc3RFeGVjdXRpbmciLCJpc09sZElFZXZlbnRzIiwiYWRkRXZlbnRMaXN0ZW5lciIsInVuZGVmaW5lZCIsIl9vcHRpb25zIiwibG9vcERlbGF5IiwibWF4TG9vcCIsImRlYnVnIiwiZm91bmQiLCJub3Rmb3VuZCIsImNvbXBsZXRlIiwicGFyc2VBc0pzb24iLCJkYXRhIiwicmVzdWx0IiwiZm5EYXRhIiwiSlNPTiIsInBhcnNlIiwiZXgiLCJGdW5jdGlvbiIsImxvZyIsIkFqYXhIZWxwZXIiLCJvcHRzIiwieGhyIiwiWE1MSHR0cFJlcXVlc3QiLCJzdWNjZXNzIiwiZmFpbCIsIm1lIiwibWV0aG9kIiwiYWJvcnQiLCJzdGF0ZUNoYW5nZSIsInZhbHMiLCJyZWFkeVN0YXRlIiwic3RhdHVzIiwicmVzcG9uc2UiLCJvbnJlYWR5c3RhdGVjaGFuZ2UiLCJzdGFydCIsIm9wZW4iLCJ1cmwiLCJzZW5kIiwiQmxvY2tMaXN0VHJhY2tlciIsImV4dGVybmFsQmxvY2tsaXN0RGF0YSIsImFkZFVybCIsInN0YXRlIiwiZm9ybWF0Iiwic2V0UmVzdWx0IiwidXJsS2V5Iiwib2JqIiwibGlzdGVuZXJzIiwiYmFpdE5vZGUiLCJxdWlja0JhaXQiLCJjc3NDbGFzcyIsImJhaXRUcmlnZ2VycyIsIm51bGxQcm9wcyIsInplcm9Qcm9wcyIsImV4ZVJlc3VsdCIsInF1aWNrIiwicmVtb3RlIiwiZmluZFJlc3VsdCIsInRpbWVySWRzIiwidGVzdCIsImRvd25sb2FkIiwiaXNGdW5jIiwiZm4iLCJtYWtlRWwiLCJ0YWciLCJhdHRyaWJ1dGVzIiwiayIsInYiLCJlbCIsImF0dHIiLCJkIiwiZG9jdW1lbnQiLCJjcmVhdGVFbGVtZW50IiwiaGFzT3duUHJvcGVydHkiLCJzZXRBdHRyaWJ1dGUiLCJhdHRhY2hFdmVudExpc3RlbmVyIiwiZG9tIiwiZXZlbnROYW1lIiwiaGFuZGxlciIsImF0dGFjaEV2ZW50IiwibWVzc2FnZSIsImlzRXJyb3IiLCJjb25zb2xlIiwiZXJyb3IiLCJhamF4RG93bmxvYWRzIiwibG9hZEV4ZWN1dGVVcmwiLCJhamF4IiwiYmxvY2tMaXN0cyIsImludGVydmFsSWQiLCJyZXRyeUNvdW50IiwidHJ5RXhlY3V0ZVRlc3QiLCJsaXN0RGF0YSIsImJlZ2luVGVzdCIsInNldEludGVydmFsIiwiY2xlYXJJbnRlcnZhbCIsInB1c2giLCJmZXRjaFJlbW90ZUxpc3RzIiwiaSIsImxlbmd0aCIsImNhbmNlbFJlbW90ZURvd25sb2FkcyIsImFqIiwicG9wIiwiYmFpdCIsImNhc3RCYWl0Iiwic2V0VGltZW91dCIsInJlZWxJbiIsImIiLCJib2R5IiwidCIsImJhaXRTdHlsZSIsInN0eWxlIiwiYXBwZW5kQ2hpbGQiLCJhdHRlbXB0TnVtIiwiY2xlYXJCYWl0Tm9kZSIsImNsZWFyVGltZW91dCIsImdldEF0dHJpYnV0ZSIsIndpbmRvdyIsImdldENvbXB1dGVkU3R5bGUiLCJiYWl0VGVtcCIsImdldFByb3BlcnR5VmFsdWUiLCJub3RpZnlMaXN0ZW5lcnMiLCJyZW1vdmUiLCJyZW1vdmVDaGlsZCIsInN0b3BGaXNoaW5nIiwiZnVuY3MiLCJNZXNzYWdlIiwiYXR0YWNoT3JGaXJlIiwiZmlyZU5vdyIsImltcGwiLCJpbml0Iiwib3B0aW9ucyIsInRvTG93ZXJDYXNlIiwiZSIsImRlZmluZSIsImFtZCIsIm1vZHVsZSIsImV4cG9ydHMiLCJyZXF1aXJlIiwialF1ZXJ5IiwibiIsInIiLCJvIiwibWluSGVpZ2h0IiwiZWxlbWVudHMiLCJwZXJjZW50YWdlIiwidXNlclRpbWluZyIsInBpeGVsRGVwdGgiLCJub25JbnRlcmFjdGlvbiIsImdhR2xvYmFsIiwiZ3RtT3ZlcnJpZGUiLCJ0cmFja2VyTmFtZSIsImRhdGFMYXllciIsImEiLCJsIiwiYyIsInUiLCJzY3JvbGxEZXB0aCIsInAiLCJzIiwiZXZlbnQiLCJldmVudENhdGVnb3J5IiwiZXZlbnRBY3Rpb24iLCJldmVudExhYmVsIiwiZXZlbnRWYWx1ZSIsImV2ZW50Tm9uSW50ZXJhY3Rpb24iLCJhcmd1bWVudHMiLCJldmVudFRpbWluZyIsIl9nYXEiLCJoIiwicGFyc2VJbnQiLCJnIiwiZWFjaCIsImluQXJyYXkiLCJmIiwib2Zmc2V0IiwidG9wIiwiTWF0aCIsImZsb29yIiwidG9TdHJpbmciLCJtIiwieSIsIkRhdGUiLCJhcHBseSIsIm9uIiwiaGVpZ2h0IiwiaW5uZXJIZWlnaHQiLCJzY3JvbGxUb3AiLCJEIiwib2ZmIiwiZXh0ZW5kIiwiZ2EiLCJfX2dhVHJhY2tlciIsImV2ZW50SGFuZGxlciIsInJlc2V0IiwiYWRkRWxlbWVudHMiLCJpc0FycmF5IiwibWVyZ2UiLCJyZW1vdmVFbGVtZW50cyIsInNwbGljZSIsIiQiLCJ3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQiLCJ0eXBlIiwiY2F0ZWdvcnkiLCJhY3Rpb24iLCJsYWJlbCIsInZhbHVlIiwiYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzIiwic2Nyb2xsIiwiZW5hYmxlZCIsIm1pbmltdW1faGVpZ2h0Iiwic2Nyb2xsX2VsZW1lbnRzIiwic3BsaXQiLCJ1c2VyX3RpbWluZyIsInBpeGVsX2RlcHRoIiwibm9uX2ludGVyYWN0aW9uIiwic3BlY2lhbCIsImRvbWFpbiIsImNsaWNrIiwiaHJlZiIsInN1YnN0cmluZyIsImRvd25sb2FkX3JlZ2V4IiwiY2hlY2tEb3dubG9hZCIsIlJlZ0V4cCIsImlzRG93bmxvYWQiLCJjaGVja0Rvd25sb2FkRXh0ZW5zaW9uIiwiZXh0ZW5zaW9uUmVzdWx0IiwiZXhlYyIsImV4dGVuc2lvbiIsImFmZmlsaWF0ZSIsImFmZmlsaWF0ZV9yZWdleCIsImNoZWNrQWZmaWxpYXRlIiwiaXNBZmZpbGlhdGUiLCJmcmFnbWVudCIsIm9uaGFzaGNoYW5nZSIsImxvY2F0aW9uIiwicGF0aG5hbWUiLCJzZWFyY2giLCJoYXNoIiwiZm9ybV9zdWJtaXNzaW9ucyIsIm5hbWUiLCJyZWFkeSIsInRyYWNrX2FkYmxvY2tlciIsImFkYmxvY2tEZXRlY3RvciIsIm5vdEZvdW5kIl0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpQ0E7O0FBQ0EsQ0FBQyxVQUFTQSxHQUFULEVBQWM7QUFFZCxNQUFJQyxPQUFPLEdBQUcsS0FBZDtBQUVBLE1BQUlDLEdBQUcsR0FBRyxRQUFWO0FBQUEsTUFBb0JDLEVBQUUsR0FBRyxRQUF6Qjs7QUFDQSxNQUFJQyxJQUFJLEdBQUcsU0FBUEEsSUFBTyxHQUFVLENBQUUsQ0FBdkI7O0FBRUEsTUFBSUMsVUFBVSxHQUFHLEtBQWpCO0FBQ0EsTUFBSUMsYUFBYSxHQUFHLEtBQXBCO0FBRUEsTUFBSUMsYUFBYSxHQUFJUCxHQUFHLENBQUNRLGdCQUFKLEtBQXlCQyxTQUE5QztBQUVBOzs7OztBQUlBLE1BQUlDLFFBQVEsR0FBRztBQUNkQyxJQUFBQSxTQUFTLEVBQUUsRUFERztBQUVkQyxJQUFBQSxPQUFPLEVBQUUsQ0FGSztBQUdkQyxJQUFBQSxLQUFLLEVBQUUsSUFITztBQUlkQyxJQUFBQSxLQUFLLEVBQUVWLElBSk87QUFJSTtBQUNsQlcsSUFBQUEsUUFBUSxFQUFFWCxJQUxJO0FBS007QUFDcEJZLElBQUFBLFFBQVEsRUFBRVosSUFOSSxDQU1NOztBQU5OLEdBQWY7O0FBU0EsV0FBU2EsV0FBVCxDQUFxQkMsSUFBckIsRUFBMEI7QUFDekIsUUFBSUMsTUFBSixFQUFZQyxNQUFaOztBQUNBLFFBQUc7QUFDRkQsTUFBQUEsTUFBTSxHQUFHRSxJQUFJLENBQUNDLEtBQUwsQ0FBV0osSUFBWCxDQUFUO0FBQ0EsS0FGRCxDQUdBLE9BQU1LLEVBQU4sRUFBUztBQUNSLFVBQUc7QUFDRkgsUUFBQUEsTUFBTSxHQUFHLElBQUlJ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b250LWVuZC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBZEJsb2NrIGRldGVjdG9yXG4vL1xuLy8gQXR0ZW1wdHMgdG8gZGV0ZWN0IHRoZSBwcmVzZW5jZSBvZiBBZCBCbG9ja2VyIHNvZnR3YXJlIGFuZCBub3RpZnkgbGlzdGVuZXIgb2YgaXRzIGV4aXN0ZW5jZS5cbi8vIENvcHlyaWdodCAoYykgMjAxNyBJQUJcbi8vXG4vLyBUaGUgQlNELTMgTGljZW5zZVxuLy8gUmVkaXN0cmlidXRpb24gYW5kIHVzZSBpbiBzb3VyY2UgYW5kIGJpbmFyeSBmb3Jtcywgd2l0aCBvciB3aXRob3V0IG1vZGlmaWNhdGlvbiwgYXJlIHBlcm1pdHRlZCBwcm92aWRlZCB0aGF0IHRoZSBmb2xsb3dpbmcgY29uZGl0aW9ucyBhcmUgbWV0OlxuLy8gMS4gUmVkaXN0cmlidXRpb25zIG9mIHNvdXJjZSBjb2RlIG11c3QgcmV0YWluIHRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2YgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyLlxuLy8gMi4gUmVkaXN0cmlidXRpb25zIGluIGJpbmFyeSBmb3JtIG11c3QgcmVwcm9kdWNlIHRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2YgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyIGluIHRoZSBkb2N1bWVudGF0aW9uIGFuZC9vciBvdGhlciBtYXRlcmlhbHMgcHJvdmlkZWQgd2l0aCB0aGUgZGlzdHJpYnV0aW9uLlxuLy8gMy4gTmVpdGhlciB0aGUgbmFtZSBvZiB0aGUgY29weXJpZ2h0IGhvbGRlciBub3IgdGhlIG5hbWVzIG9mIGl0cyBjb250cmlidXRvcnMgbWF5IGJlIHVzZWQgdG8gZW5kb3JzZSBvciBwcm9tb3RlIHByb2R1Y3RzIGRlcml2ZWQgZnJvbSB0aGlzIHNvZnR3YXJlIHdpdGhvdXQgc3BlY2lmaWMgcHJpb3Igd3JpdHRlbiBwZXJtaXNzaW9uLlxuLy8gVEhJUyBTT0ZUV0FSRSBJUyBQUk9WSURFRCBCWSBUSEUgQ09QWVJJR0hUIEhPTERFUlMgQU5EIENPTlRSSUJVVE9SUyBcIkFTIElTXCIgQU5EIEFOWSBFWFBSRVNTIE9SIElNUExJRUQgV0FSUkFOVElFUywgSU5DTFVESU5HLCBCVVQgTk9UIExJTUlURUQgVE8sIFRIRSBJTVBMSUVEIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkUgRElTQ0xBSU1FRC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIENPUFlSSUdIVCBIT0xERVIgT1IgQ09OVFJJQlVUT1JTIEJFIExJQUJMRSBGT1IgQU5ZIERJUkVDVCwgSU5ESVJFQ1QsIElOQ0lERU5UQUwsIFNQRUNJQUwsIEVYRU1QTEFSWSwgT1IgQ09OU0VRVUVOVElBTCBEQU1BR0VTIChJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgUFJPQ1VSRU1FTlQgT0YgU1VCU1RJVFVURSBHT09EUyBPUiBTRVJWSUNFUzsgTE9TUyBPRiBVU0UsIERBVEEsIE9SIFBST0ZJVFM7IE9SIEJVU0lORVNTIElOVEVSUlVQVElPTikgSE9XRVZFUiBDQVVTRUQgQU5EIE9OIEFOWSBUSEVPUlkgT0YgTElBQklMSVRZLCBXSEVUSEVSIElOIENPTlRSQUNULCBTVFJJQ1QgTElBQklMSVRZLCBPUiBUT1JUIChJTkNMVURJTkcgTkVHTElHRU5DRSBPUiBPVEhFUldJU0UpIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRiBUSElTIFNPRlRXQVJFLCBFVkVOIElGIEFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4qIEBuYW1lIHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3JcbipcbiogSUFCIEFkYmxvY2sgZGV0ZWN0b3IuXG4qIFVzYWdlOiB3aW5kb3cuYWRibG9ja0RldGVjdG9yLmluaXQob3B0aW9ucyk7XG4qXG4qIE9wdGlvbnMgb2JqZWN0IHNldHRpbmdzXG4qXG4qXHRAcHJvcCBkZWJ1ZzogIGJvb2xlYW5cbiogICAgICAgICBGbGFnIHRvIGluZGljYXRlIGFkZGl0aW9uYWwgZGVidWcgb3V0cHV0IHNob3VsZCBiZSBwcmludGVkIHRvIGNvbnNvbGVcbipcbipcdEBwcm9wIGZvdW5kOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgaXMgZGV0ZWN0ZWRcbipcbipcdEBwcm9wIG5vdGZvdW5kOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgaXMgbm90IGRldGVjdGVkLlxuKiAgICAgICAgIE5PVEU6IHRoaXMgZnVuY3Rpb24gbWF5IGZpcmUgbXVsdGlwbGUgdGltZXMgYW5kIGdpdmUgZmFsc2UgbmVnYXRpdmVcbiogICAgICAgICByZXNwb25zZXMgZHVyaW5nIGEgdGVzdCB1bnRpbCBhZGJsb2NrIGlzIHN1Y2Nlc3NmdWxseSBkZXRlY3RlZC5cbipcbipcdEBwcm9wIGNvbXBsZXRlOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIG9uY2UgYSByb3VuZCBvZiB0ZXN0aW5nIGlzIGNvbXBsZXRlLlxuKiAgICAgICAgIFRoZSB0ZXN0IHJlc3VsdCAoYm9vbGVhbikgaXMgaW5jbHVkZWQgYXMgYSBwYXJhbWV0ZXIgdG8gY2FsbGJhY2tcbipcbiogZXhhbXBsZTogXHR3aW5kb3cuYWRibG9ja0RldGVjdG9yLmluaXQoXG5cdFx0XHRcdHtcblx0XHRcdFx0XHRmb3VuZDogZnVuY3Rpb24oKXsgLi4ufSxcbiBcdFx0XHRcdFx0bm90Rm91bmQ6IGZ1bmN0aW9uKCl7Li4ufVxuXHRcdFx0XHR9XG5cdFx0XHQpO1xuKlxuKlxuKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG4oZnVuY3Rpb24od2luKSB7XG5cblx0dmFyIHZlcnNpb24gPSAnMS4wJztcblxuXHR2YXIgb2ZzID0gJ29mZnNldCcsIGNsID0gJ2NsaWVudCc7XG5cdHZhciBub29wID0gZnVuY3Rpb24oKXt9O1xuXG5cdHZhciB0ZXN0ZWRPbmNlID0gZmFsc2U7XG5cdHZhciB0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cblx0dmFyIGlzT2xkSUVldmVudHMgPSAod2luLmFkZEV2ZW50TGlzdGVuZXIgPT09IHVuZGVmaW5lZCk7XG5cblx0LyoqXG5cdCogT3B0aW9ucyBzZXQgd2l0aCBkZWZhdWx0IG9wdGlvbnMgaW5pdGlhbGl6ZWRcblx0KlxuXHQqL1xuXHR2YXIgX29wdGlvbnMgPSB7XG5cdFx0bG9vcERlbGF5OiA1MCxcblx0XHRtYXhMb29wOiA1LFxuXHRcdGRlYnVnOiB0cnVlLFxuXHRcdGZvdW5kOiBub29wLCBcdFx0XHRcdFx0Ly8gZnVuY3Rpb24gdG8gZmlyZSB3aGVuIGFkYmxvY2sgZGV0ZWN0ZWRcblx0XHRub3Rmb3VuZDogbm9vcCwgXHRcdFx0XHQvLyBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgbm90IGRldGVjdGVkIGFmdGVyIHRlc3Rpbmdcblx0XHRjb21wbGV0ZTogbm9vcCAgXHRcdFx0XHQvLyBmdW5jdGlvbiB0byBmaXJlIGFmdGVyIHRlc3RpbmcgY29tcGxldGVzLCBwYXNzaW5nIHJlc3VsdCBhcyBwYXJhbWV0ZXJcblx0fVxuXG5cdGZ1bmN0aW9uIHBhcnNlQXNKc29uKGRhdGEpe1xuXHRcdHZhciByZXN1bHQsIGZuRGF0YTtcblx0XHR0cnl7XG5cdFx0XHRyZXN1bHQgPSBKU09OLnBhcnNlKGRhdGEpO1xuXHRcdH1cblx0XHRjYXRjaChleCl7XG5cdFx0XHR0cnl7XG5cdFx0XHRcdGZuRGF0YSA9IG5ldyBGdW5jdGlvbihcInJldHVybiBcIiArIGRhdGEpO1xuXHRcdFx0XHRyZXN1bHQgPSBmbkRhdGEoKTtcblx0XHRcdH1cblx0XHRcdGNhdGNoKGV4KXtcblx0XHRcdFx0bG9nKCdGYWlsZWQgc2Vjb25kYXJ5IEpTT04gcGFyc2UnLCB0cnVlKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0LyoqXG5cdCogQWpheCBoZWxwZXIgb2JqZWN0IHRvIGRvd25sb2FkIGV4dGVybmFsIHNjcmlwdHMuXG5cdCogSW5pdGlhbGl6ZSBvYmplY3Qgd2l0aCBhbiBvcHRpb25zIG9iamVjdFxuXHQqIEV4OlxuXHQgIHtcblx0XHQgIHVybCA6ICdodHRwOi8vZXhhbXBsZS5vcmcvdXJsX3RvX2Rvd25sb2FkJyxcblx0XHQgIG1ldGhvZDogJ1BPU1R8R0VUJyxcblx0XHQgIHN1Y2Nlc3M6IGNhbGxiYWNrX2Z1bmN0aW9uLFxuXHRcdCAgZmFpbDogIGNhbGxiYWNrX2Z1bmN0aW9uXG5cdCAgfVxuXHQqL1xuXHR2YXIgQWpheEhlbHBlciA9IGZ1bmN0aW9uKG9wdHMpe1xuXHRcdHZhciB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblxuXHRcdHRoaXMuc3VjY2VzcyA9IG9wdHMuc3VjY2VzcyB8fCBub29wO1xuXHRcdHRoaXMuZmFpbCA9IG9wdHMuZmFpbCB8fCBub29wO1xuXHRcdHZhciBtZSA9IHRoaXM7XG5cblx0XHR2YXIgbWV0aG9kID0gb3B0cy5tZXRob2QgfHwgJ2dldCc7XG5cblx0XHQvKipcblx0XHQqIEFib3J0IHRoZSByZXF1ZXN0XG5cdFx0Ki9cblx0XHR0aGlzLmFib3J0ID0gZnVuY3Rpb24oKXtcblx0XHRcdHRyeXtcblx0XHRcdFx0eGhyLmFib3J0KCk7XG5cdFx0XHR9XG5cdFx0XHRjYXRjaChleCl7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gc3RhdGVDaGFuZ2UodmFscyl7XG5cdFx0XHRpZih4aHIucmVhZHlTdGF0ZSA9PSA0KXtcblx0XHRcdFx0aWYoeGhyLnN0YXR1cyA9PSAyMDApe1xuXHRcdFx0XHRcdG1lLnN1Y2Nlc3MoeGhyLnJlc3BvbnNlKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNle1xuXHRcdFx0XHRcdC8vIGZhaWxlZFxuXHRcdFx0XHRcdG1lLmZhaWwoeGhyLnN0YXR1cyk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHR4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gc3RhdGVDaGFuZ2U7XG5cblx0XHRmdW5jdGlvbiBzdGFydCgpe1xuXHRcdFx0eGhyLm9wZW4obWV0aG9kLCBvcHRzLnVybCwgdHJ1ZSk7XG5cdFx0XHR4aHIuc2VuZCgpO1xuXHRcdH1cblxuXHRcdHN0YXJ0KCk7XG5cdH1cblxuXHQvKipcblx0KiBPYmplY3QgdHJhY2tpbmcgdGhlIHZhcmlvdXMgYmxvY2sgbGlzdHNcblx0Ki9cblx0dmFyIEJsb2NrTGlzdFRyYWNrZXIgPSBmdW5jdGlvbigpe1xuXHRcdHZhciBtZSA9IHRoaXM7XG5cdFx0dmFyIGV4dGVybmFsQmxvY2tsaXN0RGF0YSA9IHt9O1xuXG5cdFx0LyoqXG5cdFx0KiBBZGQgYSBuZXcgZXh0ZXJuYWwgVVJMIHRvIHRyYWNrXG5cdFx0Ki9cblx0XHR0aGlzLmFkZFVybCA9IGZ1bmN0aW9uKHVybCl7XG5cdFx0XHRleHRlcm5hbEJsb2NrbGlzdERhdGFbdXJsXSA9IHtcblx0XHRcdFx0dXJsOiB1cmwsXG5cdFx0XHRcdHN0YXRlOiAncGVuZGluZycsXG5cdFx0XHRcdGZvcm1hdDogbnVsbCxcblx0XHRcdFx0ZGF0YTogbnVsbCxcblx0XHRcdFx0cmVzdWx0OiBudWxsXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBleHRlcm5hbEJsb2NrbGlzdERhdGFbdXJsXTtcblx0XHR9XG5cblx0XHQvKipcblx0XHQqIExvYWRzIGEgYmxvY2sgbGlzdCBkZWZpbml0aW9uXG5cdFx0Ki9cblx0XHR0aGlzLnNldFJlc3VsdCA9IGZ1bmN0aW9uKHVybEtleSwgc3RhdGUsIGRhdGEpe1xuXHRcdFx0dmFyIG9iaiA9IGV4dGVybmFsQmxvY2tsaXN0RGF0YVt1cmxLZXldO1xuXHRcdFx0aWYob2JqID09IG51bGwpe1xuXHRcdFx0XHRvYmogPSB0aGlzLmFkZFVybCh1cmxLZXkpO1xuXHRcdFx0fVxuXG5cdFx0XHRvYmouc3RhdGUgPSBzdGF0ZTtcblx0XHRcdGlmKGRhdGEgPT0gbnVsbCl7XG5cdFx0XHRcdG9iai5yZXN1bHQgPSBudWxsO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGlmKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJyl7XG5cdFx0XHRcdHRyeXtcblx0XHRcdFx0XHRkYXRhID0gcGFyc2VBc0pzb24oZGF0YSk7XG5cdFx0XHRcdFx0b2JqLmZvcm1hdCA9ICdqc29uJztcblx0XHRcdFx0fVxuXHRcdFx0XHRjYXRjaChleCl7XG5cdFx0XHRcdFx0b2JqLmZvcm1hdCA9ICdlYXN5bGlzdCc7XG5cdFx0XHRcdFx0Ly8gcGFyc2VFYXN5TGlzdChkYXRhKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0b2JqLmRhdGEgPSBkYXRhO1xuXG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH1cblxuXHR9XG5cblx0dmFyIGxpc3RlbmVycyA9IFtdOyAvLyBldmVudCByZXNwb25zZSBsaXN0ZW5lcnNcblx0dmFyIGJhaXROb2RlID0gbnVsbDtcblx0dmFyIHF1aWNrQmFpdCA9IHtcblx0XHRjc3NDbGFzczogJ3B1Yl8zMDB4MjUwIHB1Yl8zMDB4MjUwbSBwdWJfNzI4eDkwIHRleHQtYWQgdGV4dEFkIHRleHRfYWQgdGV4dF9hZHMgdGV4dC1hZHMgdGV4dC1hZC1saW5rcydcblx0fTtcblx0dmFyIGJhaXRUcmlnZ2VycyA9IHtcblx0XHRudWxsUHJvcHM6IFtvZnMgKyAnUGFyZW50J10sXG5cdFx0emVyb1Byb3BzOiBbXVxuXHR9O1xuXG5cdGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHMgPSBbXG5cdFx0b2ZzICsnSGVpZ2h0Jywgb2ZzICsnTGVmdCcsIG9mcyArJ1RvcCcsIG9mcyArJ1dpZHRoJywgb2ZzICsnSGVpZ2h0Jyxcblx0XHRjbCArICdIZWlnaHQnLCBjbCArICdXaWR0aCdcblx0XTtcblxuXHQvLyByZXN1bHQgb2JqZWN0XG5cdHZhciBleGVSZXN1bHQgPSB7XG5cdFx0cXVpY2s6IG51bGwsXG5cdFx0cmVtb3RlOiBudWxsXG5cdH07XG5cblx0dmFyIGZpbmRSZXN1bHQgPSBudWxsOyAvLyByZXN1bHQgb2YgdGVzdCBmb3IgYWQgYmxvY2tlclxuXG5cdHZhciB0aW1lcklkcyA9IHtcblx0XHR0ZXN0OiAwLFxuXHRcdGRvd25sb2FkOiAwXG5cdH07XG5cblx0ZnVuY3Rpb24gaXNGdW5jKGZuKXtcblx0XHRyZXR1cm4gdHlwZW9mKGZuKSA9PSAnZnVuY3Rpb24nO1xuXHR9XG5cblx0LyoqXG5cdCogTWFrZSBhIERPTSBlbGVtZW50XG5cdCovXG5cdGZ1bmN0aW9uIG1ha2VFbCh0YWcsIGF0dHJpYnV0ZXMpe1xuXHRcdHZhciBrLCB2LCBlbCwgYXR0ciA9IGF0dHJpYnV0ZXM7XG5cdFx0dmFyIGQgPSBkb2N1bWVudDtcblxuXHRcdGVsID0gZC5jcmVhdGVFbGVtZW50KHRhZyk7XG5cblx0XHRpZihhdHRyKXtcblx0XHRcdGZvcihrIGluIGF0dHIpe1xuXHRcdFx0XHRpZihhdHRyLmhhc093blByb3BlcnR5KGspKXtcblx0XHRcdFx0XHRlbC5zZXRBdHRyaWJ1dGUoaywgYXR0cltrXSk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gZWw7XG5cdH1cblxuXHRmdW5jdGlvbiBhdHRhY2hFdmVudExpc3RlbmVyKGRvbSwgZXZlbnROYW1lLCBoYW5kbGVyKXtcblx0XHRpZihpc09sZElFZXZlbnRzKXtcblx0XHRcdGRvbS5hdHRhY2hFdmVudCgnb24nICsgZXZlbnROYW1lLCBoYW5kbGVyKTtcblx0XHR9XG5cdFx0ZWxzZXtcblx0XHRcdGRvbS5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlciwgZmFsc2UpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGxvZyhtZXNzYWdlLCBpc0Vycm9yKXtcblx0XHRpZighX29wdGlvbnMuZGVidWcgJiYgIWlzRXJyb3Ipe1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZih3aW4uY29uc29sZSAmJiB3aW4uY29uc29sZS5sb2cpe1xuXHRcdFx0aWYoaXNFcnJvcil7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tBQkRdICcgKyBtZXNzYWdlKTtcblx0XHRcdH1cblx0XHRcdGVsc2V7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCdbQUJEXSAnICsgbWVzc2FnZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0dmFyIGFqYXhEb3dubG9hZHMgPSBbXTtcblxuXHQvKipcblx0KiBMb2FkIGFuZCBleGVjdXRlIHRoZSBVUkwgaW5zaWRlIGEgY2xvc3VyZSBmdW5jdGlvblxuXHQqL1xuXHRmdW5jdGlvbiBsb2FkRXhlY3V0ZVVybCh1cmwpe1xuXHRcdHZhciBhamF4LCByZXN1bHQ7XG5cblx0XHRibG9ja0xpc3RzLmFkZFVybCh1cmwpO1xuXHRcdC8vIHNldHVwIGNhbGwgZm9yIHJlbW90ZSBsaXN0XG5cdFx0YWpheCA9IG5ldyBBamF4SGVscGVyKFxuXHRcdFx0e1xuXHRcdFx0XHR1cmw6IHVybCxcblx0XHRcdFx0c3VjY2VzczogZnVuY3Rpb24oZGF0YSl7XG5cdFx0XHRcdFx0bG9nKCdkb3dubG9hZGVkIGZpbGUgJyArIHVybCk7IC8vIHRvZG8gLSBwYXJzZSBhbmQgc3RvcmUgdW50aWwgdXNlXG5cdFx0XHRcdFx0cmVzdWx0ID0gYmxvY2tMaXN0cy5zZXRSZXN1bHQodXJsLCAnc3VjY2VzcycsIGRhdGEpO1xuXHRcdFx0XHRcdHRyeXtcblx0XHRcdFx0XHRcdHZhciBpbnRlcnZhbElkID0gMCxcblx0XHRcdFx0XHRcdFx0cmV0cnlDb3VudCA9IDA7XG5cblx0XHRcdFx0XHRcdHZhciB0cnlFeGVjdXRlVGVzdCA9IGZ1bmN0aW9uKGxpc3REYXRhKXtcblx0XHRcdFx0XHRcdFx0aWYoIXRlc3RFeGVjdXRpbmcpe1xuXHRcdFx0XHRcdFx0XHRcdGJlZ2luVGVzdChsaXN0RGF0YSwgdHJ1ZSk7XG5cdFx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRpZihmaW5kUmVzdWx0ID09IHRydWUpe1xuXHRcdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdGlmKHRyeUV4ZWN1dGVUZXN0KHJlc3VsdC5kYXRhKSl7XG5cdFx0XHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdGVsc2V7XG5cdFx0XHRcdFx0XHRcdGxvZygnUGF1c2UgYmVmb3JlIHRlc3QgZXhlY3V0aW9uJyk7XG5cdFx0XHRcdFx0XHRcdGludGVydmFsSWQgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpe1xuXHRcdFx0XHRcdFx0XHRcdGlmKHRyeUV4ZWN1dGVUZXN0KHJlc3VsdC5kYXRhKSB8fCByZXRyeUNvdW50KysgPiA1KXtcblx0XHRcdFx0XHRcdFx0XHRcdGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxJZCk7XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9LCAyNTApO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRjYXRjaChleCl7XG5cdFx0XHRcdFx0XHRsb2coZXgubWVzc2FnZSArICcgdXJsOiAnICsgdXJsLCB0cnVlKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0sXG5cdFx0XHRcdGZhaWw6IGZ1bmN0aW9uKHN0YXR1cyl7XG5cdFx0XHRcdFx0bG9nKHN0YXR1cywgdHJ1ZSk7XG5cdFx0XHRcdFx0YmxvY2tMaXN0cy5zZXRSZXN1bHQodXJsLCAnZXJyb3InLCBudWxsKTtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cblx0XHRhamF4RG93bmxvYWRzLnB1c2goYWpheCk7XG5cdH1cblxuXG5cdC8qKlxuXHQqIEZldGNoIHRoZSBleHRlcm5hbCBsaXN0cyBhbmQgaW5pdGlhdGUgdGhlIHRlc3RzXG5cdCovXG5cdGZ1bmN0aW9uIGZldGNoUmVtb3RlTGlzdHMoKXtcblx0XHR2YXIgaSwgdXJsO1xuXHRcdHZhciBvcHRzID0gX29wdGlvbnM7XG5cblx0XHRmb3IoaT0wO2k8b3B0cy5ibG9ja0xpc3RzLmxlbmd0aDtpKyspe1xuXHRcdFx0dXJsID0gb3B0cy5ibG9ja0xpc3RzW2ldO1xuXHRcdFx0bG9hZEV4ZWN1dGVVcmwodXJsKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBjYW5jZWxSZW1vdGVEb3dubG9hZHMoKXtcblx0XHR2YXIgaSwgYWo7XG5cblx0XHRmb3IoaT1hamF4RG93bmxvYWRzLmxlbmd0aC0xO2kgPj0gMDtpLS0pe1xuXHRcdFx0YWogPSBhamF4RG93bmxvYWRzLnBvcCgpO1xuXHRcdFx0YWouYWJvcnQoKTtcblx0XHR9XG5cdH1cblxuXG5cdC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cdC8qKlxuXHQqIEJlZ2luIGV4ZWN1dGlvbiBvZiB0aGUgdGVzdFxuXHQqL1xuXHRmdW5jdGlvbiBiZWdpblRlc3QoYmFpdCl7XG5cdFx0bG9nKCdzdGFydCBiZWdpblRlc3QnKTtcblx0XHRpZihmaW5kUmVzdWx0ID09IHRydWUpe1xuXHRcdFx0cmV0dXJuOyAvLyB3ZSBmb3VuZCBpdC4gZG9uJ3QgY29udGludWUgZXhlY3V0aW5nXG5cdFx0fVxuXHRcdHRlc3RFeGVjdXRpbmcgPSB0cnVlO1xuXHRcdGNhc3RCYWl0KGJhaXQpO1xuXG5cdFx0ZXhlUmVzdWx0LnF1aWNrID0gJ3Rlc3RpbmcnO1xuXG5cdFx0dGltZXJJZHMudGVzdCA9IHNldFRpbWVvdXQoXG5cdFx0XHRmdW5jdGlvbigpeyByZWVsSW4oYmFpdCwgMSk7IH0sXG5cdFx0XHQ1KTtcblx0fVxuXG5cdC8qKlxuXHQqIENyZWF0ZSB0aGUgYmFpdCBub2RlIHRvIHNlZSBob3cgdGhlIGJyb3dzZXIgcGFnZSByZWFjdHNcblx0Ki9cblx0ZnVuY3Rpb24gY2FzdEJhaXQoYmFpdCl7XG5cdFx0dmFyIGksIGQgPSBkb2N1bWVudCwgYiA9IGQuYm9keTtcblx0XHR2YXIgdDtcblx0XHR2YXIgYmFpdFN0eWxlID0gJ3dpZHRoOiAxcHggIWltcG9ydGFudDsgaGVpZ2h0OiAxcHggIWltcG9ydGFudDsgcG9zaXRpb246IGFic29sdXRlICFpbXBvcnRhbnQ7IGxlZnQ6IC0xMDAwMHB4ICFpbXBvcnRhbnQ7IHRvcDogLTEwMDBweCAhaW1wb3J0YW50OydcblxuXHRcdGlmKGJhaXQgPT0gbnVsbCB8fCB0eXBlb2YoYmFpdCkgPT0gJ3N0cmluZycpe1xuXHRcdFx0bG9nKCdpbnZhbGlkIGJhaXQgYmVpbmcgY2FzdCcpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdGlmKGJhaXQuc3R5bGUgIT0gbnVsbCl7XG5cdFx0XHRiYWl0U3R5bGUgKz0gYmFpdC5zdHlsZTtcblx0XHR9XG5cblx0XHRiYWl0Tm9kZSA9IG1ha2VFbCgnZGl2Jywge1xuXHRcdFx0J2NsYXNzJzogYmFpdC5jc3NDbGFzcyxcblx0XHRcdCdzdHlsZSc6IGJhaXRTdHlsZVxuXHRcdH0pO1xuXG5cdFx0bG9nKCdhZGRpbmcgYmFpdCBub2RlIHRvIERPTScpO1xuXG5cdFx0Yi5hcHBlbmRDaGlsZChiYWl0Tm9kZSk7XG5cblx0XHQvLyB0b3VjaCB0aGVzZSBwcm9wZXJ0aWVzXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy5udWxsUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHR0ID0gYmFpdE5vZGVbYmFpdFRyaWdnZXJzLm51bGxQcm9wc1tpXV07XG5cdFx0fVxuXHRcdGZvcihpPTA7aTxiYWl0VHJpZ2dlcnMuemVyb1Byb3BzLmxlbmd0aDtpKyspe1xuXHRcdFx0dCA9IGJhaXROb2RlW2JhaXRUcmlnZ2Vycy56ZXJvUHJvcHNbaV1dO1xuXHRcdH1cblx0fVxuXG5cdC8qKlxuXHQqIFJ1biB0ZXN0cyB0byBzZWUgaWYgYnJvd3NlciBoYXMgdGFrZW4gdGhlIGJhaXQgYW5kIGJsb2NrZWQgdGhlIGJhaXQgZWxlbWVudFxuXHQqL1xuXHRmdW5jdGlvbiByZWVsSW4oYmFpdCwgYXR0ZW1wdE51bSl7XG5cdFx0dmFyIGksIGssIHY7XG5cdFx0dmFyIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuXHRcdHZhciBmb3VuZCA9IGZhbHNlO1xuXG5cdFx0aWYoYmFpdE5vZGUgPT0gbnVsbCl7XG5cdFx0XHRsb2coJ3JlY2FzdCBiYWl0Jyk7XG5cdFx0XHRjYXN0QmFpdChiYWl0IHx8IHF1aWNrQmFpdCk7XG5cdFx0fVxuXG5cdFx0aWYodHlwZW9mKGJhaXQpID09ICdzdHJpbmcnKXtcblx0XHRcdGxvZygnaW52YWxpZCBiYWl0IHVzZWQnLCB0cnVlKTtcblx0XHRcdGlmKGNsZWFyQmFpdE5vZGUoKSl7XG5cdFx0XHRcdHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cdFx0XHRcdH0sIDUpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0aWYodGltZXJJZHMudGVzdCA+IDApe1xuXHRcdFx0Y2xlYXJUaW1lb3V0KHRpbWVySWRzLnRlc3QpO1xuXHRcdFx0dGltZXJJZHMudGVzdCA9IDA7XG5cdFx0fVxuXG5cdFx0Ly8gdGVzdCBmb3IgaXNzdWVzXG5cblx0XHRpZihib2R5LmdldEF0dHJpYnV0ZSgnYWJwJykgIT09IG51bGwpe1xuXHRcdFx0bG9nKCdmb3VuZCBhZGJsb2NrIGJvZHkgYXR0cmlidXRlJyk7XG5cdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0fVxuXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy5udWxsUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHRpZihiYWl0Tm9kZVtiYWl0VHJpZ2dlcnMubnVsbFByb3BzW2ldXSA9PSBudWxsKXtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayBudWxsIGF0dHI6ICcgKyBiYWl0VHJpZ2dlcnMubnVsbFByb3BzW2ldKTtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0XHRpZihmb3VuZCA9PSB0cnVlKXtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHRpZihmb3VuZCA9PSB0cnVlKXtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0XHRpZihiYWl0Tm9kZVtiYWl0VHJpZ2dlcnMuemVyb1Byb3BzW2ldXSA9PSAwKXtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayB6ZXJvIGF0dHI6ICcgKyBiYWl0VHJpZ2dlcnMuemVyb1Byb3BzW2ldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRpZih3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHR2YXIgYmFpdFRlbXAgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShiYWl0Tm9kZSwgbnVsbCk7XG5cdFx0XHRpZihiYWl0VGVtcC5nZXRQcm9wZXJ0eVZhbHVlKCdkaXNwbGF5JykgPT0gJ25vbmUnXG5cdFx0XHR8fCBiYWl0VGVtcC5nZXRQcm9wZXJ0eVZhbHVlKCd2aXNpYmlsaXR5JykgPT0gJ2hpZGRlbicpIHtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayBjb21wdXRlZFN0eWxlIGluZGljYXRvcicpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHRlc3RlZE9uY2UgPSB0cnVlO1xuXG5cdFx0aWYoZm91bmQgfHwgYXR0ZW1wdE51bSsrID49IF9vcHRpb25zLm1heExvb3Ape1xuXHRcdFx0ZmluZFJlc3VsdCA9IGZvdW5kO1xuXHRcdFx0bG9nKCdleGl0aW5nIHRlc3QgbG9vcCAtIHZhbHVlOiAnICsgZmluZFJlc3VsdCk7XG5cdFx0XHRub3RpZnlMaXN0ZW5lcnMoKTtcblx0XHRcdGlmKGNsZWFyQmFpdE5vZGUoKSl7XG5cdFx0XHRcdHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cdFx0XHRcdH0sIDUpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRlbHNle1xuXHRcdFx0dGltZXJJZHMudGVzdCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0cmVlbEluKGJhaXQsIGF0dGVtcHROdW0pO1xuXHRcdFx0fSwgX29wdGlvbnMubG9vcERlbGF5KTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckJhaXROb2RlKCl7XG5cdFx0aWYoYmFpdE5vZGUgPT09IG51bGwpe1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0dHJ5e1xuXHRcdFx0aWYoaXNGdW5jKGJhaXROb2RlLnJlbW92ZSkpe1xuXHRcdFx0XHRiYWl0Tm9kZS5yZW1vdmUoKTtcblx0XHRcdH1cblx0XHRcdGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYmFpdE5vZGUpO1xuXHRcdH1cblx0XHRjYXRjaChleCl7XG5cdFx0fVxuXHRcdGJhaXROb2RlID0gbnVsbDtcblxuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cblx0LyoqXG5cdCogSGFsdCB0aGUgdGVzdCBhbmQgYW55IHBlbmRpbmcgdGltZW91dHNcblx0Ki9cblx0ZnVuY3Rpb24gc3RvcEZpc2hpbmcoKXtcblx0XHRpZih0aW1lcklkcy50ZXN0ID4gMCl7XG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXJJZHMudGVzdCk7XG5cdFx0fVxuXHRcdGlmKHRpbWVySWRzLmRvd25sb2FkID4gMCl7XG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXJJZHMuZG93bmxvYWQpO1xuXHRcdH1cblxuXHRcdGNhbmNlbFJlbW90ZURvd25sb2FkcygpO1xuXG5cdFx0Y2xlYXJCYWl0Tm9kZSgpO1xuXHR9XG5cblx0LyoqXG5cdCogRmlyZSBhbGwgcmVnaXN0ZXJlZCBsaXN0ZW5lcnNcblx0Ki9cblx0ZnVuY3Rpb24gbm90aWZ5TGlzdGVuZXJzKCl7XG5cdFx0dmFyIGksIGZ1bmNzO1xuXHRcdGlmKGZpbmRSZXN1bHQgPT09IG51bGwpe1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRmb3IoaT0wO2k8bGlzdGVuZXJzLmxlbmd0aDtpKyspe1xuXHRcdFx0ZnVuY3MgPSBsaXN0ZW5lcnNbaV07XG5cdFx0XHR0cnl7XG5cdFx0XHRcdGlmKGZ1bmNzICE9IG51bGwpe1xuXHRcdFx0XHRcdGlmKGlzRnVuYyhmdW5jc1snY29tcGxldGUnXSkpe1xuXHRcdFx0XHRcdFx0ZnVuY3NbJ2NvbXBsZXRlJ10oZmluZFJlc3VsdCk7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0aWYoZmluZFJlc3VsdCAmJiBpc0Z1bmMoZnVuY3NbJ2ZvdW5kJ10pKXtcblx0XHRcdFx0XHRcdGZ1bmNzWydmb3VuZCddKCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGVsc2UgaWYoZmluZFJlc3VsdCA9PT0gZmFsc2UgJiYgaXNGdW5jKGZ1bmNzWydub3Rmb3VuZCddKSl7XG5cdFx0XHRcdFx0XHRmdW5jc1snbm90Zm91bmQnXSgpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0Y2F0Y2goZXgpe1xuXHRcdFx0XHRsb2coJ0ZhaWx1cmUgaW4gbm90aWZ5IGxpc3RlbmVycyAnICsgZXguTWVzc2FnZSwgdHJ1ZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0LyoqXG5cdCogQXR0YWNoZXMgZXZlbnQgbGlzdGVuZXIgb3IgZmlyZXMgaWYgZXZlbnRzIGhhdmUgYWxyZWFkeSBwYXNzZWQuXG5cdCovXG5cdGZ1bmN0aW9uIGF0dGFjaE9yRmlyZSgpe1xuXHRcdHZhciBmaXJlTm93ID0gZmFsc2U7XG5cdFx0dmFyIGZuO1xuXG5cdFx0aWYoZG9jdW1lbnQucmVhZHlTdGF0ZSl7XG5cdFx0XHRpZihkb2N1bWVudC5yZWFkeVN0YXRlID09ICdjb21wbGV0ZScpe1xuXHRcdFx0XHRmaXJlTm93ID0gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmbiA9IGZ1bmN0aW9uKCl7XG5cdFx0XHRiZWdpblRlc3QocXVpY2tCYWl0LCBmYWxzZSk7XG5cdFx0fVxuXG5cdFx0aWYoZmlyZU5vdyl7XG5cdFx0XHRmbigpO1xuXHRcdH1cblx0XHRlbHNle1xuXHRcdFx0YXR0YWNoRXZlbnRMaXN0ZW5lcih3aW4sICdsb2FkJywgZm4pO1xuXHRcdH1cblx0fVxuXG5cblx0dmFyIGJsb2NrTGlzdHM7IC8vIHRyYWNrcyBleHRlcm5hbCBibG9jayBsaXN0c1xuXG5cdC8qKlxuXHQqIFB1YmxpYyBpbnRlcmZhY2Ugb2YgYWRibG9jayBkZXRlY3RvclxuXHQqL1xuXHR2YXIgaW1wbCA9IHtcblx0XHQvKipcblx0XHQqIFZlcnNpb24gb2YgdGhlIGFkYmxvY2sgZGV0ZWN0b3IgcGFja2FnZVxuXHRcdCovXG5cdFx0dmVyc2lvbjogdmVyc2lvbixcblxuXHRcdC8qKlxuXHRcdCogSW5pdGlhbGl6YXRpb24gZnVuY3Rpb24uIFNlZSBjb21tZW50cyBhdCB0b3AgZm9yIG9wdGlvbnMgb2JqZWN0XG5cdFx0Ki9cblx0XHRpbml0OiBmdW5jdGlvbihvcHRpb25zKXtcblx0XHRcdHZhciBrLCB2LCBmdW5jcztcblxuXHRcdFx0aWYoIW9wdGlvbnMpe1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGZ1bmNzID0ge1xuXHRcdFx0XHRjb21wbGV0ZTogbm9vcCxcblx0XHRcdFx0Zm91bmQ6IG5vb3AsXG5cdFx0XHRcdG5vdGZvdW5kOiBub29wXG5cdFx0XHR9O1xuXG5cdFx0XHRmb3IoayBpbiBvcHRpb25zKXtcblx0XHRcdFx0aWYob3B0aW9ucy5oYXNPd25Qcm9wZXJ0eShrKSl7XG5cdFx0XHRcdFx0aWYoayA9PSAnY29tcGxldGUnIHx8IGsgPT0gJ2ZvdW5kJyB8fCBrID09ICdub3RGb3VuZCcpe1xuXHRcdFx0XHRcdFx0ZnVuY3Nbay50b0xvd2VyQ2FzZSgpXSA9IG9wdGlvbnNba107XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGVsc2V7XG5cdFx0XHRcdFx0XHRfb3B0aW9uc1trXSA9IG9wdGlvbnNba107XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGxpc3RlbmVycy5wdXNoKGZ1bmNzKTtcblxuXHRcdFx0YmxvY2tMaXN0cyA9IG5ldyBCbG9ja0xpc3RUcmFja2VyKCk7XG5cblx0XHRcdGF0dGFjaE9yRmlyZSgpO1xuXHRcdH1cblx0fVxuXG5cdHdpblsnYWRibG9ja0RldGVjdG9yJ10gPSBpbXBsO1xuXG59KSh3aW5kb3cpXG4iLCIvKiFcbiAqIEBwcmVzZXJ2ZVxuICoganF1ZXJ5LnNjcm9sbGRlcHRoLmpzIHwgdjEuMFxuICogQ29weXJpZ2h0IChjKSAyMDE2IFJvYiBGbGFoZXJ0eSAoQHJvYmZsYWhlcnR5KVxuICogTGljZW5zZWQgdW5kZXIgdGhlIE1JVCBhbmQgR1BMIGxpY2Vuc2VzLlxuICovXG4hZnVuY3Rpb24oZSl7XCJmdW5jdGlvblwiPT10eXBlb2YgZGVmaW5lJiZkZWZpbmUuYW1kP2RlZmluZShbXCJqcXVlcnlcIl0sZSk6XCJvYmplY3RcIj09dHlwZW9mIG1vZHVsZSYmbW9kdWxlLmV4cG9ydHM/bW9kdWxlLmV4cG9ydHM9ZShyZXF1aXJlKFwianF1ZXJ5XCIpKTplKGpRdWVyeSl9KGZ1bmN0aW9uKGUpe1widXNlIHN0cmljdFwiO3ZhciBuLHQscixvLGk9e21pbkhlaWdodDowLGVsZW1lbnRzOltdLHBlcmNlbnRhZ2U6ITAsdXNlclRpbWluZzohMCxwaXhlbERlcHRoOiEwLG5vbkludGVyYWN0aW9uOiEwLGdhR2xvYmFsOiExLGd0bU92ZXJyaWRlOiExLHRyYWNrZXJOYW1lOiExLGRhdGFMYXllcjpcImRhdGFMYXllclwifSxhPWUod2luZG93KSxsPVtdLGM9ITEsdT0wO3JldHVybiBlLnNjcm9sbERlcHRoPWZ1bmN0aW9uKHApe2Z1bmN0aW9uIHMoZSxpLGEsbCl7dmFyIGM9cC50cmFja2VyTmFtZT9wLnRyYWNrZXJOYW1lK1wiLnNlbmRcIjpcInNlbmRcIjtvPyhvKHtldmVudDpcIlNjcm9sbERpc3RhbmNlXCIsZXZlbnRDYXRlZ29yeTpcIlNjcm9sbCBEZXB0aFwiLGV2ZW50QWN0aW9uOmUsZXZlbnRMYWJlbDppLGV2ZW50VmFsdWU6MSxldmVudE5vbkludGVyYWN0aW9uOnAubm9uSW50ZXJhY3Rpb259KSxwLnBpeGVsRGVwdGgmJmFyZ3VtZW50cy5sZW5ndGg+MiYmYT51JiYodT1hLG8oe2V2ZW50OlwiU2Nyb2xsRGlzdGFuY2VcIixldmVudENhdGVnb3J5OlwiU2Nyb2xsIERlcHRoXCIsZXZlbnRBY3Rpb246XCJQaXhlbCBEZXB0aFwiLGV2ZW50TGFiZWw6ZChhKSxldmVudFZhbHVlOjEsZXZlbnROb25JbnRlcmFjdGlvbjpwLm5vbkludGVyYWN0aW9ufSkpLHAudXNlclRpbWluZyYmYXJndW1lbnRzLmxlbmd0aD4zJiZvKHtldmVudDpcIlNjcm9sbFRpbWluZ1wiLGV2ZW50Q2F0ZWdvcnk6XCJTY3JvbGwgRGVwdGhcIixldmVudEFjdGlvbjplLGV2ZW50TGFiZWw6aSxldmVudFRpbWluZzpsfSkpOihuJiYod2luZG93W3JdKGMsXCJldmVudFwiLFwiU2Nyb2xsIERlcHRoXCIsZSxpLDEse25vbkludGVyYWN0aW9uOnAubm9uSW50ZXJhY3Rpb259KSxwLnBpeGVsRGVwdGgmJmFyZ3VtZW50cy5sZW5ndGg+MiYmYT51JiYodT1hLHdpbmRvd1tyXShjLFwiZXZlbnRcIixcIlNjcm9sbCBEZXB0aFwiLFwiUGl4ZWwgRGVwdGhcIixkKGEpLDEse25vbkludGVyYWN0aW9uOnAubm9uSW50ZXJhY3Rpb259KSkscC51c2VyVGltaW5nJiZhcmd1bWVudHMubGVuZ3RoPjMmJndpbmRvd1tyXShjLFwidGltaW5nXCIsXCJTY3JvbGwgRGVwdGhcIixlLGwsaSkpLHQmJihfZ2FxLnB1c2goW1wiX3RyYWNrRXZlbnRcIixcIlNjcm9sbCBEZXB0aFwiLGUsaSwxLHAubm9uSW50ZXJhY3Rpb25dKSxwLnBpeGVsRGVwdGgmJmFyZ3VtZW50cy5sZW5ndGg+MiYmYT51JiYodT1hLF9nYXEucHVzaChbXCJfdHJhY2tFdmVudFwiLFwiU2Nyb2xsIERlcHRoXCIsXCJQaXhlbCBEZXB0aFwiLGQoYSksMSxwLm5vbkludGVyYWN0aW9uXSkpLHAudXNlclRpbWluZyYmYXJndW1lbnRzLmxlbmd0aD4zJiZfZ2FxLnB1c2goW1wiX3RyYWNrVGltaW5nXCIsXCJTY3JvbGwgRGVwdGhcIixlLGwsaSwxMDBdKSkpfWZ1bmN0aW9uIGgoZSl7cmV0dXJue1wiMjUlXCI6cGFyc2VJbnQoLjI1KmUsMTApLFwiNTAlXCI6cGFyc2VJbnQoLjUqZSwxMCksXCI3NSVcIjpwYXJzZUludCguNzUqZSwxMCksXCIxMDAlXCI6ZS01fX1mdW5jdGlvbiBnKG4sdCxyKXtlLmVhY2gobixmdW5jdGlvbihuLG8pey0xPT09ZS5pbkFycmF5KG4sbCkmJnQ+PW8mJihzKFwiUGVyY2VudGFnZVwiLG4sdCxyKSxsLnB1c2gobikpfSl9ZnVuY3Rpb24gZihuLHQscil7ZS5lYWNoKG4sZnVuY3Rpb24obixvKXstMT09PWUuaW5BcnJheShvLGwpJiZlKG8pLmxlbmd0aCYmdD49ZShvKS5vZmZzZXQoKS50b3AmJihzKFwiRWxlbWVudHNcIixvLHQsciksbC5wdXNoKG8pKX0pfWZ1bmN0aW9uIGQoZSl7cmV0dXJuKDI1MCpNYXRoLmZsb29yKGUvMjUwKSkudG9TdHJpbmcoKX1mdW5jdGlvbiBtKCl7eSgpfWZ1bmN0aW9uIHYoZSxuKXt2YXIgdCxyLG8saT1udWxsLGE9MCxsPWZ1bmN0aW9uKCl7YT1uZXcgRGF0ZSxpPW51bGwsbz1lLmFwcGx5KHQscil9O3JldHVybiBmdW5jdGlvbigpe3ZhciBjPW5ldyBEYXRlO2F8fChhPWMpO3ZhciB1PW4tKGMtYSk7cmV0dXJuIHQ9dGhpcyxyPWFyZ3VtZW50cywwPj11PyhjbGVhclRpbWVvdXQoaSksaT1udWxsLGE9YyxvPWUuYXBwbHkodCxyKSk6aXx8KGk9c2V0VGltZW91dChsLHUpKSxvfX1mdW5jdGlvbiB5KCl7Yz0hMCxhLm9uKFwic2Nyb2xsLnNjcm9sbERlcHRoXCIsdihmdW5jdGlvbigpe3ZhciBuPWUoZG9jdW1lbnQpLmhlaWdodCgpLHQ9d2luZG93LmlubmVySGVpZ2h0P3dpbmRvdy5pbm5lckhlaWdodDphLmhlaWdodCgpLHI9YS5zY3JvbGxUb3AoKSt0LG89aChuKSxpPStuZXcgRGF0ZS1EO3JldHVybiBsLmxlbmd0aD49cC5lbGVtZW50cy5sZW5ndGgrKHAucGVyY2VudGFnZT80OjApPyhhLm9mZihcInNjcm9sbC5zY3JvbGxEZXB0aFwiKSx2b2lkKGM9ITEpKToocC5lbGVtZW50cyYmZihwLmVsZW1lbnRzLHIsaSksdm9pZChwLnBlcmNlbnRhZ2UmJmcobyxyLGkpKSl9LDUwMCkpfXZhciBEPStuZXcgRGF0ZTtwPWUuZXh0ZW5kKHt9LGkscCksZShkb2N1bWVudCkuaGVpZ2h0KCk8cC5taW5IZWlnaHR8fChwLmdhR2xvYmFsPyhuPSEwLHI9cC5nYUdsb2JhbCk6XCJmdW5jdGlvblwiPT10eXBlb2YgZ2E/KG49ITAscj1cImdhXCIpOlwiZnVuY3Rpb25cIj09dHlwZW9mIF9fZ2FUcmFja2VyJiYobj0hMCxyPVwiX19nYVRyYWNrZXJcIiksXCJ1bmRlZmluZWRcIiE9dHlwZW9mIF9nYXEmJlwiZnVuY3Rpb25cIj09dHlwZW9mIF9nYXEucHVzaCYmKHQ9ITApLFwiZnVuY3Rpb25cIj09dHlwZW9mIHAuZXZlbnRIYW5kbGVyP289cC5ldmVudEhhbmRsZXI6XCJ1bmRlZmluZWRcIj09dHlwZW9mIHdpbmRvd1twLmRhdGFMYXllcl18fFwiZnVuY3Rpb25cIiE9dHlwZW9mIHdpbmRvd1twLmRhdGFMYXllcl0ucHVzaHx8cC5ndG1PdmVycmlkZXx8KG89ZnVuY3Rpb24oZSl7d2luZG93W3AuZGF0YUxheWVyXS5wdXNoKGUpfSksZS5zY3JvbGxEZXB0aC5yZXNldD1mdW5jdGlvbigpe2w9W10sdT0wLGEub2ZmKFwic2Nyb2xsLnNjcm9sbERlcHRoXCIpLHkoKX0sZS5zY3JvbGxEZXB0aC5hZGRFbGVtZW50cz1mdW5jdGlvbihuKXtcInVuZGVmaW5lZFwiIT10eXBlb2YgbiYmZS5pc0FycmF5KG4pJiYoZS5tZXJnZShwLmVsZW1lbnRzLG4pLGN8fHkoKSl9LGUuc2Nyb2xsRGVwdGgucmVtb3ZlRWxlbWVudHM9ZnVuY3Rpb24obil7XCJ1bmRlZmluZWRcIiE9dHlwZW9mIG4mJmUuaXNBcnJheShuKSYmZS5lYWNoKG4sZnVuY3Rpb24obix0KXt2YXIgcj1lLmluQXJyYXkodCxwLmVsZW1lbnRzKSxvPWUuaW5BcnJheSh0LGwpOy0xIT1yJiZwLmVsZW1lbnRzLnNwbGljZShyLDEpLC0xIT1vJiZsLnNwbGljZShvLDEpfSl9LG0oKSl9LGUuc2Nyb2xsRGVwdGh9KTtcbiIsIiggZnVuY3Rpb24oICQgKSB7XG5cblx0Lypcblx0ICogQ3JlYXRlIGEgR29vZ2xlIEFuYWx5dGljcyBldmVudFxuXHQgKiBjYXRlZ29yeTogRXZlbnQgQ2F0ZWdvcnlcblx0ICogbGFiZWw6IEV2ZW50IExhYmVsXG5cdCAqIGFjdGlvbjogRXZlbnQgQWN0aW9uXG5cdCAqIHZhbHVlOiBvcHRpb25hbFxuXHQqL1xuXHRmdW5jdGlvbiB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoIHR5cGUsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsLCB2YWx1ZSApIHtcblx0XHRpZiAoIHR5cGVvZiBnYSAhPT0gJ3VuZGVmaW5lZCcgKSB7XG5cdFx0XHRpZiAoIHR5cGVvZiB2YWx1ZSA9PT0gJ3VuZGVmaW5lZCcgKSB7XG5cdFx0XHRcdGdhKCAnc2VuZCcsIHR5cGUsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnYSggJ3NlbmQnLCB0eXBlLCBjYXRlZ29yeSwgYWN0aW9uLCBsYWJlbCwgdmFsdWUgKTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0fVxuXG5cdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MgKSB7XG5cblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbCAmJiB0cnVlID09PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsLmVuYWJsZWQgKSB7XG5cdFx0XHQkLnNjcm9sbERlcHRoKHtcblx0XHRcdCAgbWluSGVpZ2h0OiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsLm1pbmltdW1faGVpZ2h0LFxuXHRcdFx0ICBlbGVtZW50czogYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbC5zY3JvbGxfZWxlbWVudHMuc3BsaXQoJywgJyksXG5cdFx0XHQgIHBlcmNlbnRhZ2U6IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zY3JvbGwucGVyY2VudGFnZSxcblx0XHRcdCAgdXNlclRpbWluZzogYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbC51c2VyX3RpbWluZyxcblx0XHRcdCAgcGl4ZWxEZXB0aDogYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbC5waXhlbF9kZXB0aCxcblx0XHRcdCAgbm9uSW50ZXJhY3Rpb246IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zY3JvbGwubm9uX2ludGVyYWN0aW9uXG5cdFx0XHR9KTtcblx0XHR9XG5cblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNwZWNpYWwgJiYgdHJ1ZSA9PT0gYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNwZWNpYWwuZW5hYmxlZCApIHtcblxuXHRcdFx0Ly8gZXh0ZXJuYWwgbGlua3Ncblx0XHRcdCQoICdhW2hyZWZePVwiaHR0cFwiXTpub3QoW2hyZWYqPVwiOi8vJyArIGRvY3VtZW50LmRvbWFpbiArICdcIl0pJyApLmNsaWNrKCBmdW5jdGlvbigpIHtcblx0XHRcdCAgICB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdPdXRib3VuZCBsaW5rcycsICdDbGljaycsIHRoaXMuaHJlZiApO1xuXHRcdFx0fSk7XG5cblx0XHRcdC8vIG1haWx0byBsaW5rc1xuXHRcdFx0JCggJ2FbaHJlZl49XCJtYWlsdG9cIl0nICkuY2xpY2soIGZ1bmN0aW9uKCkge1xuXHRcdFx0ICAgIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ01haWxzJywgJ0NsaWNrJywgdGhpcy5ocmVmLnN1YnN0cmluZyggNyApICk7XG5cdFx0XHR9KTtcblxuXHRcdFx0Ly8gdGVsIGxpbmtzXG5cdFx0XHQkKCAnYVtocmVmXj1cInRlbFwiXScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cdFx0XHQgICAgd3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnVGVsZXBob25lJywgJ0NhbGwnLCB0aGlzLmhyZWYuc3Vic3RyaW5nKCA3ICkgKTtcblx0XHRcdH0pO1xuXG5cdFx0XHQvLyBpbnRlcm5hbCBsaW5rc1xuXHRcdFx0JCggJ2E6bm90KFtocmVmXj1cIihodHRwOnxodHRwczopPy8vXCJdLFtocmVmXj1cIiNcIl0sW2hyZWZePVwibWFpbHRvOlwiXSknICkuY2xpY2soIGZ1bmN0aW9uKCkge1xuXG5cdFx0XHRcdC8vIHRyYWNrIGRvd25sb2Fkc1xuXHRcdFx0XHRpZiAoICcnICE9PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc3BlY2lhbC5kb3dubG9hZF9yZWdleCApIHtcblx0XHRcdFx0XHR2YXIgdXJsID0gdGhpcy5ocmVmO1xuXHRcdFx0XHRcdHZhciBjaGVja0Rvd25sb2FkID0gbmV3IFJlZ0V4cCggXCJcXFxcLihcIiArIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zcGVjaWFsLmRvd25sb2FkX3JlZ2V4ICsgXCIpKFtcXD8jXS4qKT8kXCIsIFwiaVwiICk7XG5cdFx0XHRcdFx0dmFyIGlzRG93bmxvYWQgPSBjaGVja0Rvd25sb2FkLnRlc3QoIHVybCApO1xuXHRcdFx0XHRcdGlmICggdHJ1ZSA9PT0gaXNEb3dubG9hZCApIHtcblx0XHRcdFx0XHRcdHZhciBjaGVja0Rvd25sb2FkRXh0ZW5zaW9uID0gbmV3IFJlZ0V4cChcIlxcXFwuKFwiICsgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNwZWNpYWwuZG93bmxvYWRfcmVnZXggKyBcIikoW1xcPyNdLiopPyRcIiwgXCJpXCIpO1xuXHRcdFx0XHRcdFx0dmFyIGV4dGVuc2lvblJlc3VsdCA9IGNoZWNrRG93bmxvYWRFeHRlbnNpb24uZXhlYyggdXJsICk7XG5cdFx0XHRcdFx0XHR2YXIgZXh0ZW5zaW9uID0gJyc7XG5cdFx0XHRcdFx0XHRpZiAoIG51bGwgIT09IGV4dGVuc2lvblJlc3VsdCApIHtcblx0XHRcdFx0XHRcdFx0ZXh0ZW5zaW9uID0gZXh0ZW5zaW9uUmVzdWx0WzFdO1xuXHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0ZXh0ZW5zaW9uID0gZXh0ZW5zaW9uUmVzdWx0O1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0Ly8gd2UgY2FuJ3QgdXNlIHRoZSB1cmwgZm9yIHRoZSB2YWx1ZSBoZXJlLCBldmVuIHRob3VnaCB0aGF0IHdvdWxkIGJlIG5pY2UsIGJlY2F1c2UgdmFsdWUgaXMgc3VwcG9zZWQgdG8gYmUgYW4gaW50ZWdlclxuXHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnRG93bmxvYWRzJywgZXh0ZW5zaW9uLCB0aGlzLmhyZWYgKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0fSk7XG5cblx0XHR9XG5cblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmFmZmlsaWF0ZSAmJiB0cnVlID09PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlLmVuYWJsZWQgKSB7XG5cdFx0XHQvLyBhbnkgbGluayBjb3VsZCBiZSBhbiBhZmZpbGlhdGUsIGkgZ3Vlc3M/XG5cdFx0XHQkKCAnYScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cblx0XHRcdFx0Ly8gdHJhY2sgYWZmaWxpYXRlc1xuXHRcdFx0XHRpZiAoICcnICE9PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlLmFmZmlsaWF0ZV9yZWdleCApIHtcblx0XHRcdFx0XHR2YXIgY2hlY2tBZmZpbGlhdGUgPSBuZXcgUmVnRXhwKCBcIlxcXFwuKFwiICsgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmFmZmlsaWF0ZS5hZmZpbGlhdGVfcmVnZXggKyBcIikoW1xcPyNdLiopPyRcIiwgXCJpXCIgKTtcblx0XHRcdFx0XHR2YXIgaXNBZmZpbGlhdGUgPSBjaGVja0FmZmlsaWF0ZS50ZXN0KCB1cmwgKTtcblx0XHRcdFx0XHRpZiAoIHRydWUgPT09IGlzQWZmaWxpYXRlICkge1xuXHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnQWZmaWxpYXRlJywgJ0NsaWNrJywgdGhpcy5ocmVmICk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdC8vIGxpbmsgZnJhZ21lbnRzIGFzIHBhZ2V2aWV3c1xuXHRcdC8vIGRvZXMgbm90IHVzZSB0aGUgZXZlbnQgdHJhY2tpbmcgbWV0aG9kXG5cdFx0aWYgKCAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5mcmFnbWVudCAmJiB0cnVlID09PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuZnJhZ21lbnQuZW5hYmxlZCApIHtcblx0XHRcdGlmICggdHlwZW9mIGdhICE9PSAndW5kZWZpbmVkJyApIHtcblx0XHRcdFx0d2luZG93Lm9uaGFzaGNoYW5nZSA9IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdGdhKCAnc2VuZCcsICdwYWdldmlldycsIGxvY2F0aW9uLnBhdGhuYW1lICsgbG9jYXRpb24uc2VhcmNoICsgbG9jYXRpb24uaGFzaCApO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Ly8gYmFzaWMgZm9ybSBzdWJtaXRzXG5cdFx0aWYgKCAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5mb3JtX3N1Ym1pc3Npb25zICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5mb3JtX3N1Ym1pc3Npb25zLmVuYWJsZWQgKSB7XG5cdFx0XHQkKCAnaW5wdXRbdHlwZT1cInN1Ym1pdFwiXSwgYnV0dG9uW3R5cGU9XCJzdWJtaXRcIl0nICkuY2xpY2soIGZ1bmN0aW9uKCBmICkge1xuXHQgICAgICAgICAgICB2YXIgY2F0ZWdvcnkgPSAkKCB0aGlzICkuZGF0YSggJ2dhLWNhdGVnb3J5JyApIHx8ICdGb3JtJztcblx0ICAgICAgICAgICAgdmFyIGFjdGlvbiA9ICQoIHRoaXMgKS5kYXRhKCAnZ2EtYWN0aW9uJyApIHx8ICdTdWJtaXQnO1xuXHQgICAgICAgICAgICB2YXIgbGFiZWwgPSAkKCB0aGlzICkuZGF0YSggJ2dhLWxhYmVsJyApIHx8IHRoaXMubmFtZSB8fCB0aGlzLnZhbHVlO1xuXHQgICAgICAgICAgICB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsICk7XG5cdCAgICAgICAgfSk7XG5cdFx0fVxuXG5cdH1cblxuXHQkKCBkb2N1bWVudCApLnJlYWR5KCBmdW5jdGlvbigpIHtcblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnRyYWNrX2FkYmxvY2tlciAmJiB0cnVlID09PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MudHJhY2tfYWRibG9ja2VyLmVuYWJsZWQgKSB7XG5cdFx0XHRpZiAoIHR5cGVvZiB3aW5kb3cuYWRibG9ja0RldGVjdG9yID09PSAndW5kZWZpbmVkJyApIHtcblx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnQWRibG9jaycsICdPbicsIHsgJ25vbkludGVyYWN0aW9uJzogMSB9ICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHR3aW5kb3cuYWRibG9ja0RldGVjdG9yLmluaXQoXG5cdFx0XHRcdFx0e1xuXHRcdFx0XHRcdFx0ZGVidWc6IGZhbHNlLFxuXHRcdFx0XHRcdFx0Zm91bmQ6IGZ1bmN0aW9uKCkge1xuXHRcdFx0XHRcdFx0XHR3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdBZGJsb2NrJywgJ09uJywgeyAnbm9uSW50ZXJhY3Rpb24nOiAxIH0gKTtcblx0XHRcdFx0XHRcdH0sXG5cdFx0XHRcdFx0XHRub3RGb3VuZDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRcdHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ0FkYmxvY2snLCAnT2ZmJywgeyAnbm9uSW50ZXJhY3Rpb24nOiAxIH0gKTtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHR9XG5cdFx0XHRcdCk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9KTtcblxufSApKCBqUXVlcnkgKTtcbiJdfQ==
