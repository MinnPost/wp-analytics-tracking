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

(function () {
  var g,
      aa = "function" == typeof Object.defineProperties ? Object.defineProperty : function (a, b, c) {
    if (c.get || c.set) throw new TypeError("ES3 does not support getters and setters.");
    a != Array.prototype && a != Object.prototype && (a[b] = c.value);
  },
      k = "undefined" != typeof window && window === this ? this : "undefined" != typeof global && null != global ? global : this;

  function l() {
    l = function l() {};

    k.Symbol || (k.Symbol = ba);
  }

  var ca = 0;

  function ba(a) {
    return "jscomp_symbol_" + (a || "") + ca++;
  }

  function m() {
    l();
    var a = k.Symbol.iterator;
    a || (a = k.Symbol.iterator = k.Symbol("iterator"));
    "function" != typeof Array.prototype[a] && aa(Array.prototype, a, {
      configurable: !0,
      writable: !0,
      value: function value() {
        return da(this);
      }
    });

    m = function m() {};
  }

  function da(a) {
    var b = 0;
    return ea(function () {
      return b < a.length ? {
        done: !1,
        value: a[b++]
      } : {
        done: !0
      };
    });
  }

  function ea(a) {
    m();
    a = {
      next: a
    };

    a[k.Symbol.iterator] = function () {
      return this;
    };

    return a;
  }

  function fa(a) {
    m();
    l();
    m();
    var b = a[Symbol.iterator];
    return b ? b.call(a) : da(a);
  }

  function n(a) {
    if (!(a instanceof Array)) {
      a = fa(a);

      for (var b, c = []; !(b = a.next()).done;) {
        c.push(b.value);
      }

      a = c;
    }

    return a;
  }

  function ha(a, b) {
    function c() {}

    c.prototype = b.prototype;
    a.ha = b.prototype;
    a.prototype = new c();
    a.prototype.constructor = a;

    for (var d in b) {
      if (Object.defineProperties) {
        var e = Object.getOwnPropertyDescriptor(b, d);
        e && Object.defineProperty(a, d, e);
      } else a[d] = b[d];
    }
  }

  var p = window.Element.prototype,
      ia = p.matches || p.matchesSelector || p.webkitMatchesSelector || p.mozMatchesSelector || p.msMatchesSelector || p.oMatchesSelector;

  function ja(a, b) {
    if (a && 1 == a.nodeType && b) {
      if ("string" == typeof b || 1 == b.nodeType) return a == b || ka(a, b);
      if ("length" in b) for (var c = 0, d; d = b[c]; c++) {
        if (a == d || ka(a, d)) return !0;
      }
    }

    return !1;
  }

  function ka(a, b) {
    if ("string" != typeof b) return !1;
    if (ia) return ia.call(a, b);
    b = a.parentNode.querySelectorAll(b);

    for (var c = 0, d; d = b[c]; c++) {
      if (d == a) return !0;
    }

    return !1;
  }

  function la(a) {
    for (var b = []; a && a.parentNode && 1 == a.parentNode.nodeType;) {
      a = a.parentNode, b.push(a);
    }

    return b;
  }

  function q(a, b, c) {
    function d(a) {
      var d;
      if (h.composed && "function" == typeof a.composedPath) for (var e = a.composedPath(), f = 0, F; F = e[f]; f++) {
        1 == F.nodeType && ja(F, b) && (d = F);
      } else a: {
        if ((d = a.target) && 1 == d.nodeType && b) for (d = [d].concat(la(d)), e = 0; f = d[e]; e++) {
          if (ja(f, b)) {
            d = f;
            break a;
          }
        }
        d = void 0;
      }
      d && c.call(d, a, d);
    }

    var e = document,
        h = {
      composed: !0,
      S: !0
    },
        h = void 0 === h ? {} : h;
    e.addEventListener(a, d, h.S);
    return {
      j: function j() {
        e.removeEventListener(a, d, h.S);
      }
    };
  }

  function ma(a) {
    var b = {};
    if (!a || 1 != a.nodeType) return b;
    a = a.attributes;
    if (!a.length) return {};

    for (var c = 0, d; d = a[c]; c++) {
      b[d.name] = d.value;
    }

    return b;
  }

  var na = /:(80|443)$/,
      r = document.createElement("a"),
      t = {};

  function u(a) {
    a = a && "." != a ? a : location.href;
    if (t[a]) return t[a];
    r.href = a;
    if ("." == a.charAt(0) || "/" == a.charAt(0)) return u(r.href);
    var b = "80" == r.port || "443" == r.port ? "" : r.port,
        b = "0" == b ? "" : b,
        c = r.host.replace(na, "");
    return t[a] = {
      hash: r.hash,
      host: c,
      hostname: r.hostname,
      href: r.href,
      origin: r.origin ? r.origin : r.protocol + "//" + c,
      pathname: "/" == r.pathname.charAt(0) ? r.pathname : "/" + r.pathname,
      port: b,
      protocol: r.protocol,
      search: r.search
    };
  }

  var w = [];

  function oa(a, b) {
    var c = this;
    this.context = a;
    this.P = b;
    this.f = (this.c = /Task$/.test(b)) ? a.get(b) : a[b];
    this.b = [];
    this.a = [];

    this.g = function (a) {
      for (var b = [], d = 0; d < arguments.length; ++d) {
        b[d - 0] = arguments[d];
      }

      return c.a[c.a.length - 1].apply(null, [].concat(n(b)));
    };

    this.c ? a.set(b, this.g) : a[b] = this.g;
  }

  function x(a, b, c) {
    a = pa(a, b);
    a.b.push(c);
    qa(a);
  }

  function y(a, b, c) {
    a = pa(a, b);
    c = a.b.indexOf(c);
    -1 < c && (a.b.splice(c, 1), 0 < a.b.length ? qa(a) : a.j());
  }

  function qa(a) {
    a.a = [];

    for (var b, c = 0; b = a.b[c]; c++) {
      var d = a.a[c - 1] || a.f.bind(a.context);
      a.a.push(b(d));
    }
  }

  oa.prototype.j = function () {
    var a = w.indexOf(this);
    -1 < a && (w.splice(a, 1), this.c ? this.context.set(this.P, this.f) : this.context[this.P] = this.f);
  };

  function pa(a, b) {
    var c = w.filter(function (c) {
      return c.context == a && c.P == b;
    })[0];
    c || (c = new oa(a, b), w.push(c));
    return c;
  }

  function z(a, b, c, d, e, h) {
    if ("function" == typeof d) {
      var f = c.get("buildHitTask");
      return {
        buildHitTask: function buildHitTask(c) {
          c.set(a, null, !0);
          c.set(b, null, !0);
          d(c, e, h);
          f(c);
        }
      };
    }

    return A({}, a, b);
  }

  function B(a, b) {
    var c = ma(a),
        d = {};
    Object.keys(c).forEach(function (a) {
      if (!a.indexOf(b) && a != b + "on") {
        var e = c[a];
        "true" == e && (e = !0);
        "false" == e && (e = !1);
        a = ra(a.slice(b.length));
        d[a] = e;
      }
    });
    return d;
  }

  function sa(a) {
    "loading" == document.readyState ? document.addEventListener("DOMContentLoaded", function c() {
      document.removeEventListener("DOMContentLoaded", c);
      a();
    }) : a();
  }

  function ta(a, b) {
    var c;
    return function (d) {
      for (var e = [], h = 0; h < arguments.length; ++h) {
        e[h - 0] = arguments[h];
      }

      clearTimeout(c);
      c = setTimeout(function () {
        return a.apply(null, [].concat(n(e)));
      }, b);
    };
  }

  function ua(a) {
    function b() {
      c || (c = !0, a());
    }

    var c = !1;
    setTimeout(b, 2E3);
    return b;
  }

  var C = {};

  function va(a, b) {
    function c() {
      clearTimeout(e.timeout);
      e.send && y(a, "send", e.send);
      delete C[d];
      e.R.forEach(function (a) {
        return a();
      });
    }

    var d = a.get("trackingId"),
        e = C[d] = C[d] || {};
    clearTimeout(e.timeout);
    e.timeout = setTimeout(c, 0);
    e.R = e.R || [];
    e.R.push(b);
    e.send || (e.send = function (a) {
      return function (b) {
        for (var d = [], e = 0; e < arguments.length; ++e) {
          d[e - 0] = arguments[e];
        }

        c();
        a.apply(null, [].concat(n(d)));
      };
    }, x(a, "send", e.send));
  }

  var A = Object.assign || function (a, b) {
    for (var c = [], d = 1; d < arguments.length; ++d) {
      c[d - 1] = arguments[d];
    }

    for (var d = 0, e = c.length; d < e; d++) {
      var h = Object(c[d]),
          f;

      for (f in h) {
        Object.prototype.hasOwnProperty.call(h, f) && (a[f] = h[f]);
      }
    }

    return a;
  };

  function ra(a) {
    return a.replace(/[\-\_]+(\w?)/g, function (a, c) {
      return c.toUpperCase();
    });
  }

  function D(a) {
    return "object" == (typeof a === "undefined" ? "undefined" : _typeof(a)) && null !== a;
  }

  var E = function wa(b) {
    return b ? (b ^ 16 * Math.random() >> b / 4).toString(16) : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, wa);
  };

  function G(a, b) {
    var c = window.GoogleAnalyticsObject || "ga";

    window[c] = window[c] || function (a) {
      for (var b = [], d = 0; d < arguments.length; ++d) {
        b[d - 0] = arguments[d];
      }

      (window[c].q = window[c].q || []).push(b);
    };

    window.gaDevIds = window.gaDevIds || [];
    0 > window.gaDevIds.indexOf("i5iSjo") && window.gaDevIds.push("i5iSjo");
    window[c]("provide", a, b);
    window.gaplugins = window.gaplugins || {};
    window.gaplugins[a.charAt(0).toUpperCase() + a.slice(1)] = b;
  }

  var H = {
    T: 1,
    U: 2,
    V: 3,
    X: 4,
    Y: 5,
    Z: 6,
    $: 7,
    aa: 8,
    ba: 9,
    W: 10
  },
      I = Object.keys(H).length;

  function J(a, b) {
    a.set("\x26_av", "2.4.1");
    var c = a.get("\x26_au"),
        c = parseInt(c || "0", 16).toString(2);
    if (c.length < I) for (var d = I - c.length; d;) {
      c = "0" + c, d--;
    }
    b = I - b;
    c = c.substr(0, b) + 1 + c.substr(b + 1);
    a.set("\x26_au", parseInt(c || "0", 2).toString(16));
  }

  function K(a, b) {
    J(a, H.T);
    this.a = A({}, b);
    this.g = a;
    this.b = this.a.stripQuery && this.a.queryDimensionIndex ? "dimension" + this.a.queryDimensionIndex : null;
    this.f = this.f.bind(this);
    this.c = this.c.bind(this);
    x(a, "get", this.f);
    x(a, "buildHitTask", this.c);
  }

  K.prototype.f = function (a) {
    var b = this;
    return function (c) {
      if ("page" == c || c == b.b) {
        var d = {
          location: a("location"),
          page: a("page")
        };
        return xa(b, d)[c];
      }

      return a(c);
    };
  };

  K.prototype.c = function (a) {
    var b = this;
    return function (c) {
      var d = xa(b, {
        location: c.get("location"),
        page: c.get("page")
      });
      c.set(d, null, !0);
      a(c);
    };
  };

  function xa(a, b) {
    var c = u(b.page || b.location),
        d = c.pathname;

    if (a.a.indexFilename) {
      var e = d.split("/");
      a.a.indexFilename == e[e.length - 1] && (e[e.length - 1] = "", d = e.join("/"));
    }

    "remove" == a.a.trailingSlash ? d = d.replace(/\/+$/, "") : "add" == a.a.trailingSlash && (/\.\w+$/.test(d) || "/" == d.substr(-1) || (d += "/"));
    d = {
      page: d + (a.a.stripQuery ? ya(a, c.search) : c.search)
    };
    b.location && (d.location = b.location);
    a.b && (d[a.b] = c.search.slice(1) || "(not set)");
    return "function" == typeof a.a.urlFieldsFilter ? (b = a.a.urlFieldsFilter(d, u), c = {
      page: b.page,
      location: b.location
    }, a.b && (c[a.b] = b[a.b]), c) : d;
  }

  function ya(a, b) {
    if (Array.isArray(a.a.queryParamsWhitelist)) {
      var c = [];
      b.slice(1).split("\x26").forEach(function (b) {
        var d = fa(b.split("\x3d"));
        b = d.next().value;
        d = d.next().value;
        -1 < a.a.queryParamsWhitelist.indexOf(b) && d && c.push([b, d]);
      });
      return c.length ? "?" + c.map(function (a) {
        return a.join("\x3d");
      }).join("\x26") : "";
    }

    return "";
  }

  K.prototype.remove = function () {
    y(this.g, "get", this.f);
    y(this.g, "buildHitTask", this.c);
  };

  G("cleanUrlTracker", K);

  function L(a, b) {
    var c = this;
    J(a, H.U);

    if (window.addEventListener) {
      this.a = A({
        events: ["click"],
        fieldsObj: {},
        attributePrefix: "ga-"
      }, b);
      this.f = a;
      this.c = this.c.bind(this);
      var d = "[" + this.a.attributePrefix + "on]";
      this.b = {};
      this.a.events.forEach(function (a) {
        c.b[a] = q(a, d, c.c);
      });
    }
  }

  L.prototype.c = function (a, b) {
    var c = this.a.attributePrefix;

    if (!(0 > b.getAttribute(c + "on").split(/\s*,\s*/).indexOf(a.type))) {
      var c = B(b, c),
          d = A({}, this.a.fieldsObj, c);
      this.f.send(c.hitType || "event", z({
        transport: "beacon"
      }, d, this.f, this.a.hitFilter, b, a));
    }
  };

  L.prototype.remove = function () {
    var a = this;
    Object.keys(this.b).forEach(function (b) {
      a.b[b].j();
    });
  };

  G("eventTracker", L);

  function za(a, b) {
    var c = this;
    J(a, H.V);
    window.IntersectionObserver && window.MutationObserver && (this.a = A({
      rootMargin: "0px",
      fieldsObj: {},
      attributePrefix: "ga-"
    }, b), this.c = a, this.M = this.M.bind(this), this.O = this.O.bind(this), this.K = this.K.bind(this), this.L = this.L.bind(this), this.b = null, this.items = [], this.i = {}, this.h = {}, sa(function () {
      c.a.elements && c.observeElements(c.a.elements);
    }));
  }

  g = za.prototype;

  g.observeElements = function (a) {
    var b = this;
    a = M(this, a);
    this.items = this.items.concat(a.items);
    this.i = A({}, a.i, this.i);
    this.h = A({}, a.h, this.h);
    a.items.forEach(function (a) {
      var c = b.h[a.threshold] = b.h[a.threshold] || new IntersectionObserver(b.O, {
        rootMargin: b.a.rootMargin,
        threshold: [+a.threshold]
      });
      (a = b.i[a.id] || (b.i[a.id] = document.getElementById(a.id))) && c.observe(a);
    });
    this.b || (this.b = new MutationObserver(this.M), this.b.observe(document.body, {
      childList: !0,
      subtree: !0
    }));
    requestAnimationFrame(function () {});
  };

  g.unobserveElements = function (a) {
    var b = [],
        c = [];
    this.items.forEach(function (d) {
      a.some(function (a) {
        a = Aa(a);
        return a.id === d.id && a.threshold === d.threshold && a.trackFirstImpressionOnly === d.trackFirstImpressionOnly;
      }) ? c.push(d) : b.push(d);
    });

    if (b.length) {
      var d = M(this, b),
          e = M(this, c);
      this.items = d.items;
      this.i = d.i;
      this.h = d.h;
      c.forEach(function (a) {
        if (!d.i[a.id]) {
          var b = e.h[a.threshold],
              c = e.i[a.id];
          c && b.unobserve(c);
          d.h[a.threshold] || e.h[a.threshold].disconnect();
        }
      });
    } else this.unobserveAllElements();
  };

  g.unobserveAllElements = function () {
    var a = this;
    Object.keys(this.h).forEach(function (b) {
      a.h[b].disconnect();
    });
    this.b.disconnect();
    this.b = null;
    this.items = [];
    this.i = {};
    this.h = {};
  };

  function M(a, b) {
    var c = [],
        d = {},
        e = {};
    b.length && b.forEach(function (b) {
      b = Aa(b);
      c.push(b);
      e[b.id] = a.i[b.id] || null;
      d[b.threshold] = a.h[b.threshold] || null;
    });
    return {
      items: c,
      i: e,
      h: d
    };
  }

  g.M = function (a) {
    for (var b = 0, c; c = a[b]; b++) {
      for (var d = 0, e; e = c.removedNodes[d]; d++) {
        N(this, e, this.L);
      }

      for (d = 0; e = c.addedNodes[d]; d++) {
        N(this, e, this.K);
      }
    }
  };

  function N(a, b, c) {
    1 == b.nodeType && b.id in a.i && c(b.id);

    for (var d = 0, e; e = b.childNodes[d]; d++) {
      N(a, e, c);
    }
  }

  g.O = function (a) {
    for (var b = [], c = 0, d; d = a[c]; c++) {
      for (var e = 0, h; h = this.items[e]; e++) {
        var f;
        if (f = d.target.id === h.id) (f = h.threshold) ? f = d.intersectionRatio >= f : (f = d.intersectionRect, f = 0 < f.top || 0 < f.bottom || 0 < f.left || 0 < f.right);

        if (f) {
          var v = h.id;
          f = document.getElementById(v);
          var v = {
            transport: "beacon",
            eventCategory: "Viewport",
            eventAction: "impression",
            eventLabel: v,
            nonInteraction: !0
          },
              Na = A({}, this.a.fieldsObj, B(f, this.a.attributePrefix));
          this.c.send("event", z(v, Na, this.c, this.a.hitFilter, f));
          h.trackFirstImpressionOnly && b.push(h);
        }
      }
    }

    b.length && this.unobserveElements(b);
  };

  g.K = function (a) {
    var b = this,
        c = this.i[a] = document.getElementById(a);
    this.items.forEach(function (d) {
      a == d.id && b.h[d.threshold].observe(c);
    });
  };

  g.L = function (a) {
    var b = this,
        c = this.i[a];
    this.items.forEach(function (d) {
      a == d.id && b.h[d.threshold].unobserve(c);
    });
    this.i[a] = null;
  };

  g.remove = function () {
    this.unobserveAllElements();
  };

  G("impressionTracker", za);

  function Aa(a) {
    "string" == typeof a && (a = {
      id: a
    });
    return A({
      threshold: 0,
      trackFirstImpressionOnly: !0
    }, a);
  }

  function Ba() {
    this.a = {};
  }

  function Ca(a, b) {
    (a.a.externalSet = a.a.externalSet || []).push(b);
  }

  Ba.prototype.ca = function (a, b) {
    for (var c = [], d = 1; d < arguments.length; ++d) {
      c[d - 1] = arguments[d];
    }

    (this.a[a] = this.a[a] || []).forEach(function (a) {
      return a.apply(null, [].concat(n(c)));
    });
  };

  var O = {},
      P = !1,
      Q;

  function R(a, b) {
    b = void 0 === b ? {} : b;
    this.a = {};
    this.b = a;
    this.w = b;
    this.l = null;
  }

  ha(R, Ba);

  function S(a, b, c) {
    a = ["autotrack", a, b].join(":");
    O[a] || (O[a] = new R(a, c), P || (window.addEventListener("storage", Da), P = !0));
    return O[a];
  }

  function Ea() {
    if (null != Q) return Q;

    try {
      window.localStorage.setItem("autotrack", "autotrack"), window.localStorage.removeItem("autotrack"), Q = !0;
    } catch (a) {
      Q = !1;
    }

    return Q;
  }

  R.prototype.get = function () {
    if (this.l) return this.l;
    if (Ea()) try {
      this.l = Fa(window.localStorage.getItem(this.b));
    } catch (a) {}
    return this.l = A({}, this.w, this.l);
  };

  R.prototype.set = function (a) {
    this.l = A({}, this.w, this.l, a);
    if (Ea()) try {
      var b = JSON.stringify(this.l);
      window.localStorage.setItem(this.b, b);
    } catch (c) {}
  };

  function Ga(a) {
    a.l = {};
    if (Ea()) try {
      window.localStorage.removeItem(a.b);
    } catch (b) {}
  }

  R.prototype.j = function () {
    delete O[this.b];
    Object.keys(O).length || (window.removeEventListener("storage", Da), P = !1);
  };

  function Da(a) {
    var b = O[a.key];

    if (b) {
      var c = A({}, b.w, Fa(a.oldValue));
      a = A({}, b.w, Fa(a.newValue));
      b.l = a;
      b.ca("externalSet", a, c);
    }
  }

  function Fa(a) {
    var b = {};
    if (a) try {
      b = JSON.parse(a);
    } catch (c) {}
    return b;
  }

  var T = {};

  function U(a, b, c) {
    this.f = a;
    this.timeout = b || Ha;
    this.timeZone = c;
    this.b = this.b.bind(this);
    x(a, "sendHitTask", this.b);

    try {
      this.c = new Intl.DateTimeFormat("en-US", {
        timeZone: this.timeZone
      });
    } catch (d) {}

    this.a = S(a.get("trackingId"), "session", {
      hitTime: 0,
      isExpired: !1
    });
    this.a.get().id || this.a.set({
      id: E()
    });
  }

  function Ia(a, b, c) {
    var d = a.get("trackingId");
    return T[d] ? T[d] : T[d] = new U(a, b, c);
  }

  function V(a) {
    return a.a.get().id;
  }

  U.prototype.isExpired = function (a) {
    a = void 0 === a ? V(this) : a;
    if (a != V(this)) return !0;
    a = this.a.get();
    if (a.isExpired) return !0;
    var b = a.hitTime;
    return b && (a = new Date(), b = new Date(b), a - b > 6E4 * this.timeout || this.c && this.c.format(a) != this.c.format(b)) ? !0 : !1;
  };

  U.prototype.b = function (a) {
    var b = this;
    return function (c) {
      a(c);
      var d = c.get("sessionControl");
      c = "start" == d || b.isExpired();
      var d = "end" == d,
          e = b.a.get();
      e.hitTime = +new Date();
      c && (e.isExpired = !1, e.id = E());
      d && (e.isExpired = !0);
      b.a.set(e);
    };
  };

  U.prototype.j = function () {
    y(this.f, "sendHitTask", this.b);
    this.a.j();
    delete T[this.f.get("trackingId")];
  };

  var Ha = 30;

  function W(a, b) {
    J(a, H.W);
    window.addEventListener && (this.b = A({
      increaseThreshold: 20,
      sessionTimeout: Ha,
      fieldsObj: {}
    }, b), this.f = a, this.c = Ja(this), this.g = ta(this.g.bind(this), 500), this.o = this.o.bind(this), this.a = S(a.get("trackingId"), "plugins/max-scroll-tracker"), this.m = Ia(a, this.b.sessionTimeout, this.b.timeZone), x(a, "set", this.o), Ka(this));
  }

  function Ka(a) {
    100 > (a.a.get()[a.c] || 0) && window.addEventListener("scroll", a.g);
  }

  W.prototype.g = function () {
    var a = document.documentElement,
        b = document.body,
        a = Math.min(100, Math.max(0, Math.round(window.pageYOffset / (Math.max(a.offsetHeight, a.scrollHeight, b.offsetHeight, b.scrollHeight) - window.innerHeight) * 100))),
        b = V(this.m);
    b != this.a.get().sessionId && (Ga(this.a), this.a.set({
      sessionId: b
    }));
    if (this.m.isExpired(this.a.get().sessionId)) Ga(this.a);else if (b = this.a.get()[this.c] || 0, a > b && (100 != a && 100 != b || window.removeEventListener("scroll", this.g), b = a - b, 100 == a || b >= this.b.increaseThreshold)) {
      var c = {};
      this.a.set((c[this.c] = a, c.sessionId = V(this.m), c));
      a = {
        transport: "beacon",
        eventCategory: "Max Scroll",
        eventAction: "increase",
        eventValue: b,
        eventLabel: String(a),
        nonInteraction: !0
      };
      this.b.maxScrollMetricIndex && (a["metric" + this.b.maxScrollMetricIndex] = b);
      this.f.send("event", z(a, this.b.fieldsObj, this.f, this.b.hitFilter));
    }
  };

  W.prototype.o = function (a) {
    var b = this;
    return function (c, d) {
      a(c, d);
      var e = {};
      (D(c) ? c : (e[c] = d, e)).page && (c = b.c, b.c = Ja(b), b.c != c && Ka(b));
    };
  };

  function Ja(a) {
    a = u(a.f.get("page") || a.f.get("location"));
    return a.pathname + a.search;
  }

  W.prototype.remove = function () {
    this.m.j();
    window.removeEventListener("scroll", this.g);
    y(this.f, "set", this.o);
  };

  G("maxScrollTracker", W);
  var La = {};

  function Ma(a, b) {
    J(a, H.X);
    window.matchMedia && (this.a = A({
      changeTemplate: this.changeTemplate,
      changeTimeout: 1E3,
      fieldsObj: {}
    }, b), D(this.a.definitions) && (b = this.a.definitions, this.a.definitions = Array.isArray(b) ? b : [b], this.b = a, this.c = [], Oa(this)));
  }

  function Oa(a) {
    a.a.definitions.forEach(function (b) {
      if (b.name && b.dimensionIndex) {
        var c = Pa(b);
        a.b.set("dimension" + b.dimensionIndex, c);
        Qa(a, b);
      }
    });
  }

  function Pa(a) {
    var b;
    a.items.forEach(function (a) {
      Ra(a.media).matches && (b = a);
    });
    return b ? b.name : "(not set)";
  }

  function Qa(a, b) {
    b.items.forEach(function (c) {
      c = Ra(c.media);
      var d = ta(function () {
        var c = Pa(b),
            d = a.b.get("dimension" + b.dimensionIndex);
        c !== d && (a.b.set("dimension" + b.dimensionIndex, c), c = {
          transport: "beacon",
          eventCategory: b.name,
          eventAction: "change",
          eventLabel: a.a.changeTemplate(d, c),
          nonInteraction: !0
        }, a.b.send("event", z(c, a.a.fieldsObj, a.b, a.a.hitFilter)));
      }, a.a.changeTimeout);
      c.addListener(d);
      a.c.push({
        fa: c,
        da: d
      });
    });
  }

  Ma.prototype.remove = function () {
    for (var a = 0, b; b = this.c[a]; a++) {
      b.fa.removeListener(b.da);
    }
  };

  Ma.prototype.changeTemplate = function (a, b) {
    return a + " \x3d\x3e " + b;
  };

  G("mediaQueryTracker", Ma);

  function Ra(a) {
    return La[a] || (La[a] = window.matchMedia(a));
  }

  function X(a, b) {
    J(a, H.Y);
    window.addEventListener && (this.a = A({
      formSelector: "form",
      shouldTrackOutboundForm: this.shouldTrackOutboundForm,
      fieldsObj: {},
      attributePrefix: "ga-"
    }, b), this.b = a, this.c = q("submit", this.a.formSelector, this.f.bind(this)));
  }

  X.prototype.f = function (a, b) {
    var c = {
      transport: "beacon",
      eventCategory: "Outbound Form",
      eventAction: "submit",
      eventLabel: u(b.action).href
    };

    if (this.a.shouldTrackOutboundForm(b, u)) {
      navigator.sendBeacon || (a.preventDefault(), c.hitCallback = ua(function () {
        b.submit();
      }));
      var d = A({}, this.a.fieldsObj, B(b, this.a.attributePrefix));
      this.b.send("event", z(c, d, this.b, this.a.hitFilter, b, a));
    }
  };

  X.prototype.shouldTrackOutboundForm = function (a, b) {
    a = b(a.action);
    return a.hostname != location.hostname && "http" == a.protocol.slice(0, 4);
  };

  X.prototype.remove = function () {
    this.c.j();
  };

  G("outboundFormTracker", X);

  function Y(a, b) {
    var c = this;
    J(a, H.Z);
    window.addEventListener && (this.a = A({
      events: ["click"],
      linkSelector: "a, area",
      shouldTrackOutboundLink: this.shouldTrackOutboundLink,
      fieldsObj: {},
      attributePrefix: "ga-"
    }, b), this.c = a, this.f = this.f.bind(this), this.b = {}, this.a.events.forEach(function (a) {
      c.b[a] = q(a, c.a.linkSelector, c.f);
    }));
  }

  Y.prototype.f = function (a, b) {
    var c = this;

    if (this.a.shouldTrackOutboundLink(b, u)) {
      var d = b.getAttribute("href") || b.getAttribute("xlink:href"),
          e = u(d),
          e = {
        transport: "beacon",
        eventCategory: "Outbound Link",
        eventAction: a.type,
        eventLabel: e.href
      },
          h = A({}, this.a.fieldsObj, B(b, this.a.attributePrefix)),
          f = z(e, h, this.c, this.a.hitFilter, b, a);
      if (navigator.sendBeacon || "click" != a.type || "_blank" == b.target || a.metaKey || a.ctrlKey || a.shiftKey || a.altKey || 1 < a.which) this.c.send("event", f);else {
        var v = function v() {
          window.removeEventListener("click", v);

          if (!a.defaultPrevented) {
            a.preventDefault();
            var b = f.hitCallback;
            f.hitCallback = ua(function () {
              "function" == typeof b && b();
              location.href = d;
            });
          }

          c.c.send("event", f);
        };

        window.addEventListener("click", v);
      }
    }
  };

  Y.prototype.shouldTrackOutboundLink = function (a, b) {
    a = a.getAttribute("href") || a.getAttribute("xlink:href");
    b = b(a);
    return b.hostname != location.hostname && "http" == b.protocol.slice(0, 4);
  };

  Y.prototype.remove = function () {
    var a = this;
    Object.keys(this.b).forEach(function (b) {
      a.b[b].j();
    });
  };

  G("outboundLinkTracker", Y);
  var Z = E();

  function Sa(a, b) {
    var c = this;
    J(a, H.$);
    document.visibilityState && (this.a = A({
      sessionTimeout: Ha,
      visibleThreshold: 5E3,
      sendInitialPageview: !1,
      fieldsObj: {}
    }, b), this.b = a, this.g = document.visibilityState, this.m = null, this.o = !1, this.v = this.v.bind(this), this.s = this.s.bind(this), this.G = this.G.bind(this), this.N = this.N.bind(this), this.c = S(a.get("trackingId"), "plugins/page-visibility-tracker"), Ca(this.c, this.N), this.f = Ia(a, this.a.sessionTimeout, this.a.timeZone), x(a, "set", this.v), window.addEventListener("unload", this.G), document.addEventListener("visibilitychange", this.s), va(this.b, function () {
      if ("visible" == document.visibilityState) c.a.sendInitialPageview && (Ta(c, {
        ea: !0
      }), c.o = !0), c.c.set({
        time: +new Date(),
        state: "visible",
        pageId: Z,
        sessionId: V(c.f)
      });else if (c.a.sendInitialPageview && c.a.pageLoadsMetricIndex) {
        var a = {},
            a = (a.transport = "beacon", a.eventCategory = "Page Visibility", a.eventAction = "page load", a.eventLabel = "(not set)", a["metric" + c.a.pageLoadsMetricIndex] = 1, a.nonInteraction = !0, a);
        c.b.send("event", z(a, c.a.fieldsObj, c.b, c.a.hitFilter));
      }
    }));
  }

  g = Sa.prototype;

  g.s = function () {
    var a = this;

    if ("visible" == document.visibilityState || "hidden" == document.visibilityState) {
      var b = Ua(this),
          c = {
        time: +new Date(),
        state: document.visibilityState,
        pageId: Z,
        sessionId: V(this.f)
      };
      "visible" == document.visibilityState && this.a.sendInitialPageview && !this.o && (Ta(this), this.o = !0);
      "hidden" == document.visibilityState && this.m && clearTimeout(this.m);
      this.f.isExpired(b.sessionId) ? (Ga(this.c), "hidden" == this.g && "visible" == document.visibilityState && (clearTimeout(this.m), this.m = setTimeout(function () {
        a.c.set(c);
        Ta(a, {
          hitTime: c.time
        });
      }, this.a.visibleThreshold))) : (b.pageId == Z && "visible" == b.state && Va(this, b), this.c.set(c));
      this.g = document.visibilityState;
    }
  };

  function Ua(a) {
    var b = a.c.get();
    "visible" == a.g && "hidden" == b.state && b.pageId != Z && (b.state = "visible", b.pageId = Z, a.c.set(b));
    return b;
  }

  function Va(a, b, c) {
    c = (c ? c : {}).hitTime;
    var d = {
      hitTime: c
    },
        d = (d ? d : {}).hitTime;
    (b = b.time ? (d || +new Date()) - b.time : 0) && b >= a.a.visibleThreshold && (b = Math.round(b / 1E3), d = {
      transport: "beacon",
      nonInteraction: !0,
      eventCategory: "Page Visibility",
      eventAction: "track",
      eventValue: b,
      eventLabel: "(not set)"
    }, c && (d.queueTime = +new Date() - c), a.a.visibleMetricIndex && (d["metric" + a.a.visibleMetricIndex] = b), a.b.send("event", z(d, a.a.fieldsObj, a.b, a.a.hitFilter)));
  }

  function Ta(a, b) {
    var c = b ? b : {};
    b = c.hitTime;
    var c = c.ea,
        d = {
      transport: "beacon"
    };
    b && (d.queueTime = +new Date() - b);
    c && a.a.pageLoadsMetricIndex && (d["metric" + a.a.pageLoadsMetricIndex] = 1);
    a.b.send("pageview", z(d, a.a.fieldsObj, a.b, a.a.hitFilter));
  }

  g.v = function (a) {
    var b = this;
    return function (c, d) {
      var e = {},
          e = D(c) ? c : (e[c] = d, e);
      e.page && e.page !== b.b.get("page") && "visible" == b.g && b.s();
      a(c, d);
    };
  };

  g.N = function (a, b) {
    a.time != b.time && (b.pageId != Z || "visible" != b.state || this.f.isExpired(b.sessionId) || Va(this, b, {
      hitTime: a.time
    }));
  };

  g.G = function () {
    "hidden" != this.g && this.s();
  };

  g.remove = function () {
    this.c.j();
    this.f.j();
    y(this.b, "set", this.v);
    window.removeEventListener("unload", this.G);
    document.removeEventListener("visibilitychange", this.s);
  };

  G("pageVisibilityTracker", Sa);

  function Wa(a, b) {
    J(a, H.aa);
    window.addEventListener && (this.a = A({
      fieldsObj: {},
      hitFilter: null
    }, b), this.b = a, this.u = this.u.bind(this), this.J = this.J.bind(this), this.D = this.D.bind(this), this.A = this.A.bind(this), this.B = this.B.bind(this), this.F = this.F.bind(this), "complete" != document.readyState ? window.addEventListener("load", this.u) : this.u());
  }

  g = Wa.prototype;

  g.u = function () {
    if (window.FB) try {
      window.FB.Event.subscribe("edge.create", this.B), window.FB.Event.subscribe("edge.remove", this.F);
    } catch (a) {}
    window.twttr && this.J();
  };

  g.J = function () {
    var a = this;

    try {
      window.twttr.ready(function () {
        window.twttr.events.bind("tweet", a.D);
        window.twttr.events.bind("follow", a.A);
      });
    } catch (b) {}
  };

  function Xa(a) {
    try {
      window.twttr.ready(function () {
        window.twttr.events.unbind("tweet", a.D);
        window.twttr.events.unbind("follow", a.A);
      });
    } catch (b) {}
  }

  g.D = function (a) {
    if ("tweet" == a.region) {
      var b = {
        transport: "beacon",
        socialNetwork: "Twitter",
        socialAction: "tweet",
        socialTarget: a.data.url || a.target.getAttribute("data-url") || location.href
      };
      this.b.send("social", z(b, this.a.fieldsObj, this.b, this.a.hitFilter, a.target, a));
    }
  };

  g.A = function (a) {
    if ("follow" == a.region) {
      var b = {
        transport: "beacon",
        socialNetwork: "Twitter",
        socialAction: "follow",
        socialTarget: a.data.screen_name || a.target.getAttribute("data-screen-name")
      };
      this.b.send("social", z(b, this.a.fieldsObj, this.b, this.a.hitFilter, a.target, a));
    }
  };

  g.B = function (a) {
    this.b.send("social", z({
      transport: "beacon",
      socialNetwork: "Facebook",
      socialAction: "like",
      socialTarget: a
    }, this.a.fieldsObj, this.b, this.a.hitFilter));
  };

  g.F = function (a) {
    this.b.send("social", z({
      transport: "beacon",
      socialNetwork: "Facebook",
      socialAction: "unlike",
      socialTarget: a
    }, this.a.fieldsObj, this.b, this.a.hitFilter));
  };

  g.remove = function () {
    window.removeEventListener("load", this.u);

    try {
      window.FB.Event.unsubscribe("edge.create", this.B), window.FB.Event.unsubscribe("edge.remove", this.F);
    } catch (a) {}

    Xa(this);
  };

  G("socialWidgetTracker", Wa);

  function Ya(a, b) {
    J(a, H.ba);
    history.pushState && window.addEventListener && (this.a = A({
      shouldTrackUrlChange: this.shouldTrackUrlChange,
      trackReplaceState: !1,
      fieldsObj: {},
      hitFilter: null
    }, b), this.b = a, this.c = location.pathname + location.search, this.H = this.H.bind(this), this.I = this.I.bind(this), this.C = this.C.bind(this), x(history, "pushState", this.H), x(history, "replaceState", this.I), window.addEventListener("popstate", this.C));
  }

  g = Ya.prototype;

  g.H = function (a) {
    var b = this;
    return function (c) {
      for (var d = [], e = 0; e < arguments.length; ++e) {
        d[e - 0] = arguments[e];
      }

      a.apply(null, [].concat(n(d)));
      Za(b, !0);
    };
  };

  g.I = function (a) {
    var b = this;
    return function (c) {
      for (var d = [], e = 0; e < arguments.length; ++e) {
        d[e - 0] = arguments[e];
      }

      a.apply(null, [].concat(n(d)));
      Za(b, !1);
    };
  };

  g.C = function () {
    Za(this, !0);
  };

  function Za(a, b) {
    setTimeout(function () {
      var c = a.c,
          d = location.pathname + location.search;
      c != d && a.a.shouldTrackUrlChange.call(a, d, c) && (a.c = d, a.b.set({
        page: d,
        title: document.title
      }), (b || a.a.trackReplaceState) && a.b.send("pageview", z({
        transport: "beacon"
      }, a.a.fieldsObj, a.b, a.a.hitFilter)));
    }, 0);
  }

  g.shouldTrackUrlChange = function (a, b) {
    return !(!a || !b);
  };

  g.remove = function () {
    y(history, "pushState", this.H);
    y(history, "replaceState", this.I);
    window.removeEventListener("popstate", this.C);
  };

  G("urlChangeTracker", Ya);
})();
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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFkYmxvY2tEZXRlY3Rvci5qcyIsImF1dG90cmFjay5qcyIsIndwLWV2ZW50LXRyYWNraW5nLmpzIl0sIm5hbWVzIjpbIndpbiIsInZlcnNpb24iLCJvZnMiLCJjbCIsIm5vb3AiLCJ0ZXN0ZWRPbmNlIiwidGVzdEV4ZWN1dGluZyIsImlzT2xkSUVldmVudHMiLCJhZGRFdmVudExpc3RlbmVyIiwidW5kZWZpbmVkIiwiX29wdGlvbnMiLCJsb29wRGVsYXkiLCJtYXhMb29wIiwiZGVidWciLCJmb3VuZCIsIm5vdGZvdW5kIiwiY29tcGxldGUiLCJwYXJzZUFzSnNvbiIsImRhdGEiLCJyZXN1bHQiLCJmbkRhdGEiLCJKU09OIiwicGFyc2UiLCJleCIsIkZ1bmN0aW9uIiwibG9nIiwiQWpheEhlbHBlciIsIm9wdHMiLCJ4aHIiLCJYTUxIdHRwUmVxdWVzdCIsInN1Y2Nlc3MiLCJmYWlsIiwibWUiLCJtZXRob2QiLCJhYm9ydCIsInN0YXRlQ2hhbmdlIiwidmFscyIsInJlYWR5U3RhdGUiLCJzdGF0dXMiLCJyZXNwb25zZSIsIm9ucmVhZHlzdGF0ZWNoYW5nZSIsInN0YXJ0Iiwib3BlbiIsInVybCIsInNlbmQiLCJCbG9ja0xpc3RUcmFja2VyIiwiZXh0ZXJuYWxCbG9ja2xpc3REYXRhIiwiYWRkVXJsIiwic3RhdGUiLCJmb3JtYXQiLCJzZXRSZXN1bHQiLCJ1cmxLZXkiLCJvYmoiLCJsaXN0ZW5lcnMiLCJiYWl0Tm9kZSIsInF1aWNrQmFpdCIsImNzc0NsYXNzIiwiYmFpdFRyaWdnZXJzIiwibnVsbFByb3BzIiwiemVyb1Byb3BzIiwiZXhlUmVzdWx0IiwicXVpY2siLCJyZW1vdGUiLCJmaW5kUmVzdWx0IiwidGltZXJJZHMiLCJ0ZXN0IiwiZG93bmxvYWQiLCJpc0Z1bmMiLCJmbiIsIm1ha2VFbCIsInRhZyIsImF0dHJpYnV0ZXMiLCJrIiwidiIsImVsIiwiYXR0ciIsImQiLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJoYXNPd25Qcm9wZXJ0eSIsInNldEF0dHJpYnV0ZSIsImF0dGFjaEV2ZW50TGlzdGVuZXIiLCJkb20iLCJldmVudE5hbWUiLCJoYW5kbGVyIiwiYXR0YWNoRXZlbnQiLCJtZXNzYWdlIiwiaXNFcnJvciIsImNvbnNvbGUiLCJlcnJvciIsImFqYXhEb3dubG9hZHMiLCJsb2FkRXhlY3V0ZVVybCIsImFqYXgiLCJibG9ja0xpc3RzIiwiaW50ZXJ2YWxJZCIsInJldHJ5Q291bnQiLCJ0cnlFeGVjdXRlVGVzdCIsImxpc3REYXRhIiwiYmVnaW5UZXN0Iiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwicHVzaCIsImZldGNoUmVtb3RlTGlzdHMiLCJpIiwibGVuZ3RoIiwiY2FuY2VsUmVtb3RlRG93bmxvYWRzIiwiYWoiLCJwb3AiLCJiYWl0IiwiY2FzdEJhaXQiLCJzZXRUaW1lb3V0IiwicmVlbEluIiwiYiIsImJvZHkiLCJ0IiwiYmFpdFN0eWxlIiwic3R5bGUiLCJhcHBlbmRDaGlsZCIsImF0dGVtcHROdW0iLCJjbGVhckJhaXROb2RlIiwiY2xlYXJUaW1lb3V0IiwiZ2V0QXR0cmlidXRlIiwid2luZG93IiwiZ2V0Q29tcHV0ZWRTdHlsZSIsImJhaXRUZW1wIiwiZ2V0UHJvcGVydHlWYWx1ZSIsIm5vdGlmeUxpc3RlbmVycyIsInJlbW92ZSIsInJlbW92ZUNoaWxkIiwic3RvcEZpc2hpbmciLCJmdW5jcyIsIk1lc3NhZ2UiLCJhdHRhY2hPckZpcmUiLCJmaXJlTm93IiwiaW1wbCIsImluaXQiLCJvcHRpb25zIiwidG9Mb3dlckNhc2UiLCJnIiwiYWEiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0aWVzIiwiZGVmaW5lUHJvcGVydHkiLCJhIiwiYyIsImdldCIsInNldCIsIlR5cGVFcnJvciIsIkFycmF5IiwicHJvdG90eXBlIiwidmFsdWUiLCJnbG9iYWwiLCJsIiwiU3ltYm9sIiwiYmEiLCJjYSIsIm0iLCJpdGVyYXRvciIsImNvbmZpZ3VyYWJsZSIsIndyaXRhYmxlIiwiZGEiLCJlYSIsImRvbmUiLCJuZXh0IiwiZmEiLCJjYWxsIiwibiIsImhhIiwiY29uc3RydWN0b3IiLCJlIiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwicCIsIkVsZW1lbnQiLCJpYSIsIm1hdGNoZXMiLCJtYXRjaGVzU2VsZWN0b3IiLCJ3ZWJraXRNYXRjaGVzU2VsZWN0b3IiLCJtb3pNYXRjaGVzU2VsZWN0b3IiLCJtc01hdGNoZXNTZWxlY3RvciIsIm9NYXRjaGVzU2VsZWN0b3IiLCJqYSIsIm5vZGVUeXBlIiwia2EiLCJwYXJlbnROb2RlIiwicXVlcnlTZWxlY3RvckFsbCIsImxhIiwicSIsImgiLCJjb21wb3NlZCIsImNvbXBvc2VkUGF0aCIsImYiLCJGIiwidGFyZ2V0IiwiY29uY2F0IiwiUyIsImoiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwibWEiLCJuYW1lIiwibmEiLCJyIiwidSIsImxvY2F0aW9uIiwiaHJlZiIsImNoYXJBdCIsInBvcnQiLCJob3N0IiwicmVwbGFjZSIsImhhc2giLCJob3N0bmFtZSIsIm9yaWdpbiIsInByb3RvY29sIiwicGF0aG5hbWUiLCJzZWFyY2giLCJ3Iiwib2EiLCJjb250ZXh0IiwiUCIsImFyZ3VtZW50cyIsImFwcGx5IiwieCIsInBhIiwicWEiLCJ5IiwiaW5kZXhPZiIsInNwbGljZSIsImJpbmQiLCJmaWx0ZXIiLCJ6IiwiYnVpbGRIaXRUYXNrIiwiQSIsIkIiLCJrZXlzIiwiZm9yRWFjaCIsInJhIiwic2xpY2UiLCJzYSIsInRhIiwidWEiLCJDIiwidmEiLCJ0aW1lb3V0IiwiUiIsImFzc2lnbiIsInRvVXBwZXJDYXNlIiwiRCIsIkUiLCJ3YSIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsIkciLCJHb29nbGVBbmFseXRpY3NPYmplY3QiLCJnYURldklkcyIsImdhcGx1Z2lucyIsIkgiLCJUIiwiVSIsIlYiLCJYIiwiWSIsIloiLCIkIiwiVyIsIkkiLCJKIiwicGFyc2VJbnQiLCJzdWJzdHIiLCJLIiwic3RyaXBRdWVyeSIsInF1ZXJ5RGltZW5zaW9uSW5kZXgiLCJwYWdlIiwieGEiLCJpbmRleEZpbGVuYW1lIiwic3BsaXQiLCJqb2luIiwidHJhaWxpbmdTbGFzaCIsInlhIiwidXJsRmllbGRzRmlsdGVyIiwiaXNBcnJheSIsInF1ZXJ5UGFyYW1zV2hpdGVsaXN0IiwibWFwIiwiTCIsImV2ZW50cyIsImZpZWxkc09iaiIsImF0dHJpYnV0ZVByZWZpeCIsInR5cGUiLCJoaXRUeXBlIiwidHJhbnNwb3J0IiwiaGl0RmlsdGVyIiwiemEiLCJJbnRlcnNlY3Rpb25PYnNlcnZlciIsIk11dGF0aW9uT2JzZXJ2ZXIiLCJyb290TWFyZ2luIiwiTSIsIk8iLCJpdGVtcyIsImVsZW1lbnRzIiwib2JzZXJ2ZUVsZW1lbnRzIiwidGhyZXNob2xkIiwiaWQiLCJnZXRFbGVtZW50QnlJZCIsIm9ic2VydmUiLCJjaGlsZExpc3QiLCJzdWJ0cmVlIiwicmVxdWVzdEFuaW1hdGlvbkZyYW1lIiwidW5vYnNlcnZlRWxlbWVudHMiLCJzb21lIiwiQWEiLCJ0cmFja0ZpcnN0SW1wcmVzc2lvbk9ubHkiLCJ1bm9ic2VydmUiLCJkaXNjb25uZWN0IiwidW5vYnNlcnZlQWxsRWxlbWVudHMiLCJyZW1vdmVkTm9kZXMiLCJOIiwiYWRkZWROb2RlcyIsImNoaWxkTm9kZXMiLCJpbnRlcnNlY3Rpb25SYXRpbyIsImludGVyc2VjdGlvblJlY3QiLCJ0b3AiLCJib3R0b20iLCJsZWZ0IiwicmlnaHQiLCJldmVudENhdGVnb3J5IiwiZXZlbnRBY3Rpb24iLCJldmVudExhYmVsIiwibm9uSW50ZXJhY3Rpb24iLCJOYSIsIkJhIiwiQ2EiLCJleHRlcm5hbFNldCIsIlEiLCJEYSIsIkVhIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInJlbW92ZUl0ZW0iLCJGYSIsImdldEl0ZW0iLCJzdHJpbmdpZnkiLCJHYSIsImtleSIsIm9sZFZhbHVlIiwibmV3VmFsdWUiLCJIYSIsInRpbWVab25lIiwiSW50bCIsIkRhdGVUaW1lRm9ybWF0IiwiaGl0VGltZSIsImlzRXhwaXJlZCIsIklhIiwiRGF0ZSIsImluY3JlYXNlVGhyZXNob2xkIiwic2Vzc2lvblRpbWVvdXQiLCJKYSIsIm8iLCJLYSIsImRvY3VtZW50RWxlbWVudCIsIm1pbiIsIm1heCIsInJvdW5kIiwicGFnZVlPZmZzZXQiLCJvZmZzZXRIZWlnaHQiLCJzY3JvbGxIZWlnaHQiLCJpbm5lckhlaWdodCIsInNlc3Npb25JZCIsImV2ZW50VmFsdWUiLCJTdHJpbmciLCJtYXhTY3JvbGxNZXRyaWNJbmRleCIsIkxhIiwiTWEiLCJtYXRjaE1lZGlhIiwiY2hhbmdlVGVtcGxhdGUiLCJjaGFuZ2VUaW1lb3V0IiwiZGVmaW5pdGlvbnMiLCJPYSIsImRpbWVuc2lvbkluZGV4IiwiUGEiLCJRYSIsIlJhIiwibWVkaWEiLCJhZGRMaXN0ZW5lciIsInJlbW92ZUxpc3RlbmVyIiwiZm9ybVNlbGVjdG9yIiwic2hvdWxkVHJhY2tPdXRib3VuZEZvcm0iLCJhY3Rpb24iLCJuYXZpZ2F0b3IiLCJzZW5kQmVhY29uIiwicHJldmVudERlZmF1bHQiLCJoaXRDYWxsYmFjayIsInN1Ym1pdCIsImxpbmtTZWxlY3RvciIsInNob3VsZFRyYWNrT3V0Ym91bmRMaW5rIiwibWV0YUtleSIsImN0cmxLZXkiLCJzaGlmdEtleSIsImFsdEtleSIsIndoaWNoIiwiZGVmYXVsdFByZXZlbnRlZCIsIlNhIiwidmlzaWJpbGl0eVN0YXRlIiwidmlzaWJsZVRocmVzaG9sZCIsInNlbmRJbml0aWFsUGFnZXZpZXciLCJzIiwiVGEiLCJ0aW1lIiwicGFnZUlkIiwicGFnZUxvYWRzTWV0cmljSW5kZXgiLCJVYSIsIlZhIiwicXVldWVUaW1lIiwidmlzaWJsZU1ldHJpY0luZGV4IiwiV2EiLCJGQiIsIkV2ZW50Iiwic3Vic2NyaWJlIiwidHd0dHIiLCJyZWFkeSIsIlhhIiwidW5iaW5kIiwicmVnaW9uIiwic29jaWFsTmV0d29yayIsInNvY2lhbEFjdGlvbiIsInNvY2lhbFRhcmdldCIsInNjcmVlbl9uYW1lIiwidW5zdWJzY3JpYmUiLCJZYSIsImhpc3RvcnkiLCJwdXNoU3RhdGUiLCJzaG91bGRUcmFja1VybENoYW5nZSIsInRyYWNrUmVwbGFjZVN0YXRlIiwiWmEiLCJ0aXRsZSIsIndwX2FuYWx5dGljc190cmFja2luZ19ldmVudCIsImNhdGVnb3J5IiwibGFiZWwiLCJnYSIsImFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncyIsInNwZWNpYWwiLCJlbmFibGVkIiwiZG9tYWluIiwiY2xpY2siLCJzdWJzdHJpbmciLCJkb3dubG9hZF9yZWdleCIsImNoZWNrRG93bmxvYWQiLCJSZWdFeHAiLCJpc0Rvd25sb2FkIiwiY2hlY2tEb3dubG9hZEV4dGVuc2lvbiIsImV4dGVuc2lvblJlc3VsdCIsImV4ZWMiLCJleHRlbnNpb24iLCJhZmZpbGlhdGUiLCJhZmZpbGlhdGVfcmVnZXgiLCJjaGVja0FmZmlsaWF0ZSIsImlzQWZmaWxpYXRlIiwiZm9ybV9zdWJtaXNzaW9ucyIsInRyYWNrX2FkYmxvY2tlciIsImFkYmxvY2tEZXRlY3RvciIsIm5vdEZvdW5kIiwialF1ZXJ5Il0sIm1hcHBpbmdzIjoiQUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQTs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFpQ0E7O0FBQ0EsQ0FBQyxVQUFTQSxHQUFULEVBQWM7QUFFZCxNQUFJQyxPQUFPLEdBQUcsS0FBZDtBQUVBLE1BQUlDLEdBQUcsR0FBRyxRQUFWO0FBQUEsTUFBb0JDLEVBQUUsR0FBRyxRQUF6Qjs7QUFDQSxNQUFJQyxJQUFJLEdBQUcsU0FBUEEsSUFBTyxHQUFVLENBQUUsQ0FBdkI7O0FBRUEsTUFBSUMsVUFBVSxHQUFHLEtBQWpCO0FBQ0EsTUFBSUMsYUFBYSxHQUFHLEtBQXBCO0FBRUEsTUFBSUMsYUFBYSxHQUFJUCxHQUFHLENBQUNRLGdCQUFKLEtBQXlCQyxTQUE5QztBQUVBOzs7OztBQUlBLE1BQUlDLFFBQVEsR0FBRztBQUNkQyxJQUFBQSxTQUFTLEVBQUUsRUFERztBQUVkQyxJQUFBQSxPQUFPLEVBQUUsQ0FGSztBQUdkQyxJQUFBQSxLQUFLLEVB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QUFrQjtBQUFwQixTQUE1QixDQUEzQjtBQUNBLE9BRkQsTUFFTztBQUNOdlQsUUFBQUEsTUFBTSxDQUFDK1UsZUFBUCxDQUF1QmxVLElBQXZCLENBQ0M7QUFDQzFILFVBQUFBLEtBQUssRUFBRSxLQURSO0FBRUNDLFVBQUFBLEtBQUssRUFBRSxpQkFBVztBQUNqQm1hLFlBQUFBLDJCQUEyQixDQUFFLE9BQUYsRUFBVyxTQUFYLEVBQXNCLElBQXRCLEVBQTRCO0FBQUUsZ0NBQWtCO0FBQXBCLGFBQTVCLENBQTNCO0FBQ0EsV0FKRjtBQUtDeUIsVUFBQUEsUUFBUSxFQUFFLG9CQUFXO0FBQ3BCekIsWUFBQUEsMkJBQTJCLENBQUUsT0FBRixFQUFXLFNBQVgsRUFBc0IsS0FBdEIsRUFBNkI7QUFBRSxnQ0FBa0I7QUFBcEIsYUFBN0IsQ0FBM0I7QUFDQTtBQVBGLFNBREQ7QUFXQTtBQUNEO0FBQ0QsR0FsQkQ7QUFvQkEsQ0EzR0QsRUEyR0swQixNQTNHTCIsImZpbGUiOiJ3cC1hbmFseXRpY3MtdHJhY2tpbmctZ2VuZXJhdG9yLWZyb250LWVuZC5qcyIsInNvdXJjZXNDb250ZW50IjpbIi8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG4vLyBBZEJsb2NrIGRldGVjdG9yXG4vL1xuLy8gQXR0ZW1wdHMgdG8gZGV0ZWN0IHRoZSBwcmVzZW5jZSBvZiBBZCBCbG9ja2VyIHNvZnR3YXJlIGFuZCBub3RpZnkgbGlzdGVuZXIgb2YgaXRzIGV4aXN0ZW5jZS5cbi8vIENvcHlyaWdodCAoYykgMjAxNyBJQUJcbi8vXG4vLyBUaGUgQlNELTMgTGljZW5zZVxuLy8gUmVkaXN0cmlidXRpb24gYW5kIHVzZSBpbiBzb3VyY2UgYW5kIGJpbmFyeSBmb3Jtcywgd2l0aCBvciB3aXRob3V0IG1vZGlmaWNhdGlvbiwgYXJlIHBlcm1pdHRlZCBwcm92aWRlZCB0aGF0IHRoZSBmb2xsb3dpbmcgY29uZGl0aW9ucyBhcmUgbWV0OlxuLy8gMS4gUmVkaXN0cmlidXRpb25zIG9mIHNvdXJjZSBjb2RlIG11c3QgcmV0YWluIHRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2YgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyLlxuLy8gMi4gUmVkaXN0cmlidXRpb25zIGluIGJpbmFyeSBmb3JtIG11c3QgcmVwcm9kdWNlIHRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlLCB0aGlzIGxpc3Qgb2YgY29uZGl0aW9ucyBhbmQgdGhlIGZvbGxvd2luZyBkaXNjbGFpbWVyIGluIHRoZSBkb2N1bWVudGF0aW9uIGFuZC9vciBvdGhlciBtYXRlcmlhbHMgcHJvdmlkZWQgd2l0aCB0aGUgZGlzdHJpYnV0aW9uLlxuLy8gMy4gTmVpdGhlciB0aGUgbmFtZSBvZiB0aGUgY29weXJpZ2h0IGhvbGRlciBub3IgdGhlIG5hbWVzIG9mIGl0cyBjb250cmlidXRvcnMgbWF5IGJlIHVzZWQgdG8gZW5kb3JzZSBvciBwcm9tb3RlIHByb2R1Y3RzIGRlcml2ZWQgZnJvbSB0aGlzIHNvZnR3YXJlIHdpdGhvdXQgc3BlY2lmaWMgcHJpb3Igd3JpdHRlbiBwZXJtaXNzaW9uLlxuLy8gVEhJUyBTT0ZUV0FSRSBJUyBQUk9WSURFRCBCWSBUSEUgQ09QWVJJR0hUIEhPTERFUlMgQU5EIENPTlRSSUJVVE9SUyBcIkFTIElTXCIgQU5EIEFOWSBFWFBSRVNTIE9SIElNUExJRUQgV0FSUkFOVElFUywgSU5DTFVESU5HLCBCVVQgTk9UIExJTUlURUQgVE8sIFRIRSBJTVBMSUVEIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZIEFORCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBUkUgRElTQ0xBSU1FRC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFIENPUFlSSUdIVCBIT0xERVIgT1IgQ09OVFJJQlVUT1JTIEJFIExJQUJMRSBGT1IgQU5ZIERJUkVDVCwgSU5ESVJFQ1QsIElOQ0lERU5UQUwsIFNQRUNJQUwsIEVYRU1QTEFSWSwgT1IgQ09OU0VRVUVOVElBTCBEQU1BR0VTIChJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgUFJPQ1VSRU1FTlQgT0YgU1VCU1RJVFVURSBHT09EUyBPUiBTRVJWSUNFUzsgTE9TUyBPRiBVU0UsIERBVEEsIE9SIFBST0ZJVFM7IE9SIEJVU0lORVNTIElOVEVSUlVQVElPTikgSE9XRVZFUiBDQVVTRUQgQU5EIE9OIEFOWSBUSEVPUlkgT0YgTElBQklMSVRZLCBXSEVUSEVSIElOIENPTlRSQUNULCBTVFJJQ1QgTElBQklMSVRZLCBPUiBUT1JUIChJTkNMVURJTkcgTkVHTElHRU5DRSBPUiBPVEhFUldJU0UpIEFSSVNJTkcgSU4gQU5ZIFdBWSBPVVQgT0YgVEhFIFVTRSBPRiBUSElTIFNPRlRXQVJFLCBFVkVOIElGIEFEVklTRUQgT0YgVEhFIFBPU1NJQklMSVRZIE9GIFNVQ0ggREFNQUdFLlxuLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblxuLyoqXG4qIEBuYW1lIHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3JcbipcbiogSUFCIEFkYmxvY2sgZGV0ZWN0b3IuXG4qIFVzYWdlOiB3aW5kb3cuYWRibG9ja0RldGVjdG9yLmluaXQob3B0aW9ucyk7XG4qXG4qIE9wdGlvbnMgb2JqZWN0IHNldHRpbmdzXG4qXG4qXHRAcHJvcCBkZWJ1ZzogIGJvb2xlYW5cbiogICAgICAgICBGbGFnIHRvIGluZGljYXRlIGFkZGl0aW9uYWwgZGVidWcgb3V0cHV0IHNob3VsZCBiZSBwcmludGVkIHRvIGNvbnNvbGVcbipcbipcdEBwcm9wIGZvdW5kOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgaXMgZGV0ZWN0ZWRcbipcbipcdEBwcm9wIG5vdGZvdW5kOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgaXMgbm90IGRldGVjdGVkLlxuKiAgICAgICAgIE5PVEU6IHRoaXMgZnVuY3Rpb24gbWF5IGZpcmUgbXVsdGlwbGUgdGltZXMgYW5kIGdpdmUgZmFsc2UgbmVnYXRpdmVcbiogICAgICAgICByZXNwb25zZXMgZHVyaW5nIGEgdGVzdCB1bnRpbCBhZGJsb2NrIGlzIHN1Y2Nlc3NmdWxseSBkZXRlY3RlZC5cbipcbipcdEBwcm9wIGNvbXBsZXRlOiBAZnVuY3Rpb25cbiogICAgICAgICBDYWxsYmFjayBmdW5jdGlvbiB0byBmaXJlIG9uY2UgYSByb3VuZCBvZiB0ZXN0aW5nIGlzIGNvbXBsZXRlLlxuKiAgICAgICAgIFRoZSB0ZXN0IHJlc3VsdCAoYm9vbGVhbikgaXMgaW5jbHVkZWQgYXMgYSBwYXJhbWV0ZXIgdG8gY2FsbGJhY2tcbipcbiogZXhhbXBsZTogXHR3aW5kb3cuYWRibG9ja0RldGVjdG9yLmluaXQoXG5cdFx0XHRcdHtcblx0XHRcdFx0XHRmb3VuZDogZnVuY3Rpb24oKXsgLi4ufSxcbiBcdFx0XHRcdFx0bm90Rm91bmQ6IGZ1bmN0aW9uKCl7Li4ufVxuXHRcdFx0XHR9XG5cdFx0XHQpO1xuKlxuKlxuKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG4oZnVuY3Rpb24od2luKSB7XG5cblx0dmFyIHZlcnNpb24gPSAnMS4wJztcblxuXHR2YXIgb2ZzID0gJ29mZnNldCcsIGNsID0gJ2NsaWVudCc7XG5cdHZhciBub29wID0gZnVuY3Rpb24oKXt9O1xuXG5cdHZhciB0ZXN0ZWRPbmNlID0gZmFsc2U7XG5cdHZhciB0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cblx0dmFyIGlzT2xkSUVldmVudHMgPSAod2luLmFkZEV2ZW50TGlzdGVuZXIgPT09IHVuZGVmaW5lZCk7XG5cblx0LyoqXG5cdCogT3B0aW9ucyBzZXQgd2l0aCBkZWZhdWx0IG9wdGlvbnMgaW5pdGlhbGl6ZWRcblx0KlxuXHQqL1xuXHR2YXIgX29wdGlvbnMgPSB7XG5cdFx0bG9vcERlbGF5OiA1MCxcblx0XHRtYXhMb29wOiA1LFxuXHRcdGRlYnVnOiB0cnVlLFxuXHRcdGZvdW5kOiBub29wLCBcdFx0XHRcdFx0Ly8gZnVuY3Rpb24gdG8gZmlyZSB3aGVuIGFkYmxvY2sgZGV0ZWN0ZWRcblx0XHRub3Rmb3VuZDogbm9vcCwgXHRcdFx0XHQvLyBmdW5jdGlvbiB0byBmaXJlIGlmIGFkYmxvY2sgbm90IGRldGVjdGVkIGFmdGVyIHRlc3Rpbmdcblx0XHRjb21wbGV0ZTogbm9vcCAgXHRcdFx0XHQvLyBmdW5jdGlvbiB0byBmaXJlIGFmdGVyIHRlc3RpbmcgY29tcGxldGVzLCBwYXNzaW5nIHJlc3VsdCBhcyBwYXJhbWV0ZXJcblx0fVxuXG5cdGZ1bmN0aW9uIHBhcnNlQXNKc29uKGRhdGEpe1xuXHRcdHZhciByZXN1bHQsIGZuRGF0YTtcblx0XHR0cnl7XG5cdFx0XHRyZXN1bHQgPSBKU09OLnBhcnNlKGRhdGEpO1xuXHRcdH1cblx0XHRjYXRjaChleCl7XG5cdFx0XHR0cnl7XG5cdFx0XHRcdGZuRGF0YSA9IG5ldyBGdW5jdGlvbihcInJldHVybiBcIiArIGRhdGEpO1xuXHRcdFx0XHRyZXN1bHQgPSBmbkRhdGEoKTtcblx0XHRcdH1cblx0XHRcdGNhdGNoKGV4KXtcblx0XHRcdFx0bG9nKCdGYWlsZWQgc2Vjb25kYXJ5IEpTT04gcGFyc2UnLCB0cnVlKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gcmVzdWx0O1xuXHR9XG5cblx0LyoqXG5cdCogQWpheCBoZWxwZXIgb2JqZWN0IHRvIGRvd25sb2FkIGV4dGVybmFsIHNjcmlwdHMuXG5cdCogSW5pdGlhbGl6ZSBvYmplY3Qgd2l0aCBhbiBvcHRpb25zIG9iamVjdFxuXHQqIEV4OlxuXHQgIHtcblx0XHQgIHVybCA6ICdodHRwOi8vZXhhbXBsZS5vcmcvdXJsX3RvX2Rvd25sb2FkJyxcblx0XHQgIG1ldGhvZDogJ1BPU1R8R0VUJyxcblx0XHQgIHN1Y2Nlc3M6IGNhbGxiYWNrX2Z1bmN0aW9uLFxuXHRcdCAgZmFpbDogIGNhbGxiYWNrX2Z1bmN0aW9uXG5cdCAgfVxuXHQqL1xuXHR2YXIgQWpheEhlbHBlciA9IGZ1bmN0aW9uKG9wdHMpe1xuXHRcdHZhciB4aHIgPSBuZXcgWE1MSHR0cFJlcXVlc3QoKTtcblxuXHRcdHRoaXMuc3VjY2VzcyA9IG9wdHMuc3VjY2VzcyB8fCBub29wO1xuXHRcdHRoaXMuZmFpbCA9IG9wdHMuZmFpbCB8fCBub29wO1xuXHRcdHZhciBtZSA9IHRoaXM7XG5cblx0XHR2YXIgbWV0aG9kID0gb3B0cy5tZXRob2QgfHwgJ2dldCc7XG5cblx0XHQvKipcblx0XHQqIEFib3J0IHRoZSByZXF1ZXN0XG5cdFx0Ki9cblx0XHR0aGlzLmFib3J0ID0gZnVuY3Rpb24oKXtcblx0XHRcdHRyeXtcblx0XHRcdFx0eGhyLmFib3J0KCk7XG5cdFx0XHR9XG5cdFx0XHRjYXRjaChleCl7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gc3RhdGVDaGFuZ2UodmFscyl7XG5cdFx0XHRpZih4aHIucmVhZHlTdGF0ZSA9PSA0KXtcblx0XHRcdFx0aWYoeGhyLnN0YXR1cyA9PSAyMDApe1xuXHRcdFx0XHRcdG1lLnN1Y2Nlc3MoeGhyLnJlc3BvbnNlKTtcblx0XHRcdFx0fVxuXHRcdFx0XHRlbHNle1xuXHRcdFx0XHRcdC8vIGZhaWxlZFxuXHRcdFx0XHRcdG1lLmZhaWwoeGhyLnN0YXR1cyk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHR4aHIub25yZWFkeXN0YXRlY2hhbmdlID0gc3RhdGVDaGFuZ2U7XG5cblx0XHRmdW5jdGlvbiBzdGFydCgpe1xuXHRcdFx0eGhyLm9wZW4obWV0aG9kLCBvcHRzLnVybCwgdHJ1ZSk7XG5cdFx0XHR4aHIuc2VuZCgpO1xuXHRcdH1cblxuXHRcdHN0YXJ0KCk7XG5cdH1cblxuXHQvKipcblx0KiBPYmplY3QgdHJhY2tpbmcgdGhlIHZhcmlvdXMgYmxvY2sgbGlzdHNcblx0Ki9cblx0dmFyIEJsb2NrTGlzdFRyYWNrZXIgPSBmdW5jdGlvbigpe1xuXHRcdHZhciBtZSA9IHRoaXM7XG5cdFx0dmFyIGV4dGVybmFsQmxvY2tsaXN0RGF0YSA9IHt9O1xuXG5cdFx0LyoqXG5cdFx0KiBBZGQgYSBuZXcgZXh0ZXJuYWwgVVJMIHRvIHRyYWNrXG5cdFx0Ki9cblx0XHR0aGlzLmFkZFVybCA9IGZ1bmN0aW9uKHVybCl7XG5cdFx0XHRleHRlcm5hbEJsb2NrbGlzdERhdGFbdXJsXSA9IHtcblx0XHRcdFx0dXJsOiB1cmwsXG5cdFx0XHRcdHN0YXRlOiAncGVuZGluZycsXG5cdFx0XHRcdGZvcm1hdDogbnVsbCxcblx0XHRcdFx0ZGF0YTogbnVsbCxcblx0XHRcdFx0cmVzdWx0OiBudWxsXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBleHRlcm5hbEJsb2NrbGlzdERhdGFbdXJsXTtcblx0XHR9XG5cblx0XHQvKipcblx0XHQqIExvYWRzIGEgYmxvY2sgbGlzdCBkZWZpbml0aW9uXG5cdFx0Ki9cblx0XHR0aGlzLnNldFJlc3VsdCA9IGZ1bmN0aW9uKHVybEtleSwgc3RhdGUsIGRhdGEpe1xuXHRcdFx0dmFyIG9iaiA9IGV4dGVybmFsQmxvY2tsaXN0RGF0YVt1cmxLZXldO1xuXHRcdFx0aWYob2JqID09IG51bGwpe1xuXHRcdFx0XHRvYmogPSB0aGlzLmFkZFVybCh1cmxLZXkpO1xuXHRcdFx0fVxuXG5cdFx0XHRvYmouc3RhdGUgPSBzdGF0ZTtcblx0XHRcdGlmKGRhdGEgPT0gbnVsbCl7XG5cdFx0XHRcdG9iai5yZXN1bHQgPSBudWxsO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGlmKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJyl7XG5cdFx0XHRcdHRyeXtcblx0XHRcdFx0XHRkYXRhID0gcGFyc2VBc0pzb24oZGF0YSk7XG5cdFx0XHRcdFx0b2JqLmZvcm1hdCA9ICdqc29uJztcblx0XHRcdFx0fVxuXHRcdFx0XHRjYXRjaChleCl7XG5cdFx0XHRcdFx0b2JqLmZvcm1hdCA9ICdlYXN5bGlzdCc7XG5cdFx0XHRcdFx0Ly8gcGFyc2VFYXN5TGlzdChkYXRhKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0b2JqLmRhdGEgPSBkYXRhO1xuXG5cdFx0XHRyZXR1cm4gb2JqO1xuXHRcdH1cblxuXHR9XG5cblx0dmFyIGxpc3RlbmVycyA9IFtdOyAvLyBldmVudCByZXNwb25zZSBsaXN0ZW5lcnNcblx0dmFyIGJhaXROb2RlID0gbnVsbDtcblx0dmFyIHF1aWNrQmFpdCA9IHtcblx0XHRjc3NDbGFzczogJ3B1Yl8zMDB4MjUwIHB1Yl8zMDB4MjUwbSBwdWJfNzI4eDkwIHRleHQtYWQgdGV4dEFkIHRleHRfYWQgdGV4dF9hZHMgdGV4dC1hZHMgdGV4dC1hZC1saW5rcydcblx0fTtcblx0dmFyIGJhaXRUcmlnZ2VycyA9IHtcblx0XHRudWxsUHJvcHM6IFtvZnMgKyAnUGFyZW50J10sXG5cdFx0emVyb1Byb3BzOiBbXVxuXHR9O1xuXG5cdGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHMgPSBbXG5cdFx0b2ZzICsnSGVpZ2h0Jywgb2ZzICsnTGVmdCcsIG9mcyArJ1RvcCcsIG9mcyArJ1dpZHRoJywgb2ZzICsnSGVpZ2h0Jyxcblx0XHRjbCArICdIZWlnaHQnLCBjbCArICdXaWR0aCdcblx0XTtcblxuXHQvLyByZXN1bHQgb2JqZWN0XG5cdHZhciBleGVSZXN1bHQgPSB7XG5cdFx0cXVpY2s6IG51bGwsXG5cdFx0cmVtb3RlOiBudWxsXG5cdH07XG5cblx0dmFyIGZpbmRSZXN1bHQgPSBudWxsOyAvLyByZXN1bHQgb2YgdGVzdCBmb3IgYWQgYmxvY2tlclxuXG5cdHZhciB0aW1lcklkcyA9IHtcblx0XHR0ZXN0OiAwLFxuXHRcdGRvd25sb2FkOiAwXG5cdH07XG5cblx0ZnVuY3Rpb24gaXNGdW5jKGZuKXtcblx0XHRyZXR1cm4gdHlwZW9mKGZuKSA9PSAnZnVuY3Rpb24nO1xuXHR9XG5cblx0LyoqXG5cdCogTWFrZSBhIERPTSBlbGVtZW50XG5cdCovXG5cdGZ1bmN0aW9uIG1ha2VFbCh0YWcsIGF0dHJpYnV0ZXMpe1xuXHRcdHZhciBrLCB2LCBlbCwgYXR0ciA9IGF0dHJpYnV0ZXM7XG5cdFx0dmFyIGQgPSBkb2N1bWVudDtcblxuXHRcdGVsID0gZC5jcmVhdGVFbGVtZW50KHRhZyk7XG5cblx0XHRpZihhdHRyKXtcblx0XHRcdGZvcihrIGluIGF0dHIpe1xuXHRcdFx0XHRpZihhdHRyLmhhc093blByb3BlcnR5KGspKXtcblx0XHRcdFx0XHRlbC5zZXRBdHRyaWJ1dGUoaywgYXR0cltrXSk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gZWw7XG5cdH1cblxuXHRmdW5jdGlvbiBhdHRhY2hFdmVudExpc3RlbmVyKGRvbSwgZXZlbnROYW1lLCBoYW5kbGVyKXtcblx0XHRpZihpc09sZElFZXZlbnRzKXtcblx0XHRcdGRvbS5hdHRhY2hFdmVudCgnb24nICsgZXZlbnROYW1lLCBoYW5kbGVyKTtcblx0XHR9XG5cdFx0ZWxzZXtcblx0XHRcdGRvbS5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgaGFuZGxlciwgZmFsc2UpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGxvZyhtZXNzYWdlLCBpc0Vycm9yKXtcblx0XHRpZighX29wdGlvbnMuZGVidWcgJiYgIWlzRXJyb3Ipe1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRpZih3aW4uY29uc29sZSAmJiB3aW4uY29uc29sZS5sb2cpe1xuXHRcdFx0aWYoaXNFcnJvcil7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IoJ1tBQkRdICcgKyBtZXNzYWdlKTtcblx0XHRcdH1cblx0XHRcdGVsc2V7XG5cdFx0XHRcdGNvbnNvbGUubG9nKCdbQUJEXSAnICsgbWVzc2FnZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0dmFyIGFqYXhEb3dubG9hZHMgPSBbXTtcblxuXHQvKipcblx0KiBMb2FkIGFuZCBleGVjdXRlIHRoZSBVUkwgaW5zaWRlIGEgY2xvc3VyZSBmdW5jdGlvblxuXHQqL1xuXHRmdW5jdGlvbiBsb2FkRXhlY3V0ZVVybCh1cmwpe1xuXHRcdHZhciBhamF4LCByZXN1bHQ7XG5cblx0XHRibG9ja0xpc3RzLmFkZFVybCh1cmwpO1xuXHRcdC8vIHNldHVwIGNhbGwgZm9yIHJlbW90ZSBsaXN0XG5cdFx0YWpheCA9IG5ldyBBamF4SGVscGVyKFxuXHRcdFx0e1xuXHRcdFx0XHR1cmw6IHVybCxcblx0XHRcdFx0c3VjY2VzczogZnVuY3Rpb24oZGF0YSl7XG5cdFx0XHRcdFx0bG9nKCdkb3dubG9hZGVkIGZpbGUgJyArIHVybCk7IC8vIHRvZG8gLSBwYXJzZSBhbmQgc3RvcmUgdW50aWwgdXNlXG5cdFx0XHRcdFx0cmVzdWx0ID0gYmxvY2tMaXN0cy5zZXRSZXN1bHQodXJsLCAnc3VjY2VzcycsIGRhdGEpO1xuXHRcdFx0XHRcdHRyeXtcblx0XHRcdFx0XHRcdHZhciBpbnRlcnZhbElkID0gMCxcblx0XHRcdFx0XHRcdFx0cmV0cnlDb3VudCA9IDA7XG5cblx0XHRcdFx0XHRcdHZhciB0cnlFeGVjdXRlVGVzdCA9IGZ1bmN0aW9uKGxpc3REYXRhKXtcblx0XHRcdFx0XHRcdFx0aWYoIXRlc3RFeGVjdXRpbmcpe1xuXHRcdFx0XHRcdFx0XHRcdGJlZ2luVGVzdChsaXN0RGF0YSwgdHJ1ZSk7XG5cdFx0XHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0XHRpZihmaW5kUmVzdWx0ID09IHRydWUpe1xuXHRcdFx0XHRcdFx0XHRyZXR1cm47XG5cdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdGlmKHRyeUV4ZWN1dGVUZXN0KHJlc3VsdC5kYXRhKSl7XG5cdFx0XHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0XHRcdH1cblx0XHRcdFx0XHRcdGVsc2V7XG5cdFx0XHRcdFx0XHRcdGxvZygnUGF1c2UgYmVmb3JlIHRlc3QgZXhlY3V0aW9uJyk7XG5cdFx0XHRcdFx0XHRcdGludGVydmFsSWQgPSBzZXRJbnRlcnZhbChmdW5jdGlvbigpe1xuXHRcdFx0XHRcdFx0XHRcdGlmKHRyeUV4ZWN1dGVUZXN0KHJlc3VsdC5kYXRhKSB8fCByZXRyeUNvdW50KysgPiA1KXtcblx0XHRcdFx0XHRcdFx0XHRcdGNsZWFySW50ZXJ2YWwoaW50ZXJ2YWxJZCk7XG5cdFx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHR9LCAyNTApO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRjYXRjaChleCl7XG5cdFx0XHRcdFx0XHRsb2coZXgubWVzc2FnZSArICcgdXJsOiAnICsgdXJsLCB0cnVlKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0sXG5cdFx0XHRcdGZhaWw6IGZ1bmN0aW9uKHN0YXR1cyl7XG5cdFx0XHRcdFx0bG9nKHN0YXR1cywgdHJ1ZSk7XG5cdFx0XHRcdFx0YmxvY2tMaXN0cy5zZXRSZXN1bHQodXJsLCAnZXJyb3InLCBudWxsKTtcblx0XHRcdFx0fVxuXHRcdFx0fSk7XG5cblx0XHRhamF4RG93bmxvYWRzLnB1c2goYWpheCk7XG5cdH1cblxuXG5cdC8qKlxuXHQqIEZldGNoIHRoZSBleHRlcm5hbCBsaXN0cyBhbmQgaW5pdGlhdGUgdGhlIHRlc3RzXG5cdCovXG5cdGZ1bmN0aW9uIGZldGNoUmVtb3RlTGlzdHMoKXtcblx0XHR2YXIgaSwgdXJsO1xuXHRcdHZhciBvcHRzID0gX29wdGlvbnM7XG5cblx0XHRmb3IoaT0wO2k8b3B0cy5ibG9ja0xpc3RzLmxlbmd0aDtpKyspe1xuXHRcdFx0dXJsID0gb3B0cy5ibG9ja0xpc3RzW2ldO1xuXHRcdFx0bG9hZEV4ZWN1dGVVcmwodXJsKTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBjYW5jZWxSZW1vdGVEb3dubG9hZHMoKXtcblx0XHR2YXIgaSwgYWo7XG5cblx0XHRmb3IoaT1hamF4RG93bmxvYWRzLmxlbmd0aC0xO2kgPj0gMDtpLS0pe1xuXHRcdFx0YWogPSBhamF4RG93bmxvYWRzLnBvcCgpO1xuXHRcdFx0YWouYWJvcnQoKTtcblx0XHR9XG5cdH1cblxuXG5cdC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XG5cdC8qKlxuXHQqIEJlZ2luIGV4ZWN1dGlvbiBvZiB0aGUgdGVzdFxuXHQqL1xuXHRmdW5jdGlvbiBiZWdpblRlc3QoYmFpdCl7XG5cdFx0bG9nKCdzdGFydCBiZWdpblRlc3QnKTtcblx0XHRpZihmaW5kUmVzdWx0ID09IHRydWUpe1xuXHRcdFx0cmV0dXJuOyAvLyB3ZSBmb3VuZCBpdC4gZG9uJ3QgY29udGludWUgZXhlY3V0aW5nXG5cdFx0fVxuXHRcdHRlc3RFeGVjdXRpbmcgPSB0cnVlO1xuXHRcdGNhc3RCYWl0KGJhaXQpO1xuXG5cdFx0ZXhlUmVzdWx0LnF1aWNrID0gJ3Rlc3RpbmcnO1xuXG5cdFx0dGltZXJJZHMudGVzdCA9IHNldFRpbWVvdXQoXG5cdFx0XHRmdW5jdGlvbigpeyByZWVsSW4oYmFpdCwgMSk7IH0sXG5cdFx0XHQ1KTtcblx0fVxuXG5cdC8qKlxuXHQqIENyZWF0ZSB0aGUgYmFpdCBub2RlIHRvIHNlZSBob3cgdGhlIGJyb3dzZXIgcGFnZSByZWFjdHNcblx0Ki9cblx0ZnVuY3Rpb24gY2FzdEJhaXQoYmFpdCl7XG5cdFx0dmFyIGksIGQgPSBkb2N1bWVudCwgYiA9IGQuYm9keTtcblx0XHR2YXIgdDtcblx0XHR2YXIgYmFpdFN0eWxlID0gJ3dpZHRoOiAxcHggIWltcG9ydGFudDsgaGVpZ2h0OiAxcHggIWltcG9ydGFudDsgcG9zaXRpb246IGFic29sdXRlICFpbXBvcnRhbnQ7IGxlZnQ6IC0xMDAwMHB4ICFpbXBvcnRhbnQ7IHRvcDogLTEwMDBweCAhaW1wb3J0YW50OydcblxuXHRcdGlmKGJhaXQgPT0gbnVsbCB8fCB0eXBlb2YoYmFpdCkgPT0gJ3N0cmluZycpe1xuXHRcdFx0bG9nKCdpbnZhbGlkIGJhaXQgYmVpbmcgY2FzdCcpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdGlmKGJhaXQuc3R5bGUgIT0gbnVsbCl7XG5cdFx0XHRiYWl0U3R5bGUgKz0gYmFpdC5zdHlsZTtcblx0XHR9XG5cblx0XHRiYWl0Tm9kZSA9IG1ha2VFbCgnZGl2Jywge1xuXHRcdFx0J2NsYXNzJzogYmFpdC5jc3NDbGFzcyxcblx0XHRcdCdzdHlsZSc6IGJhaXRTdHlsZVxuXHRcdH0pO1xuXG5cdFx0bG9nKCdhZGRpbmcgYmFpdCBub2RlIHRvIERPTScpO1xuXG5cdFx0Yi5hcHBlbmRDaGlsZChiYWl0Tm9kZSk7XG5cblx0XHQvLyB0b3VjaCB0aGVzZSBwcm9wZXJ0aWVzXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy5udWxsUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHR0ID0gYmFpdE5vZGVbYmFpdFRyaWdnZXJzLm51bGxQcm9wc1tpXV07XG5cdFx0fVxuXHRcdGZvcihpPTA7aTxiYWl0VHJpZ2dlcnMuemVyb1Byb3BzLmxlbmd0aDtpKyspe1xuXHRcdFx0dCA9IGJhaXROb2RlW2JhaXRUcmlnZ2Vycy56ZXJvUHJvcHNbaV1dO1xuXHRcdH1cblx0fVxuXG5cdC8qKlxuXHQqIFJ1biB0ZXN0cyB0byBzZWUgaWYgYnJvd3NlciBoYXMgdGFrZW4gdGhlIGJhaXQgYW5kIGJsb2NrZWQgdGhlIGJhaXQgZWxlbWVudFxuXHQqL1xuXHRmdW5jdGlvbiByZWVsSW4oYmFpdCwgYXR0ZW1wdE51bSl7XG5cdFx0dmFyIGksIGssIHY7XG5cdFx0dmFyIGJvZHkgPSBkb2N1bWVudC5ib2R5O1xuXHRcdHZhciBmb3VuZCA9IGZhbHNlO1xuXG5cdFx0aWYoYmFpdE5vZGUgPT0gbnVsbCl7XG5cdFx0XHRsb2coJ3JlY2FzdCBiYWl0Jyk7XG5cdFx0XHRjYXN0QmFpdChiYWl0IHx8IHF1aWNrQmFpdCk7XG5cdFx0fVxuXG5cdFx0aWYodHlwZW9mKGJhaXQpID09ICdzdHJpbmcnKXtcblx0XHRcdGxvZygnaW52YWxpZCBiYWl0IHVzZWQnLCB0cnVlKTtcblx0XHRcdGlmKGNsZWFyQmFpdE5vZGUoKSl7XG5cdFx0XHRcdHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cdFx0XHRcdH0sIDUpO1xuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0aWYodGltZXJJZHMudGVzdCA+IDApe1xuXHRcdFx0Y2xlYXJUaW1lb3V0KHRpbWVySWRzLnRlc3QpO1xuXHRcdFx0dGltZXJJZHMudGVzdCA9IDA7XG5cdFx0fVxuXG5cdFx0Ly8gdGVzdCBmb3IgaXNzdWVzXG5cblx0XHRpZihib2R5LmdldEF0dHJpYnV0ZSgnYWJwJykgIT09IG51bGwpe1xuXHRcdFx0bG9nKCdmb3VuZCBhZGJsb2NrIGJvZHkgYXR0cmlidXRlJyk7XG5cdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0fVxuXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy5udWxsUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHRpZihiYWl0Tm9kZVtiYWl0VHJpZ2dlcnMubnVsbFByb3BzW2ldXSA9PSBudWxsKXtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayBudWxsIGF0dHI6ICcgKyBiYWl0VHJpZ2dlcnMubnVsbFByb3BzW2ldKTtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0XHRpZihmb3VuZCA9PSB0cnVlKXtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHRpZihmb3VuZCA9PSB0cnVlKXtcblx0XHRcdFx0YnJlYWs7XG5cdFx0XHR9XG5cdFx0XHRpZihiYWl0Tm9kZVtiYWl0VHJpZ2dlcnMuemVyb1Byb3BzW2ldXSA9PSAwKXtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayB6ZXJvIGF0dHI6ICcgKyBiYWl0VHJpZ2dlcnMuemVyb1Byb3BzW2ldKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRpZih3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSAhPT0gdW5kZWZpbmVkKSB7XG5cdFx0XHR2YXIgYmFpdFRlbXAgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShiYWl0Tm9kZSwgbnVsbCk7XG5cdFx0XHRpZihiYWl0VGVtcC5nZXRQcm9wZXJ0eVZhbHVlKCdkaXNwbGF5JykgPT0gJ25vbmUnXG5cdFx0XHR8fCBiYWl0VGVtcC5nZXRQcm9wZXJ0eVZhbHVlKCd2aXNpYmlsaXR5JykgPT0gJ2hpZGRlbicpIHtcblx0XHRcdFx0aWYoYXR0ZW1wdE51bT40KVxuXHRcdFx0XHRmb3VuZCA9IHRydWU7XG5cdFx0XHRcdGxvZygnZm91bmQgYWRibG9jayBjb21wdXRlZFN0eWxlIGluZGljYXRvcicpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHRlc3RlZE9uY2UgPSB0cnVlO1xuXG5cdFx0aWYoZm91bmQgfHwgYXR0ZW1wdE51bSsrID49IF9vcHRpb25zLm1heExvb3Ape1xuXHRcdFx0ZmluZFJlc3VsdCA9IGZvdW5kO1xuXHRcdFx0bG9nKCdleGl0aW5nIHRlc3QgbG9vcCAtIHZhbHVlOiAnICsgZmluZFJlc3VsdCk7XG5cdFx0XHRub3RpZnlMaXN0ZW5lcnMoKTtcblx0XHRcdGlmKGNsZWFyQmFpdE5vZGUoKSl7XG5cdFx0XHRcdHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0XHR0ZXN0RXhlY3V0aW5nID0gZmFsc2U7XG5cdFx0XHRcdH0sIDUpO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRlbHNle1xuXHRcdFx0dGltZXJJZHMudGVzdCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKXtcblx0XHRcdFx0cmVlbEluKGJhaXQsIGF0dGVtcHROdW0pO1xuXHRcdFx0fSwgX29wdGlvbnMubG9vcERlbGF5KTtcblx0XHR9XG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckJhaXROb2RlKCl7XG5cdFx0aWYoYmFpdE5vZGUgPT09IG51bGwpe1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fVxuXG5cdFx0dHJ5e1xuXHRcdFx0aWYoaXNGdW5jKGJhaXROb2RlLnJlbW92ZSkpe1xuXHRcdFx0XHRiYWl0Tm9kZS5yZW1vdmUoKTtcblx0XHRcdH1cblx0XHRcdGRvY3VtZW50LmJvZHkucmVtb3ZlQ2hpbGQoYmFpdE5vZGUpO1xuXHRcdH1cblx0XHRjYXRjaChleCl7XG5cdFx0fVxuXHRcdGJhaXROb2RlID0gbnVsbDtcblxuXHRcdHJldHVybiB0cnVlO1xuXHR9XG5cblx0LyoqXG5cdCogSGFsdCB0aGUgdGVzdCBhbmQgYW55IHBlbmRpbmcgdGltZW91dHNcblx0Ki9cblx0ZnVuY3Rpb24gc3RvcEZpc2hpbmcoKXtcblx0XHRpZih0aW1lcklkcy50ZXN0ID4gMCl7XG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXJJZHMudGVzdCk7XG5cdFx0fVxuXHRcdGlmKHRpbWVySWRzLmRvd25sb2FkID4gMCl7XG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXJJZHMuZG93bmxvYWQpO1xuXHRcdH1cblxuXHRcdGNhbmNlbFJlbW90ZURvd25sb2FkcygpO1xuXG5cdFx0Y2xlYXJCYWl0Tm9kZSgpO1xuXHR9XG5cblx0LyoqXG5cdCogRmlyZSBhbGwgcmVnaXN0ZXJlZCBsaXN0ZW5lcnNcblx0Ki9cblx0ZnVuY3Rpb24gbm90aWZ5TGlzdGVuZXJzKCl7XG5cdFx0dmFyIGksIGZ1bmNzO1xuXHRcdGlmKGZpbmRSZXN1bHQgPT09IG51bGwpe1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0XHRmb3IoaT0wO2k8bGlzdGVuZXJzLmxlbmd0aDtpKyspe1xuXHRcdFx0ZnVuY3MgPSBsaXN0ZW5lcnNbaV07XG5cdFx0XHR0cnl7XG5cdFx0XHRcdGlmKGZ1bmNzICE9IG51bGwpe1xuXHRcdFx0XHRcdGlmKGlzRnVuYyhmdW5jc1snY29tcGxldGUnXSkpe1xuXHRcdFx0XHRcdFx0ZnVuY3NbJ2NvbXBsZXRlJ10oZmluZFJlc3VsdCk7XG5cdFx0XHRcdFx0fVxuXG5cdFx0XHRcdFx0aWYoZmluZFJlc3VsdCAmJiBpc0Z1bmMoZnVuY3NbJ2ZvdW5kJ10pKXtcblx0XHRcdFx0XHRcdGZ1bmNzWydmb3VuZCddKCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGVsc2UgaWYoZmluZFJlc3VsdCA9PT0gZmFsc2UgJiYgaXNGdW5jKGZ1bmNzWydub3Rmb3VuZCddKSl7XG5cdFx0XHRcdFx0XHRmdW5jc1snbm90Zm91bmQnXSgpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdFx0Y2F0Y2goZXgpe1xuXHRcdFx0XHRsb2coJ0ZhaWx1cmUgaW4gbm90aWZ5IGxpc3RlbmVycyAnICsgZXguTWVzc2FnZSwgdHJ1ZSk7XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0LyoqXG5cdCogQXR0YWNoZXMgZXZlbnQgbGlzdGVuZXIgb3IgZmlyZXMgaWYgZXZlbnRzIGhhdmUgYWxyZWFkeSBwYXNzZWQuXG5cdCovXG5cdGZ1bmN0aW9uIGF0dGFjaE9yRmlyZSgpe1xuXHRcdHZhciBmaXJlTm93ID0gZmFsc2U7XG5cdFx0dmFyIGZuO1xuXG5cdFx0aWYoZG9jdW1lbnQucmVhZHlTdGF0ZSl7XG5cdFx0XHRpZihkb2N1bWVudC5yZWFkeVN0YXRlID09ICdjb21wbGV0ZScpe1xuXHRcdFx0XHRmaXJlTm93ID0gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmbiA9IGZ1bmN0aW9uKCl7XG5cdFx0XHRiZWdpblRlc3QocXVpY2tCYWl0LCBmYWxzZSk7XG5cdFx0fVxuXG5cdFx0aWYoZmlyZU5vdyl7XG5cdFx0XHRmbigpO1xuXHRcdH1cblx0XHRlbHNle1xuXHRcdFx0YXR0YWNoRXZlbnRMaXN0ZW5lcih3aW4sICdsb2FkJywgZm4pO1xuXHRcdH1cblx0fVxuXG5cblx0dmFyIGJsb2NrTGlzdHM7IC8vIHRyYWNrcyBleHRlcm5hbCBibG9jayBsaXN0c1xuXG5cdC8qKlxuXHQqIFB1YmxpYyBpbnRlcmZhY2Ugb2YgYWRibG9jayBkZXRlY3RvclxuXHQqL1xuXHR2YXIgaW1wbCA9IHtcblx0XHQvKipcblx0XHQqIFZlcnNpb24gb2YgdGhlIGFkYmxvY2sgZGV0ZWN0b3IgcGFja2FnZVxuXHRcdCovXG5cdFx0dmVyc2lvbjogdmVyc2lvbixcblxuXHRcdC8qKlxuXHRcdCogSW5pdGlhbGl6YXRpb24gZnVuY3Rpb24uIFNlZSBjb21tZW50cyBhdCB0b3AgZm9yIG9wdGlvbnMgb2JqZWN0XG5cdFx0Ki9cblx0XHRpbml0OiBmdW5jdGlvbihvcHRpb25zKXtcblx0XHRcdHZhciBrLCB2LCBmdW5jcztcblxuXHRcdFx0aWYoIW9wdGlvbnMpe1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGZ1bmNzID0ge1xuXHRcdFx0XHRjb21wbGV0ZTogbm9vcCxcblx0XHRcdFx0Zm91bmQ6IG5vb3AsXG5cdFx0XHRcdG5vdGZvdW5kOiBub29wXG5cdFx0XHR9O1xuXG5cdFx0XHRmb3IoayBpbiBvcHRpb25zKXtcblx0XHRcdFx0aWYob3B0aW9ucy5oYXNPd25Qcm9wZXJ0eShrKSl7XG5cdFx0XHRcdFx0aWYoayA9PSAnY29tcGxldGUnIHx8IGsgPT0gJ2ZvdW5kJyB8fCBrID09ICdub3RGb3VuZCcpe1xuXHRcdFx0XHRcdFx0ZnVuY3Nbay50b0xvd2VyQ2FzZSgpXSA9IG9wdGlvbnNba107XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGVsc2V7XG5cdFx0XHRcdFx0XHRfb3B0aW9uc1trXSA9IG9wdGlvbnNba107XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGxpc3RlbmVycy5wdXNoKGZ1bmNzKTtcblxuXHRcdFx0YmxvY2tMaXN0cyA9IG5ldyBCbG9ja0xpc3RUcmFja2VyKCk7XG5cblx0XHRcdGF0dGFjaE9yRmlyZSgpO1xuXHRcdH1cblx0fVxuXG5cdHdpblsnYWRibG9ja0RldGVjdG9yJ10gPSBpbXBsO1xuXG59KSh3aW5kb3cpXG4iLCIoZnVuY3Rpb24oKXt2YXIgZyxhYT1cImZ1bmN0aW9uXCI9PXR5cGVvZiBPYmplY3QuZGVmaW5lUHJvcGVydGllcz9PYmplY3QuZGVmaW5lUHJvcGVydHk6ZnVuY3Rpb24oYSxiLGMpe2lmKGMuZ2V0fHxjLnNldCl0aHJvdyBuZXcgVHlwZUVycm9yKFwiRVMzIGRvZXMgbm90IHN1cHBvcnQgZ2V0dGVycyBhbmQgc2V0dGVycy5cIik7YSE9QXJyYXkucHJvdG90eXBlJiZhIT1PYmplY3QucHJvdG90eXBlJiYoYVtiXT1jLnZhbHVlKX0saz1cInVuZGVmaW5lZFwiIT10eXBlb2Ygd2luZG93JiZ3aW5kb3c9PT10aGlzP3RoaXM6XCJ1bmRlZmluZWRcIiE9dHlwZW9mIGdsb2JhbCYmbnVsbCE9Z2xvYmFsP2dsb2JhbDp0aGlzO2Z1bmN0aW9uIGwoKXtsPWZ1bmN0aW9uKCl7fTtrLlN5bWJvbHx8KGsuU3ltYm9sPWJhKX12YXIgY2E9MDtmdW5jdGlvbiBiYShhKXtyZXR1cm5cImpzY29tcF9zeW1ib2xfXCIrKGF8fFwiXCIpK2NhKyt9XG5mdW5jdGlvbiBtKCl7bCgpO3ZhciBhPWsuU3ltYm9sLml0ZXJhdG9yO2F8fChhPWsuU3ltYm9sLml0ZXJhdG9yPWsuU3ltYm9sKFwiaXRlcmF0b3JcIikpO1wiZnVuY3Rpb25cIiE9dHlwZW9mIEFycmF5LnByb3RvdHlwZVthXSYmYWEoQXJyYXkucHJvdG90eXBlLGEse2NvbmZpZ3VyYWJsZTohMCx3cml0YWJsZTohMCx2YWx1ZTpmdW5jdGlvbigpe3JldHVybiBkYSh0aGlzKX19KTttPWZ1bmN0aW9uKCl7fX1mdW5jdGlvbiBkYShhKXt2YXIgYj0wO3JldHVybiBlYShmdW5jdGlvbigpe3JldHVybiBiPGEubGVuZ3RoP3tkb25lOiExLHZhbHVlOmFbYisrXX06e2RvbmU6ITB9fSl9ZnVuY3Rpb24gZWEoYSl7bSgpO2E9e25leHQ6YX07YVtrLlN5bWJvbC5pdGVyYXRvcl09ZnVuY3Rpb24oKXtyZXR1cm4gdGhpc307cmV0dXJuIGF9ZnVuY3Rpb24gZmEoYSl7bSgpO2woKTttKCk7dmFyIGI9YVtTeW1ib2wuaXRlcmF0b3JdO3JldHVybiBiP2IuY2FsbChhKTpkYShhKX1cbmZ1bmN0aW9uIG4oYSl7aWYoIShhIGluc3RhbmNlb2YgQXJyYXkpKXthPWZhKGEpO2Zvcih2YXIgYixjPVtdOyEoYj1hLm5leHQoKSkuZG9uZTspYy5wdXNoKGIudmFsdWUpO2E9Y31yZXR1cm4gYX1mdW5jdGlvbiBoYShhLGIpe2Z1bmN0aW9uIGMoKXt9Yy5wcm90b3R5cGU9Yi5wcm90b3R5cGU7YS5oYT1iLnByb3RvdHlwZTthLnByb3RvdHlwZT1uZXcgYzthLnByb3RvdHlwZS5jb25zdHJ1Y3Rvcj1hO2Zvcih2YXIgZCBpbiBiKWlmKE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKXt2YXIgZT1PYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKGIsZCk7ZSYmT2JqZWN0LmRlZmluZVByb3BlcnR5KGEsZCxlKX1lbHNlIGFbZF09YltkXX12YXIgcD13aW5kb3cuRWxlbWVudC5wcm90b3R5cGUsaWE9cC5tYXRjaGVzfHxwLm1hdGNoZXNTZWxlY3Rvcnx8cC53ZWJraXRNYXRjaGVzU2VsZWN0b3J8fHAubW96TWF0Y2hlc1NlbGVjdG9yfHxwLm1zTWF0Y2hlc1NlbGVjdG9yfHxwLm9NYXRjaGVzU2VsZWN0b3I7XG5mdW5jdGlvbiBqYShhLGIpe2lmKGEmJjE9PWEubm9kZVR5cGUmJmIpe2lmKFwic3RyaW5nXCI9PXR5cGVvZiBifHwxPT1iLm5vZGVUeXBlKXJldHVybiBhPT1ifHxrYShhLGIpO2lmKFwibGVuZ3RoXCJpbiBiKWZvcih2YXIgYz0wLGQ7ZD1iW2NdO2MrKylpZihhPT1kfHxrYShhLGQpKXJldHVybiEwfXJldHVybiExfWZ1bmN0aW9uIGthKGEsYil7aWYoXCJzdHJpbmdcIiE9dHlwZW9mIGIpcmV0dXJuITE7aWYoaWEpcmV0dXJuIGlhLmNhbGwoYSxiKTtiPWEucGFyZW50Tm9kZS5xdWVyeVNlbGVjdG9yQWxsKGIpO2Zvcih2YXIgYz0wLGQ7ZD1iW2NdO2MrKylpZihkPT1hKXJldHVybiEwO3JldHVybiExfWZ1bmN0aW9uIGxhKGEpe2Zvcih2YXIgYj1bXTthJiZhLnBhcmVudE5vZGUmJjE9PWEucGFyZW50Tm9kZS5ub2RlVHlwZTspYT1hLnBhcmVudE5vZGUsYi5wdXNoKGEpO3JldHVybiBifVxuZnVuY3Rpb24gcShhLGIsYyl7ZnVuY3Rpb24gZChhKXt2YXIgZDtpZihoLmNvbXBvc2VkJiZcImZ1bmN0aW9uXCI9PXR5cGVvZiBhLmNvbXBvc2VkUGF0aClmb3IodmFyIGU9YS5jb21wb3NlZFBhdGgoKSxmPTAsRjtGPWVbZl07ZisrKTE9PUYubm9kZVR5cGUmJmphKEYsYikmJihkPUYpO2Vsc2UgYTp7aWYoKGQ9YS50YXJnZXQpJiYxPT1kLm5vZGVUeXBlJiZiKWZvcihkPVtkXS5jb25jYXQobGEoZCkpLGU9MDtmPWRbZV07ZSsrKWlmKGphKGYsYikpe2Q9ZjticmVhayBhfWQ9dm9pZCAwfWQmJmMuY2FsbChkLGEsZCl9dmFyIGU9ZG9jdW1lbnQsaD17Y29tcG9zZWQ6ITAsUzohMH0saD12b2lkIDA9PT1oP3t9Omg7ZS5hZGRFdmVudExpc3RlbmVyKGEsZCxoLlMpO3JldHVybntqOmZ1bmN0aW9uKCl7ZS5yZW1vdmVFdmVudExpc3RlbmVyKGEsZCxoLlMpfX19XG5mdW5jdGlvbiBtYShhKXt2YXIgYj17fTtpZighYXx8MSE9YS5ub2RlVHlwZSlyZXR1cm4gYjthPWEuYXR0cmlidXRlcztpZighYS5sZW5ndGgpcmV0dXJue307Zm9yKHZhciBjPTAsZDtkPWFbY107YysrKWJbZC5uYW1lXT1kLnZhbHVlO3JldHVybiBifXZhciBuYT0vOig4MHw0NDMpJC8scj1kb2N1bWVudC5jcmVhdGVFbGVtZW50KFwiYVwiKSx0PXt9O1xuZnVuY3Rpb24gdShhKXthPWEmJlwiLlwiIT1hP2E6bG9jYXRpb24uaHJlZjtpZih0W2FdKXJldHVybiB0W2FdO3IuaHJlZj1hO2lmKFwiLlwiPT1hLmNoYXJBdCgwKXx8XCIvXCI9PWEuY2hhckF0KDApKXJldHVybiB1KHIuaHJlZik7dmFyIGI9XCI4MFwiPT1yLnBvcnR8fFwiNDQzXCI9PXIucG9ydD9cIlwiOnIucG9ydCxiPVwiMFwiPT1iP1wiXCI6YixjPXIuaG9zdC5yZXBsYWNlKG5hLFwiXCIpO3JldHVybiB0W2FdPXtoYXNoOnIuaGFzaCxob3N0OmMsaG9zdG5hbWU6ci5ob3N0bmFtZSxocmVmOnIuaHJlZixvcmlnaW46ci5vcmlnaW4/ci5vcmlnaW46ci5wcm90b2NvbCtcIi8vXCIrYyxwYXRobmFtZTpcIi9cIj09ci5wYXRobmFtZS5jaGFyQXQoMCk/ci5wYXRobmFtZTpcIi9cIityLnBhdGhuYW1lLHBvcnQ6Yixwcm90b2NvbDpyLnByb3RvY29sLHNlYXJjaDpyLnNlYXJjaH19dmFyIHc9W107XG5mdW5jdGlvbiBvYShhLGIpe3ZhciBjPXRoaXM7dGhpcy5jb250ZXh0PWE7dGhpcy5QPWI7dGhpcy5mPSh0aGlzLmM9L1Rhc2skLy50ZXN0KGIpKT9hLmdldChiKTphW2JdO3RoaXMuYj1bXTt0aGlzLmE9W107dGhpcy5nPWZ1bmN0aW9uKGEpe2Zvcih2YXIgYj1bXSxkPTA7ZDxhcmd1bWVudHMubGVuZ3RoOysrZCliW2QtMF09YXJndW1lbnRzW2RdO3JldHVybiBjLmFbYy5hLmxlbmd0aC0xXS5hcHBseShudWxsLFtdLmNvbmNhdChuKGIpKSl9O3RoaXMuYz9hLnNldChiLHRoaXMuZyk6YVtiXT10aGlzLmd9ZnVuY3Rpb24geChhLGIsYyl7YT1wYShhLGIpO2EuYi5wdXNoKGMpO3FhKGEpfWZ1bmN0aW9uIHkoYSxiLGMpe2E9cGEoYSxiKTtjPWEuYi5pbmRleE9mKGMpOy0xPGMmJihhLmIuc3BsaWNlKGMsMSksMDxhLmIubGVuZ3RoP3FhKGEpOmEuaigpKX1cbmZ1bmN0aW9uIHFhKGEpe2EuYT1bXTtmb3IodmFyIGIsYz0wO2I9YS5iW2NdO2MrKyl7dmFyIGQ9YS5hW2MtMV18fGEuZi5iaW5kKGEuY29udGV4dCk7YS5hLnB1c2goYihkKSl9fW9hLnByb3RvdHlwZS5qPWZ1bmN0aW9uKCl7dmFyIGE9dy5pbmRleE9mKHRoaXMpOy0xPGEmJih3LnNwbGljZShhLDEpLHRoaXMuYz90aGlzLmNvbnRleHQuc2V0KHRoaXMuUCx0aGlzLmYpOnRoaXMuY29udGV4dFt0aGlzLlBdPXRoaXMuZil9O2Z1bmN0aW9uIHBhKGEsYil7dmFyIGM9dy5maWx0ZXIoZnVuY3Rpb24oYyl7cmV0dXJuIGMuY29udGV4dD09YSYmYy5QPT1ifSlbMF07Y3x8KGM9bmV3IG9hKGEsYiksdy5wdXNoKGMpKTtyZXR1cm4gY31cbmZ1bmN0aW9uIHooYSxiLGMsZCxlLGgpe2lmKFwiZnVuY3Rpb25cIj09dHlwZW9mIGQpe3ZhciBmPWMuZ2V0KFwiYnVpbGRIaXRUYXNrXCIpO3JldHVybntidWlsZEhpdFRhc2s6ZnVuY3Rpb24oYyl7Yy5zZXQoYSxudWxsLCEwKTtjLnNldChiLG51bGwsITApO2QoYyxlLGgpO2YoYyl9fX1yZXR1cm4gQSh7fSxhLGIpfWZ1bmN0aW9uIEIoYSxiKXt2YXIgYz1tYShhKSxkPXt9O09iamVjdC5rZXlzKGMpLmZvckVhY2goZnVuY3Rpb24oYSl7aWYoIWEuaW5kZXhPZihiKSYmYSE9YitcIm9uXCIpe3ZhciBlPWNbYV07XCJ0cnVlXCI9PWUmJihlPSEwKTtcImZhbHNlXCI9PWUmJihlPSExKTthPXJhKGEuc2xpY2UoYi5sZW5ndGgpKTtkW2FdPWV9fSk7cmV0dXJuIGR9XG5mdW5jdGlvbiBzYShhKXtcImxvYWRpbmdcIj09ZG9jdW1lbnQucmVhZHlTdGF0ZT9kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLGZ1bmN0aW9uIGMoKXtkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwiRE9NQ29udGVudExvYWRlZFwiLGMpO2EoKX0pOmEoKX1mdW5jdGlvbiB0YShhLGIpe3ZhciBjO3JldHVybiBmdW5jdGlvbihkKXtmb3IodmFyIGU9W10saD0wO2g8YXJndW1lbnRzLmxlbmd0aDsrK2gpZVtoLTBdPWFyZ3VtZW50c1toXTtjbGVhclRpbWVvdXQoYyk7Yz1zZXRUaW1lb3V0KGZ1bmN0aW9uKCl7cmV0dXJuIGEuYXBwbHkobnVsbCxbXS5jb25jYXQobihlKSkpfSxiKX19ZnVuY3Rpb24gdWEoYSl7ZnVuY3Rpb24gYigpe2N8fChjPSEwLGEoKSl9dmFyIGM9ITE7c2V0VGltZW91dChiLDJFMyk7cmV0dXJuIGJ9dmFyIEM9e307XG5mdW5jdGlvbiB2YShhLGIpe2Z1bmN0aW9uIGMoKXtjbGVhclRpbWVvdXQoZS50aW1lb3V0KTtlLnNlbmQmJnkoYSxcInNlbmRcIixlLnNlbmQpO2RlbGV0ZSBDW2RdO2UuUi5mb3JFYWNoKGZ1bmN0aW9uKGEpe3JldHVybiBhKCl9KX12YXIgZD1hLmdldChcInRyYWNraW5nSWRcIiksZT1DW2RdPUNbZF18fHt9O2NsZWFyVGltZW91dChlLnRpbWVvdXQpO2UudGltZW91dD1zZXRUaW1lb3V0KGMsMCk7ZS5SPWUuUnx8W107ZS5SLnB1c2goYik7ZS5zZW5kfHwoZS5zZW5kPWZ1bmN0aW9uKGEpe3JldHVybiBmdW5jdGlvbihiKXtmb3IodmFyIGQ9W10sZT0wO2U8YXJndW1lbnRzLmxlbmd0aDsrK2UpZFtlLTBdPWFyZ3VtZW50c1tlXTtjKCk7YS5hcHBseShudWxsLFtdLmNvbmNhdChuKGQpKSl9fSx4KGEsXCJzZW5kXCIsZS5zZW5kKSl9XG52YXIgQT1PYmplY3QuYXNzaWdufHxmdW5jdGlvbihhLGIpe2Zvcih2YXIgYz1bXSxkPTE7ZDxhcmd1bWVudHMubGVuZ3RoOysrZCljW2QtMV09YXJndW1lbnRzW2RdO2Zvcih2YXIgZD0wLGU9Yy5sZW5ndGg7ZDxlO2QrKyl7dmFyIGg9T2JqZWN0KGNbZF0pLGY7Zm9yKGYgaW4gaClPYmplY3QucHJvdG90eXBlLmhhc093blByb3BlcnR5LmNhbGwoaCxmKSYmKGFbZl09aFtmXSl9cmV0dXJuIGF9O2Z1bmN0aW9uIHJhKGEpe3JldHVybiBhLnJlcGxhY2UoL1tcXC1cXF9dKyhcXHc/KS9nLGZ1bmN0aW9uKGEsYyl7cmV0dXJuIGMudG9VcHBlckNhc2UoKX0pfWZ1bmN0aW9uIEQoYSl7cmV0dXJuXCJvYmplY3RcIj09dHlwZW9mIGEmJm51bGwhPT1hfXZhciBFPWZ1bmN0aW9uIHdhKGIpe3JldHVybiBiPyhiXjE2Kk1hdGgucmFuZG9tKCk+PmIvNCkudG9TdHJpbmcoMTYpOlwiMTAwMDAwMDAtMTAwMC00MDAwLTgwMDAtMTAwMDAwMDAwMDAwXCIucmVwbGFjZSgvWzAxOF0vZyx3YSl9O1xuZnVuY3Rpb24gRyhhLGIpe3ZhciBjPXdpbmRvdy5Hb29nbGVBbmFseXRpY3NPYmplY3R8fFwiZ2FcIjt3aW5kb3dbY109d2luZG93W2NdfHxmdW5jdGlvbihhKXtmb3IodmFyIGI9W10sZD0wO2Q8YXJndW1lbnRzLmxlbmd0aDsrK2QpYltkLTBdPWFyZ3VtZW50c1tkXTsod2luZG93W2NdLnE9d2luZG93W2NdLnF8fFtdKS5wdXNoKGIpfTt3aW5kb3cuZ2FEZXZJZHM9d2luZG93LmdhRGV2SWRzfHxbXTswPndpbmRvdy5nYURldklkcy5pbmRleE9mKFwiaTVpU2pvXCIpJiZ3aW5kb3cuZ2FEZXZJZHMucHVzaChcImk1aVNqb1wiKTt3aW5kb3dbY10oXCJwcm92aWRlXCIsYSxiKTt3aW5kb3cuZ2FwbHVnaW5zPXdpbmRvdy5nYXBsdWdpbnN8fHt9O3dpbmRvdy5nYXBsdWdpbnNbYS5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSthLnNsaWNlKDEpXT1ifXZhciBIPXtUOjEsVToyLFY6MyxYOjQsWTo1LFo6NiwkOjcsYWE6OCxiYTo5LFc6MTB9LEk9T2JqZWN0LmtleXMoSCkubGVuZ3RoO1xuZnVuY3Rpb24gSihhLGIpe2Euc2V0KFwiXFx4MjZfYXZcIixcIjIuNC4xXCIpO3ZhciBjPWEuZ2V0KFwiXFx4MjZfYXVcIiksYz1wYXJzZUludChjfHxcIjBcIiwxNikudG9TdHJpbmcoMik7aWYoYy5sZW5ndGg8SSlmb3IodmFyIGQ9SS1jLmxlbmd0aDtkOyljPVwiMFwiK2MsZC0tO2I9SS1iO2M9Yy5zdWJzdHIoMCxiKSsxK2Muc3Vic3RyKGIrMSk7YS5zZXQoXCJcXHgyNl9hdVwiLHBhcnNlSW50KGN8fFwiMFwiLDIpLnRvU3RyaW5nKDE2KSl9ZnVuY3Rpb24gSyhhLGIpe0ooYSxILlQpO3RoaXMuYT1BKHt9LGIpO3RoaXMuZz1hO3RoaXMuYj10aGlzLmEuc3RyaXBRdWVyeSYmdGhpcy5hLnF1ZXJ5RGltZW5zaW9uSW5kZXg/XCJkaW1lbnNpb25cIit0aGlzLmEucXVlcnlEaW1lbnNpb25JbmRleDpudWxsO3RoaXMuZj10aGlzLmYuYmluZCh0aGlzKTt0aGlzLmM9dGhpcy5jLmJpbmQodGhpcyk7eChhLFwiZ2V0XCIsdGhpcy5mKTt4KGEsXCJidWlsZEhpdFRhc2tcIix0aGlzLmMpfVxuSy5wcm90b3R5cGUuZj1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjKXtpZihcInBhZ2VcIj09Y3x8Yz09Yi5iKXt2YXIgZD17bG9jYXRpb246YShcImxvY2F0aW9uXCIpLHBhZ2U6YShcInBhZ2VcIil9O3JldHVybiB4YShiLGQpW2NdfXJldHVybiBhKGMpfX07Sy5wcm90b3R5cGUuYz1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjKXt2YXIgZD14YShiLHtsb2NhdGlvbjpjLmdldChcImxvY2F0aW9uXCIpLHBhZ2U6Yy5nZXQoXCJwYWdlXCIpfSk7Yy5zZXQoZCxudWxsLCEwKTthKGMpfX07XG5mdW5jdGlvbiB4YShhLGIpe3ZhciBjPXUoYi5wYWdlfHxiLmxvY2F0aW9uKSxkPWMucGF0aG5hbWU7aWYoYS5hLmluZGV4RmlsZW5hbWUpe3ZhciBlPWQuc3BsaXQoXCIvXCIpO2EuYS5pbmRleEZpbGVuYW1lPT1lW2UubGVuZ3RoLTFdJiYoZVtlLmxlbmd0aC0xXT1cIlwiLGQ9ZS5qb2luKFwiL1wiKSl9XCJyZW1vdmVcIj09YS5hLnRyYWlsaW5nU2xhc2g/ZD1kLnJlcGxhY2UoL1xcLyskLyxcIlwiKTpcImFkZFwiPT1hLmEudHJhaWxpbmdTbGFzaCYmKC9cXC5cXHcrJC8udGVzdChkKXx8XCIvXCI9PWQuc3Vic3RyKC0xKXx8KGQrPVwiL1wiKSk7ZD17cGFnZTpkKyhhLmEuc3RyaXBRdWVyeT95YShhLGMuc2VhcmNoKTpjLnNlYXJjaCl9O2IubG9jYXRpb24mJihkLmxvY2F0aW9uPWIubG9jYXRpb24pO2EuYiYmKGRbYS5iXT1jLnNlYXJjaC5zbGljZSgxKXx8XCIobm90IHNldClcIik7cmV0dXJuXCJmdW5jdGlvblwiPT10eXBlb2YgYS5hLnVybEZpZWxkc0ZpbHRlcj8oYj1hLmEudXJsRmllbGRzRmlsdGVyKGQsdSksYz17cGFnZTpiLnBhZ2UsXG5sb2NhdGlvbjpiLmxvY2F0aW9ufSxhLmImJihjW2EuYl09YlthLmJdKSxjKTpkfWZ1bmN0aW9uIHlhKGEsYil7aWYoQXJyYXkuaXNBcnJheShhLmEucXVlcnlQYXJhbXNXaGl0ZWxpc3QpKXt2YXIgYz1bXTtiLnNsaWNlKDEpLnNwbGl0KFwiXFx4MjZcIikuZm9yRWFjaChmdW5jdGlvbihiKXt2YXIgZD1mYShiLnNwbGl0KFwiXFx4M2RcIikpO2I9ZC5uZXh0KCkudmFsdWU7ZD1kLm5leHQoKS52YWx1ZTstMTxhLmEucXVlcnlQYXJhbXNXaGl0ZWxpc3QuaW5kZXhPZihiKSYmZCYmYy5wdXNoKFtiLGRdKX0pO3JldHVybiBjLmxlbmd0aD9cIj9cIitjLm1hcChmdW5jdGlvbihhKXtyZXR1cm4gYS5qb2luKFwiXFx4M2RcIil9KS5qb2luKFwiXFx4MjZcIik6XCJcIn1yZXR1cm5cIlwifUsucHJvdG90eXBlLnJlbW92ZT1mdW5jdGlvbigpe3kodGhpcy5nLFwiZ2V0XCIsdGhpcy5mKTt5KHRoaXMuZyxcImJ1aWxkSGl0VGFza1wiLHRoaXMuYyl9O0coXCJjbGVhblVybFRyYWNrZXJcIixLKTtcbmZ1bmN0aW9uIEwoYSxiKXt2YXIgYz10aGlzO0ooYSxILlUpO2lmKHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKXt0aGlzLmE9QSh7ZXZlbnRzOltcImNsaWNrXCJdLGZpZWxkc09iajp7fSxhdHRyaWJ1dGVQcmVmaXg6XCJnYS1cIn0sYik7dGhpcy5mPWE7dGhpcy5jPXRoaXMuYy5iaW5kKHRoaXMpO3ZhciBkPVwiW1wiK3RoaXMuYS5hdHRyaWJ1dGVQcmVmaXgrXCJvbl1cIjt0aGlzLmI9e307dGhpcy5hLmV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGEpe2MuYlthXT1xKGEsZCxjLmMpfSl9fVxuTC5wcm90b3R5cGUuYz1mdW5jdGlvbihhLGIpe3ZhciBjPXRoaXMuYS5hdHRyaWJ1dGVQcmVmaXg7aWYoISgwPmIuZ2V0QXR0cmlidXRlKGMrXCJvblwiKS5zcGxpdCgvXFxzKixcXHMqLykuaW5kZXhPZihhLnR5cGUpKSl7dmFyIGM9QihiLGMpLGQ9QSh7fSx0aGlzLmEuZmllbGRzT2JqLGMpO3RoaXMuZi5zZW5kKGMuaGl0VHlwZXx8XCJldmVudFwiLHooe3RyYW5zcG9ydDpcImJlYWNvblwifSxkLHRoaXMuZix0aGlzLmEuaGl0RmlsdGVyLGIsYSkpfX07TC5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7dmFyIGE9dGhpcztPYmplY3Qua2V5cyh0aGlzLmIpLmZvckVhY2goZnVuY3Rpb24oYil7YS5iW2JdLmooKX0pfTtHKFwiZXZlbnRUcmFja2VyXCIsTCk7XG5mdW5jdGlvbiB6YShhLGIpe3ZhciBjPXRoaXM7SihhLEguVik7d2luZG93LkludGVyc2VjdGlvbk9ic2VydmVyJiZ3aW5kb3cuTXV0YXRpb25PYnNlcnZlciYmKHRoaXMuYT1BKHtyb290TWFyZ2luOlwiMHB4XCIsZmllbGRzT2JqOnt9LGF0dHJpYnV0ZVByZWZpeDpcImdhLVwifSxiKSx0aGlzLmM9YSx0aGlzLk09dGhpcy5NLmJpbmQodGhpcyksdGhpcy5PPXRoaXMuTy5iaW5kKHRoaXMpLHRoaXMuSz10aGlzLksuYmluZCh0aGlzKSx0aGlzLkw9dGhpcy5MLmJpbmQodGhpcyksdGhpcy5iPW51bGwsdGhpcy5pdGVtcz1bXSx0aGlzLmk9e30sdGhpcy5oPXt9LHNhKGZ1bmN0aW9uKCl7Yy5hLmVsZW1lbnRzJiZjLm9ic2VydmVFbGVtZW50cyhjLmEuZWxlbWVudHMpfSkpfWc9emEucHJvdG90eXBlO1xuZy5vYnNlcnZlRWxlbWVudHM9ZnVuY3Rpb24oYSl7dmFyIGI9dGhpczthPU0odGhpcyxhKTt0aGlzLml0ZW1zPXRoaXMuaXRlbXMuY29uY2F0KGEuaXRlbXMpO3RoaXMuaT1BKHt9LGEuaSx0aGlzLmkpO3RoaXMuaD1BKHt9LGEuaCx0aGlzLmgpO2EuaXRlbXMuZm9yRWFjaChmdW5jdGlvbihhKXt2YXIgYz1iLmhbYS50aHJlc2hvbGRdPWIuaFthLnRocmVzaG9sZF18fG5ldyBJbnRlcnNlY3Rpb25PYnNlcnZlcihiLk8se3Jvb3RNYXJnaW46Yi5hLnJvb3RNYXJnaW4sdGhyZXNob2xkOlsrYS50aHJlc2hvbGRdfSk7KGE9Yi5pW2EuaWRdfHwoYi5pW2EuaWRdPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGEuaWQpKSkmJmMub2JzZXJ2ZShhKX0pO3RoaXMuYnx8KHRoaXMuYj1uZXcgTXV0YXRpb25PYnNlcnZlcih0aGlzLk0pLHRoaXMuYi5vYnNlcnZlKGRvY3VtZW50LmJvZHkse2NoaWxkTGlzdDohMCxzdWJ0cmVlOiEwfSkpO3JlcXVlc3RBbmltYXRpb25GcmFtZShmdW5jdGlvbigpe30pfTtcbmcudW5vYnNlcnZlRWxlbWVudHM9ZnVuY3Rpb24oYSl7dmFyIGI9W10sYz1bXTt0aGlzLml0ZW1zLmZvckVhY2goZnVuY3Rpb24oZCl7YS5zb21lKGZ1bmN0aW9uKGEpe2E9QWEoYSk7cmV0dXJuIGEuaWQ9PT1kLmlkJiZhLnRocmVzaG9sZD09PWQudGhyZXNob2xkJiZhLnRyYWNrRmlyc3RJbXByZXNzaW9uT25seT09PWQudHJhY2tGaXJzdEltcHJlc3Npb25Pbmx5fSk/Yy5wdXNoKGQpOmIucHVzaChkKX0pO2lmKGIubGVuZ3RoKXt2YXIgZD1NKHRoaXMsYiksZT1NKHRoaXMsYyk7dGhpcy5pdGVtcz1kLml0ZW1zO3RoaXMuaT1kLmk7dGhpcy5oPWQuaDtjLmZvckVhY2goZnVuY3Rpb24oYSl7aWYoIWQuaVthLmlkXSl7dmFyIGI9ZS5oW2EudGhyZXNob2xkXSxjPWUuaVthLmlkXTtjJiZiLnVub2JzZXJ2ZShjKTtkLmhbYS50aHJlc2hvbGRdfHxlLmhbYS50aHJlc2hvbGRdLmRpc2Nvbm5lY3QoKX19KX1lbHNlIHRoaXMudW5vYnNlcnZlQWxsRWxlbWVudHMoKX07XG5nLnVub2JzZXJ2ZUFsbEVsZW1lbnRzPWZ1bmN0aW9uKCl7dmFyIGE9dGhpcztPYmplY3Qua2V5cyh0aGlzLmgpLmZvckVhY2goZnVuY3Rpb24oYil7YS5oW2JdLmRpc2Nvbm5lY3QoKX0pO3RoaXMuYi5kaXNjb25uZWN0KCk7dGhpcy5iPW51bGw7dGhpcy5pdGVtcz1bXTt0aGlzLmk9e307dGhpcy5oPXt9fTtmdW5jdGlvbiBNKGEsYil7dmFyIGM9W10sZD17fSxlPXt9O2IubGVuZ3RoJiZiLmZvckVhY2goZnVuY3Rpb24oYil7Yj1BYShiKTtjLnB1c2goYik7ZVtiLmlkXT1hLmlbYi5pZF18fG51bGw7ZFtiLnRocmVzaG9sZF09YS5oW2IudGhyZXNob2xkXXx8bnVsbH0pO3JldHVybntpdGVtczpjLGk6ZSxoOmR9fWcuTT1mdW5jdGlvbihhKXtmb3IodmFyIGI9MCxjO2M9YVtiXTtiKyspe2Zvcih2YXIgZD0wLGU7ZT1jLnJlbW92ZWROb2Rlc1tkXTtkKyspTih0aGlzLGUsdGhpcy5MKTtmb3IoZD0wO2U9Yy5hZGRlZE5vZGVzW2RdO2QrKylOKHRoaXMsZSx0aGlzLkspfX07XG5mdW5jdGlvbiBOKGEsYixjKXsxPT1iLm5vZGVUeXBlJiZiLmlkIGluIGEuaSYmYyhiLmlkKTtmb3IodmFyIGQ9MCxlO2U9Yi5jaGlsZE5vZGVzW2RdO2QrKylOKGEsZSxjKX1cbmcuTz1mdW5jdGlvbihhKXtmb3IodmFyIGI9W10sYz0wLGQ7ZD1hW2NdO2MrKylmb3IodmFyIGU9MCxoO2g9dGhpcy5pdGVtc1tlXTtlKyspe3ZhciBmO2lmKGY9ZC50YXJnZXQuaWQ9PT1oLmlkKShmPWgudGhyZXNob2xkKT9mPWQuaW50ZXJzZWN0aW9uUmF0aW8+PWY6KGY9ZC5pbnRlcnNlY3Rpb25SZWN0LGY9MDxmLnRvcHx8MDxmLmJvdHRvbXx8MDxmLmxlZnR8fDA8Zi5yaWdodCk7aWYoZil7dmFyIHY9aC5pZDtmPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKHYpO3ZhciB2PXt0cmFuc3BvcnQ6XCJiZWFjb25cIixldmVudENhdGVnb3J5OlwiVmlld3BvcnRcIixldmVudEFjdGlvbjpcImltcHJlc3Npb25cIixldmVudExhYmVsOnYsbm9uSW50ZXJhY3Rpb246ITB9LE5hPUEoe30sdGhpcy5hLmZpZWxkc09iaixCKGYsdGhpcy5hLmF0dHJpYnV0ZVByZWZpeCkpO3RoaXMuYy5zZW5kKFwiZXZlbnRcIix6KHYsTmEsdGhpcy5jLHRoaXMuYS5oaXRGaWx0ZXIsZikpO2gudHJhY2tGaXJzdEltcHJlc3Npb25Pbmx5JiZcbmIucHVzaChoKX19Yi5sZW5ndGgmJnRoaXMudW5vYnNlcnZlRWxlbWVudHMoYil9O2cuSz1mdW5jdGlvbihhKXt2YXIgYj10aGlzLGM9dGhpcy5pW2FdPWRvY3VtZW50LmdldEVsZW1lbnRCeUlkKGEpO3RoaXMuaXRlbXMuZm9yRWFjaChmdW5jdGlvbihkKXthPT1kLmlkJiZiLmhbZC50aHJlc2hvbGRdLm9ic2VydmUoYyl9KX07Zy5MPWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXMsYz10aGlzLmlbYV07dGhpcy5pdGVtcy5mb3JFYWNoKGZ1bmN0aW9uKGQpe2E9PWQuaWQmJmIuaFtkLnRocmVzaG9sZF0udW5vYnNlcnZlKGMpfSk7dGhpcy5pW2FdPW51bGx9O2cucmVtb3ZlPWZ1bmN0aW9uKCl7dGhpcy51bm9ic2VydmVBbGxFbGVtZW50cygpfTtHKFwiaW1wcmVzc2lvblRyYWNrZXJcIix6YSk7ZnVuY3Rpb24gQWEoYSl7XCJzdHJpbmdcIj09dHlwZW9mIGEmJihhPXtpZDphfSk7cmV0dXJuIEEoe3RocmVzaG9sZDowLHRyYWNrRmlyc3RJbXByZXNzaW9uT25seTohMH0sYSl9XG5mdW5jdGlvbiBCYSgpe3RoaXMuYT17fX1mdW5jdGlvbiBDYShhLGIpeyhhLmEuZXh0ZXJuYWxTZXQ9YS5hLmV4dGVybmFsU2V0fHxbXSkucHVzaChiKX1CYS5wcm90b3R5cGUuY2E9ZnVuY3Rpb24oYSxiKXtmb3IodmFyIGM9W10sZD0xO2Q8YXJndW1lbnRzLmxlbmd0aDsrK2QpY1tkLTFdPWFyZ3VtZW50c1tkXTsodGhpcy5hW2FdPXRoaXMuYVthXXx8W10pLmZvckVhY2goZnVuY3Rpb24oYSl7cmV0dXJuIGEuYXBwbHkobnVsbCxbXS5jb25jYXQobihjKSkpfSl9O3ZhciBPPXt9LFA9ITEsUTtmdW5jdGlvbiBSKGEsYil7Yj12b2lkIDA9PT1iP3t9OmI7dGhpcy5hPXt9O3RoaXMuYj1hO3RoaXMudz1iO3RoaXMubD1udWxsfWhhKFIsQmEpO2Z1bmN0aW9uIFMoYSxiLGMpe2E9W1wiYXV0b3RyYWNrXCIsYSxiXS5qb2luKFwiOlwiKTtPW2FdfHwoT1thXT1uZXcgUihhLGMpLFB8fCh3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInN0b3JhZ2VcIixEYSksUD0hMCkpO3JldHVybiBPW2FdfVxuZnVuY3Rpb24gRWEoKXtpZihudWxsIT1RKXJldHVybiBRO3RyeXt3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0oXCJhdXRvdHJhY2tcIixcImF1dG90cmFja1wiKSx3aW5kb3cubG9jYWxTdG9yYWdlLnJlbW92ZUl0ZW0oXCJhdXRvdHJhY2tcIiksUT0hMH1jYXRjaChhKXtRPSExfXJldHVybiBRfVIucHJvdG90eXBlLmdldD1mdW5jdGlvbigpe2lmKHRoaXMubClyZXR1cm4gdGhpcy5sO2lmKEVhKCkpdHJ5e3RoaXMubD1GYSh3aW5kb3cubG9jYWxTdG9yYWdlLmdldEl0ZW0odGhpcy5iKSl9Y2F0Y2goYSl7fXJldHVybiB0aGlzLmw9QSh7fSx0aGlzLncsdGhpcy5sKX07Ui5wcm90b3R5cGUuc2V0PWZ1bmN0aW9uKGEpe3RoaXMubD1BKHt9LHRoaXMudyx0aGlzLmwsYSk7aWYoRWEoKSl0cnl7dmFyIGI9SlNPTi5zdHJpbmdpZnkodGhpcy5sKTt3aW5kb3cubG9jYWxTdG9yYWdlLnNldEl0ZW0odGhpcy5iLGIpfWNhdGNoKGMpe319O1xuZnVuY3Rpb24gR2EoYSl7YS5sPXt9O2lmKEVhKCkpdHJ5e3dpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShhLmIpfWNhdGNoKGIpe319Ui5wcm90b3R5cGUuaj1mdW5jdGlvbigpe2RlbGV0ZSBPW3RoaXMuYl07T2JqZWN0LmtleXMoTykubGVuZ3RofHwod2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJzdG9yYWdlXCIsRGEpLFA9ITEpfTtmdW5jdGlvbiBEYShhKXt2YXIgYj1PW2Eua2V5XTtpZihiKXt2YXIgYz1BKHt9LGIudyxGYShhLm9sZFZhbHVlKSk7YT1BKHt9LGIudyxGYShhLm5ld1ZhbHVlKSk7Yi5sPWE7Yi5jYShcImV4dGVybmFsU2V0XCIsYSxjKX19ZnVuY3Rpb24gRmEoYSl7dmFyIGI9e307aWYoYSl0cnl7Yj1KU09OLnBhcnNlKGEpfWNhdGNoKGMpe31yZXR1cm4gYn12YXIgVD17fTtcbmZ1bmN0aW9uIFUoYSxiLGMpe3RoaXMuZj1hO3RoaXMudGltZW91dD1ifHxIYTt0aGlzLnRpbWVab25lPWM7dGhpcy5iPXRoaXMuYi5iaW5kKHRoaXMpO3goYSxcInNlbmRIaXRUYXNrXCIsdGhpcy5iKTt0cnl7dGhpcy5jPW5ldyBJbnRsLkRhdGVUaW1lRm9ybWF0KFwiZW4tVVNcIix7dGltZVpvbmU6dGhpcy50aW1lWm9uZX0pfWNhdGNoKGQpe310aGlzLmE9UyhhLmdldChcInRyYWNraW5nSWRcIiksXCJzZXNzaW9uXCIse2hpdFRpbWU6MCxpc0V4cGlyZWQ6ITF9KTt0aGlzLmEuZ2V0KCkuaWR8fHRoaXMuYS5zZXQoe2lkOkUoKX0pfWZ1bmN0aW9uIElhKGEsYixjKXt2YXIgZD1hLmdldChcInRyYWNraW5nSWRcIik7cmV0dXJuIFRbZF0/VFtkXTpUW2RdPW5ldyBVKGEsYixjKX1mdW5jdGlvbiBWKGEpe3JldHVybiBhLmEuZ2V0KCkuaWR9XG5VLnByb3RvdHlwZS5pc0V4cGlyZWQ9ZnVuY3Rpb24oYSl7YT12b2lkIDA9PT1hP1YodGhpcyk6YTtpZihhIT1WKHRoaXMpKXJldHVybiEwO2E9dGhpcy5hLmdldCgpO2lmKGEuaXNFeHBpcmVkKXJldHVybiEwO3ZhciBiPWEuaGl0VGltZTtyZXR1cm4gYiYmKGE9bmV3IERhdGUsYj1uZXcgRGF0ZShiKSxhLWI+NkU0KnRoaXMudGltZW91dHx8dGhpcy5jJiZ0aGlzLmMuZm9ybWF0KGEpIT10aGlzLmMuZm9ybWF0KGIpKT8hMDohMX07VS5wcm90b3R5cGUuYj1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjKXthKGMpO3ZhciBkPWMuZ2V0KFwic2Vzc2lvbkNvbnRyb2xcIik7Yz1cInN0YXJ0XCI9PWR8fGIuaXNFeHBpcmVkKCk7dmFyIGQ9XCJlbmRcIj09ZCxlPWIuYS5nZXQoKTtlLmhpdFRpbWU9K25ldyBEYXRlO2MmJihlLmlzRXhwaXJlZD0hMSxlLmlkPUUoKSk7ZCYmKGUuaXNFeHBpcmVkPSEwKTtiLmEuc2V0KGUpfX07XG5VLnByb3RvdHlwZS5qPWZ1bmN0aW9uKCl7eSh0aGlzLmYsXCJzZW5kSGl0VGFza1wiLHRoaXMuYik7dGhpcy5hLmooKTtkZWxldGUgVFt0aGlzLmYuZ2V0KFwidHJhY2tpbmdJZFwiKV19O3ZhciBIYT0zMDtmdW5jdGlvbiBXKGEsYil7SihhLEguVyk7d2luZG93LmFkZEV2ZW50TGlzdGVuZXImJih0aGlzLmI9QSh7aW5jcmVhc2VUaHJlc2hvbGQ6MjAsc2Vzc2lvblRpbWVvdXQ6SGEsZmllbGRzT2JqOnt9fSxiKSx0aGlzLmY9YSx0aGlzLmM9SmEodGhpcyksdGhpcy5nPXRhKHRoaXMuZy5iaW5kKHRoaXMpLDUwMCksdGhpcy5vPXRoaXMuby5iaW5kKHRoaXMpLHRoaXMuYT1TKGEuZ2V0KFwidHJhY2tpbmdJZFwiKSxcInBsdWdpbnMvbWF4LXNjcm9sbC10cmFja2VyXCIpLHRoaXMubT1JYShhLHRoaXMuYi5zZXNzaW9uVGltZW91dCx0aGlzLmIudGltZVpvbmUpLHgoYSxcInNldFwiLHRoaXMubyksS2EodGhpcykpfVxuZnVuY3Rpb24gS2EoYSl7MTAwPihhLmEuZ2V0KClbYS5jXXx8MCkmJndpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwic2Nyb2xsXCIsYS5nKX1cblcucHJvdG90eXBlLmc9ZnVuY3Rpb24oKXt2YXIgYT1kb2N1bWVudC5kb2N1bWVudEVsZW1lbnQsYj1kb2N1bWVudC5ib2R5LGE9TWF0aC5taW4oMTAwLE1hdGgubWF4KDAsTWF0aC5yb3VuZCh3aW5kb3cucGFnZVlPZmZzZXQvKE1hdGgubWF4KGEub2Zmc2V0SGVpZ2h0LGEuc2Nyb2xsSGVpZ2h0LGIub2Zmc2V0SGVpZ2h0LGIuc2Nyb2xsSGVpZ2h0KS13aW5kb3cuaW5uZXJIZWlnaHQpKjEwMCkpKSxiPVYodGhpcy5tKTtiIT10aGlzLmEuZ2V0KCkuc2Vzc2lvbklkJiYoR2EodGhpcy5hKSx0aGlzLmEuc2V0KHtzZXNzaW9uSWQ6Yn0pKTtpZih0aGlzLm0uaXNFeHBpcmVkKHRoaXMuYS5nZXQoKS5zZXNzaW9uSWQpKUdhKHRoaXMuYSk7ZWxzZSBpZihiPXRoaXMuYS5nZXQoKVt0aGlzLmNdfHwwLGE+YiYmKDEwMCE9YSYmMTAwIT1ifHx3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInNjcm9sbFwiLHRoaXMuZyksYj1hLWIsMTAwPT1hfHxiPj10aGlzLmIuaW5jcmVhc2VUaHJlc2hvbGQpKXt2YXIgYz1cbnt9O3RoaXMuYS5zZXQoKGNbdGhpcy5jXT1hLGMuc2Vzc2lvbklkPVYodGhpcy5tKSxjKSk7YT17dHJhbnNwb3J0OlwiYmVhY29uXCIsZXZlbnRDYXRlZ29yeTpcIk1heCBTY3JvbGxcIixldmVudEFjdGlvbjpcImluY3JlYXNlXCIsZXZlbnRWYWx1ZTpiLGV2ZW50TGFiZWw6U3RyaW5nKGEpLG5vbkludGVyYWN0aW9uOiEwfTt0aGlzLmIubWF4U2Nyb2xsTWV0cmljSW5kZXgmJihhW1wibWV0cmljXCIrdGhpcy5iLm1heFNjcm9sbE1ldHJpY0luZGV4XT1iKTt0aGlzLmYuc2VuZChcImV2ZW50XCIseihhLHRoaXMuYi5maWVsZHNPYmosdGhpcy5mLHRoaXMuYi5oaXRGaWx0ZXIpKX19O1cucHJvdG90eXBlLm89ZnVuY3Rpb24oYSl7dmFyIGI9dGhpcztyZXR1cm4gZnVuY3Rpb24oYyxkKXthKGMsZCk7dmFyIGU9e307KEQoYyk/YzooZVtjXT1kLGUpKS5wYWdlJiYoYz1iLmMsYi5jPUphKGIpLGIuYyE9YyYmS2EoYikpfX07XG5mdW5jdGlvbiBKYShhKXthPXUoYS5mLmdldChcInBhZ2VcIil8fGEuZi5nZXQoXCJsb2NhdGlvblwiKSk7cmV0dXJuIGEucGF0aG5hbWUrYS5zZWFyY2h9Vy5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7dGhpcy5tLmooKTt3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInNjcm9sbFwiLHRoaXMuZyk7eSh0aGlzLmYsXCJzZXRcIix0aGlzLm8pfTtHKFwibWF4U2Nyb2xsVHJhY2tlclwiLFcpO3ZhciBMYT17fTtmdW5jdGlvbiBNYShhLGIpe0ooYSxILlgpO3dpbmRvdy5tYXRjaE1lZGlhJiYodGhpcy5hPUEoe2NoYW5nZVRlbXBsYXRlOnRoaXMuY2hhbmdlVGVtcGxhdGUsY2hhbmdlVGltZW91dDoxRTMsZmllbGRzT2JqOnt9fSxiKSxEKHRoaXMuYS5kZWZpbml0aW9ucykmJihiPXRoaXMuYS5kZWZpbml0aW9ucyx0aGlzLmEuZGVmaW5pdGlvbnM9QXJyYXkuaXNBcnJheShiKT9iOltiXSx0aGlzLmI9YSx0aGlzLmM9W10sT2EodGhpcykpKX1cbmZ1bmN0aW9uIE9hKGEpe2EuYS5kZWZpbml0aW9ucy5mb3JFYWNoKGZ1bmN0aW9uKGIpe2lmKGIubmFtZSYmYi5kaW1lbnNpb25JbmRleCl7dmFyIGM9UGEoYik7YS5iLnNldChcImRpbWVuc2lvblwiK2IuZGltZW5zaW9uSW5kZXgsYyk7UWEoYSxiKX19KX1mdW5jdGlvbiBQYShhKXt2YXIgYjthLml0ZW1zLmZvckVhY2goZnVuY3Rpb24oYSl7UmEoYS5tZWRpYSkubWF0Y2hlcyYmKGI9YSl9KTtyZXR1cm4gYj9iLm5hbWU6XCIobm90IHNldClcIn1cbmZ1bmN0aW9uIFFhKGEsYil7Yi5pdGVtcy5mb3JFYWNoKGZ1bmN0aW9uKGMpe2M9UmEoYy5tZWRpYSk7dmFyIGQ9dGEoZnVuY3Rpb24oKXt2YXIgYz1QYShiKSxkPWEuYi5nZXQoXCJkaW1lbnNpb25cIitiLmRpbWVuc2lvbkluZGV4KTtjIT09ZCYmKGEuYi5zZXQoXCJkaW1lbnNpb25cIitiLmRpbWVuc2lvbkluZGV4LGMpLGM9e3RyYW5zcG9ydDpcImJlYWNvblwiLGV2ZW50Q2F0ZWdvcnk6Yi5uYW1lLGV2ZW50QWN0aW9uOlwiY2hhbmdlXCIsZXZlbnRMYWJlbDphLmEuY2hhbmdlVGVtcGxhdGUoZCxjKSxub25JbnRlcmFjdGlvbjohMH0sYS5iLnNlbmQoXCJldmVudFwiLHooYyxhLmEuZmllbGRzT2JqLGEuYixhLmEuaGl0RmlsdGVyKSkpfSxhLmEuY2hhbmdlVGltZW91dCk7Yy5hZGRMaXN0ZW5lcihkKTthLmMucHVzaCh7ZmE6YyxkYTpkfSl9KX1NYS5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7Zm9yKHZhciBhPTAsYjtiPXRoaXMuY1thXTthKyspYi5mYS5yZW1vdmVMaXN0ZW5lcihiLmRhKX07XG5NYS5wcm90b3R5cGUuY2hhbmdlVGVtcGxhdGU9ZnVuY3Rpb24oYSxiKXtyZXR1cm4gYStcIiBcXHgzZFxceDNlIFwiK2J9O0coXCJtZWRpYVF1ZXJ5VHJhY2tlclwiLE1hKTtmdW5jdGlvbiBSYShhKXtyZXR1cm4gTGFbYV18fChMYVthXT13aW5kb3cubWF0Y2hNZWRpYShhKSl9ZnVuY3Rpb24gWChhLGIpe0ooYSxILlkpO3dpbmRvdy5hZGRFdmVudExpc3RlbmVyJiYodGhpcy5hPUEoe2Zvcm1TZWxlY3RvcjpcImZvcm1cIixzaG91bGRUcmFja091dGJvdW5kRm9ybTp0aGlzLnNob3VsZFRyYWNrT3V0Ym91bmRGb3JtLGZpZWxkc09iajp7fSxhdHRyaWJ1dGVQcmVmaXg6XCJnYS1cIn0sYiksdGhpcy5iPWEsdGhpcy5jPXEoXCJzdWJtaXRcIix0aGlzLmEuZm9ybVNlbGVjdG9yLHRoaXMuZi5iaW5kKHRoaXMpKSl9XG5YLnByb3RvdHlwZS5mPWZ1bmN0aW9uKGEsYil7dmFyIGM9e3RyYW5zcG9ydDpcImJlYWNvblwiLGV2ZW50Q2F0ZWdvcnk6XCJPdXRib3VuZCBGb3JtXCIsZXZlbnRBY3Rpb246XCJzdWJtaXRcIixldmVudExhYmVsOnUoYi5hY3Rpb24pLmhyZWZ9O2lmKHRoaXMuYS5zaG91bGRUcmFja091dGJvdW5kRm9ybShiLHUpKXtuYXZpZ2F0b3Iuc2VuZEJlYWNvbnx8KGEucHJldmVudERlZmF1bHQoKSxjLmhpdENhbGxiYWNrPXVhKGZ1bmN0aW9uKCl7Yi5zdWJtaXQoKX0pKTt2YXIgZD1BKHt9LHRoaXMuYS5maWVsZHNPYmosQihiLHRoaXMuYS5hdHRyaWJ1dGVQcmVmaXgpKTt0aGlzLmIuc2VuZChcImV2ZW50XCIseihjLGQsdGhpcy5iLHRoaXMuYS5oaXRGaWx0ZXIsYixhKSl9fTtcblgucHJvdG90eXBlLnNob3VsZFRyYWNrT3V0Ym91bmRGb3JtPWZ1bmN0aW9uKGEsYil7YT1iKGEuYWN0aW9uKTtyZXR1cm4gYS5ob3N0bmFtZSE9bG9jYXRpb24uaG9zdG5hbWUmJlwiaHR0cFwiPT1hLnByb3RvY29sLnNsaWNlKDAsNCl9O1gucHJvdG90eXBlLnJlbW92ZT1mdW5jdGlvbigpe3RoaXMuYy5qKCl9O0coXCJvdXRib3VuZEZvcm1UcmFja2VyXCIsWCk7XG5mdW5jdGlvbiBZKGEsYil7dmFyIGM9dGhpcztKKGEsSC5aKTt3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lciYmKHRoaXMuYT1BKHtldmVudHM6W1wiY2xpY2tcIl0sbGlua1NlbGVjdG9yOlwiYSwgYXJlYVwiLHNob3VsZFRyYWNrT3V0Ym91bmRMaW5rOnRoaXMuc2hvdWxkVHJhY2tPdXRib3VuZExpbmssZmllbGRzT2JqOnt9LGF0dHJpYnV0ZVByZWZpeDpcImdhLVwifSxiKSx0aGlzLmM9YSx0aGlzLmY9dGhpcy5mLmJpbmQodGhpcyksdGhpcy5iPXt9LHRoaXMuYS5ldmVudHMuZm9yRWFjaChmdW5jdGlvbihhKXtjLmJbYV09cShhLGMuYS5saW5rU2VsZWN0b3IsYy5mKX0pKX1cblkucHJvdG90eXBlLmY9ZnVuY3Rpb24oYSxiKXt2YXIgYz10aGlzO2lmKHRoaXMuYS5zaG91bGRUcmFja091dGJvdW5kTGluayhiLHUpKXt2YXIgZD1iLmdldEF0dHJpYnV0ZShcImhyZWZcIil8fGIuZ2V0QXR0cmlidXRlKFwieGxpbms6aHJlZlwiKSxlPXUoZCksZT17dHJhbnNwb3J0OlwiYmVhY29uXCIsZXZlbnRDYXRlZ29yeTpcIk91dGJvdW5kIExpbmtcIixldmVudEFjdGlvbjphLnR5cGUsZXZlbnRMYWJlbDplLmhyZWZ9LGg9QSh7fSx0aGlzLmEuZmllbGRzT2JqLEIoYix0aGlzLmEuYXR0cmlidXRlUHJlZml4KSksZj16KGUsaCx0aGlzLmMsdGhpcy5hLmhpdEZpbHRlcixiLGEpO2lmKG5hdmlnYXRvci5zZW5kQmVhY29ufHxcImNsaWNrXCIhPWEudHlwZXx8XCJfYmxhbmtcIj09Yi50YXJnZXR8fGEubWV0YUtleXx8YS5jdHJsS2V5fHxhLnNoaWZ0S2V5fHxhLmFsdEtleXx8MTxhLndoaWNoKXRoaXMuYy5zZW5kKFwiZXZlbnRcIixmKTtlbHNle3ZhciB2PWZ1bmN0aW9uKCl7d2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLFxudik7aWYoIWEuZGVmYXVsdFByZXZlbnRlZCl7YS5wcmV2ZW50RGVmYXVsdCgpO3ZhciBiPWYuaGl0Q2FsbGJhY2s7Zi5oaXRDYWxsYmFjaz11YShmdW5jdGlvbigpe1wiZnVuY3Rpb25cIj09dHlwZW9mIGImJmIoKTtsb2NhdGlvbi5ocmVmPWR9KX1jLmMuc2VuZChcImV2ZW50XCIsZil9O3dpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIix2KX19fTtZLnByb3RvdHlwZS5zaG91bGRUcmFja091dGJvdW5kTGluaz1mdW5jdGlvbihhLGIpe2E9YS5nZXRBdHRyaWJ1dGUoXCJocmVmXCIpfHxhLmdldEF0dHJpYnV0ZShcInhsaW5rOmhyZWZcIik7Yj1iKGEpO3JldHVybiBiLmhvc3RuYW1lIT1sb2NhdGlvbi5ob3N0bmFtZSYmXCJodHRwXCI9PWIucHJvdG9jb2wuc2xpY2UoMCw0KX07WS5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7dmFyIGE9dGhpcztPYmplY3Qua2V5cyh0aGlzLmIpLmZvckVhY2goZnVuY3Rpb24oYil7YS5iW2JdLmooKX0pfTtHKFwib3V0Ym91bmRMaW5rVHJhY2tlclwiLFkpO1xudmFyIFo9RSgpO1xuZnVuY3Rpb24gU2EoYSxiKXt2YXIgYz10aGlzO0ooYSxILiQpO2RvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSYmKHRoaXMuYT1BKHtzZXNzaW9uVGltZW91dDpIYSx2aXNpYmxlVGhyZXNob2xkOjVFMyxzZW5kSW5pdGlhbFBhZ2V2aWV3OiExLGZpZWxkc09iajp7fX0sYiksdGhpcy5iPWEsdGhpcy5nPWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSx0aGlzLm09bnVsbCx0aGlzLm89ITEsdGhpcy52PXRoaXMudi5iaW5kKHRoaXMpLHRoaXMucz10aGlzLnMuYmluZCh0aGlzKSx0aGlzLkc9dGhpcy5HLmJpbmQodGhpcyksdGhpcy5OPXRoaXMuTi5iaW5kKHRoaXMpLHRoaXMuYz1TKGEuZ2V0KFwidHJhY2tpbmdJZFwiKSxcInBsdWdpbnMvcGFnZS12aXNpYmlsaXR5LXRyYWNrZXJcIiksQ2EodGhpcy5jLHRoaXMuTiksdGhpcy5mPUlhKGEsdGhpcy5hLnNlc3Npb25UaW1lb3V0LHRoaXMuYS50aW1lWm9uZSkseChhLFwic2V0XCIsdGhpcy52KSx3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInVubG9hZFwiLHRoaXMuRyksXG5kb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKFwidmlzaWJpbGl0eWNoYW5nZVwiLHRoaXMucyksdmEodGhpcy5iLGZ1bmN0aW9uKCl7aWYoXCJ2aXNpYmxlXCI9PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSljLmEuc2VuZEluaXRpYWxQYWdldmlldyYmKFRhKGMse2VhOiEwfSksYy5vPSEwKSxjLmMuc2V0KHt0aW1lOituZXcgRGF0ZSxzdGF0ZTpcInZpc2libGVcIixwYWdlSWQ6WixzZXNzaW9uSWQ6VihjLmYpfSk7ZWxzZSBpZihjLmEuc2VuZEluaXRpYWxQYWdldmlldyYmYy5hLnBhZ2VMb2Fkc01ldHJpY0luZGV4KXt2YXIgYT17fSxhPShhLnRyYW5zcG9ydD1cImJlYWNvblwiLGEuZXZlbnRDYXRlZ29yeT1cIlBhZ2UgVmlzaWJpbGl0eVwiLGEuZXZlbnRBY3Rpb249XCJwYWdlIGxvYWRcIixhLmV2ZW50TGFiZWw9XCIobm90IHNldClcIixhW1wibWV0cmljXCIrYy5hLnBhZ2VMb2Fkc01ldHJpY0luZGV4XT0xLGEubm9uSW50ZXJhY3Rpb249ITAsYSk7Yy5iLnNlbmQoXCJldmVudFwiLHooYSxjLmEuZmllbGRzT2JqLFxuYy5iLGMuYS5oaXRGaWx0ZXIpKX19KSl9Zz1TYS5wcm90b3R5cGU7XG5nLnM9ZnVuY3Rpb24oKXt2YXIgYT10aGlzO2lmKFwidmlzaWJsZVwiPT1kb2N1bWVudC52aXNpYmlsaXR5U3RhdGV8fFwiaGlkZGVuXCI9PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSl7dmFyIGI9VWEodGhpcyksYz17dGltZTorbmV3IERhdGUsc3RhdGU6ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlLHBhZ2VJZDpaLHNlc3Npb25JZDpWKHRoaXMuZil9O1widmlzaWJsZVwiPT1kb2N1bWVudC52aXNpYmlsaXR5U3RhdGUmJnRoaXMuYS5zZW5kSW5pdGlhbFBhZ2V2aWV3JiYhdGhpcy5vJiYoVGEodGhpcyksdGhpcy5vPSEwKTtcImhpZGRlblwiPT1kb2N1bWVudC52aXNpYmlsaXR5U3RhdGUmJnRoaXMubSYmY2xlYXJUaW1lb3V0KHRoaXMubSk7dGhpcy5mLmlzRXhwaXJlZChiLnNlc3Npb25JZCk/KEdhKHRoaXMuYyksXCJoaWRkZW5cIj09dGhpcy5nJiZcInZpc2libGVcIj09ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlJiYoY2xlYXJUaW1lb3V0KHRoaXMubSksdGhpcy5tPXNldFRpbWVvdXQoZnVuY3Rpb24oKXthLmMuc2V0KGMpO1xuVGEoYSx7aGl0VGltZTpjLnRpbWV9KX0sdGhpcy5hLnZpc2libGVUaHJlc2hvbGQpKSk6KGIucGFnZUlkPT1aJiZcInZpc2libGVcIj09Yi5zdGF0ZSYmVmEodGhpcyxiKSx0aGlzLmMuc2V0KGMpKTt0aGlzLmc9ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlfX07ZnVuY3Rpb24gVWEoYSl7dmFyIGI9YS5jLmdldCgpO1widmlzaWJsZVwiPT1hLmcmJlwiaGlkZGVuXCI9PWIuc3RhdGUmJmIucGFnZUlkIT1aJiYoYi5zdGF0ZT1cInZpc2libGVcIixiLnBhZ2VJZD1aLGEuYy5zZXQoYikpO3JldHVybiBifVxuZnVuY3Rpb24gVmEoYSxiLGMpe2M9KGM/Yzp7fSkuaGl0VGltZTt2YXIgZD17aGl0VGltZTpjfSxkPShkP2Q6e30pLmhpdFRpbWU7KGI9Yi50aW1lPyhkfHwrbmV3IERhdGUpLWIudGltZTowKSYmYj49YS5hLnZpc2libGVUaHJlc2hvbGQmJihiPU1hdGgucm91bmQoYi8xRTMpLGQ9e3RyYW5zcG9ydDpcImJlYWNvblwiLG5vbkludGVyYWN0aW9uOiEwLGV2ZW50Q2F0ZWdvcnk6XCJQYWdlIFZpc2liaWxpdHlcIixldmVudEFjdGlvbjpcInRyYWNrXCIsZXZlbnRWYWx1ZTpiLGV2ZW50TGFiZWw6XCIobm90IHNldClcIn0sYyYmKGQucXVldWVUaW1lPStuZXcgRGF0ZS1jKSxhLmEudmlzaWJsZU1ldHJpY0luZGV4JiYoZFtcIm1ldHJpY1wiK2EuYS52aXNpYmxlTWV0cmljSW5kZXhdPWIpLGEuYi5zZW5kKFwiZXZlbnRcIix6KGQsYS5hLmZpZWxkc09iaixhLmIsYS5hLmhpdEZpbHRlcikpKX1cbmZ1bmN0aW9uIFRhKGEsYil7dmFyIGM9Yj9iOnt9O2I9Yy5oaXRUaW1lO3ZhciBjPWMuZWEsZD17dHJhbnNwb3J0OlwiYmVhY29uXCJ9O2ImJihkLnF1ZXVlVGltZT0rbmV3IERhdGUtYik7YyYmYS5hLnBhZ2VMb2Fkc01ldHJpY0luZGV4JiYoZFtcIm1ldHJpY1wiK2EuYS5wYWdlTG9hZHNNZXRyaWNJbmRleF09MSk7YS5iLnNlbmQoXCJwYWdldmlld1wiLHooZCxhLmEuZmllbGRzT2JqLGEuYixhLmEuaGl0RmlsdGVyKSl9Zy52PWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXM7cmV0dXJuIGZ1bmN0aW9uKGMsZCl7dmFyIGU9e30sZT1EKGMpP2M6KGVbY109ZCxlKTtlLnBhZ2UmJmUucGFnZSE9PWIuYi5nZXQoXCJwYWdlXCIpJiZcInZpc2libGVcIj09Yi5nJiZiLnMoKTthKGMsZCl9fTtnLk49ZnVuY3Rpb24oYSxiKXthLnRpbWUhPWIudGltZSYmKGIucGFnZUlkIT1afHxcInZpc2libGVcIiE9Yi5zdGF0ZXx8dGhpcy5mLmlzRXhwaXJlZChiLnNlc3Npb25JZCl8fFZhKHRoaXMsYix7aGl0VGltZTphLnRpbWV9KSl9O1xuZy5HPWZ1bmN0aW9uKCl7XCJoaWRkZW5cIiE9dGhpcy5nJiZ0aGlzLnMoKX07Zy5yZW1vdmU9ZnVuY3Rpb24oKXt0aGlzLmMuaigpO3RoaXMuZi5qKCk7eSh0aGlzLmIsXCJzZXRcIix0aGlzLnYpO3dpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwidW5sb2FkXCIsdGhpcy5HKTtkb2N1bWVudC5yZW1vdmVFdmVudExpc3RlbmVyKFwidmlzaWJpbGl0eWNoYW5nZVwiLHRoaXMucyl9O0coXCJwYWdlVmlzaWJpbGl0eVRyYWNrZXJcIixTYSk7XG5mdW5jdGlvbiBXYShhLGIpe0ooYSxILmFhKTt3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lciYmKHRoaXMuYT1BKHtmaWVsZHNPYmo6e30saGl0RmlsdGVyOm51bGx9LGIpLHRoaXMuYj1hLHRoaXMudT10aGlzLnUuYmluZCh0aGlzKSx0aGlzLko9dGhpcy5KLmJpbmQodGhpcyksdGhpcy5EPXRoaXMuRC5iaW5kKHRoaXMpLHRoaXMuQT10aGlzLkEuYmluZCh0aGlzKSx0aGlzLkI9dGhpcy5CLmJpbmQodGhpcyksdGhpcy5GPXRoaXMuRi5iaW5kKHRoaXMpLFwiY29tcGxldGVcIiE9ZG9jdW1lbnQucmVhZHlTdGF0ZT93aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcImxvYWRcIix0aGlzLnUpOnRoaXMudSgpKX1nPVdhLnByb3RvdHlwZTtcbmcudT1mdW5jdGlvbigpe2lmKHdpbmRvdy5GQil0cnl7d2luZG93LkZCLkV2ZW50LnN1YnNjcmliZShcImVkZ2UuY3JlYXRlXCIsdGhpcy5CKSx3aW5kb3cuRkIuRXZlbnQuc3Vic2NyaWJlKFwiZWRnZS5yZW1vdmVcIix0aGlzLkYpfWNhdGNoKGEpe313aW5kb3cudHd0dHImJnRoaXMuSigpfTtnLko9ZnVuY3Rpb24oKXt2YXIgYT10aGlzO3RyeXt3aW5kb3cudHd0dHIucmVhZHkoZnVuY3Rpb24oKXt3aW5kb3cudHd0dHIuZXZlbnRzLmJpbmQoXCJ0d2VldFwiLGEuRCk7d2luZG93LnR3dHRyLmV2ZW50cy5iaW5kKFwiZm9sbG93XCIsYS5BKX0pfWNhdGNoKGIpe319O2Z1bmN0aW9uIFhhKGEpe3RyeXt3aW5kb3cudHd0dHIucmVhZHkoZnVuY3Rpb24oKXt3aW5kb3cudHd0dHIuZXZlbnRzLnVuYmluZChcInR3ZWV0XCIsYS5EKTt3aW5kb3cudHd0dHIuZXZlbnRzLnVuYmluZChcImZvbGxvd1wiLGEuQSl9KX1jYXRjaChiKXt9fVxuZy5EPWZ1bmN0aW9uKGEpe2lmKFwidHdlZXRcIj09YS5yZWdpb24pe3ZhciBiPXt0cmFuc3BvcnQ6XCJiZWFjb25cIixzb2NpYWxOZXR3b3JrOlwiVHdpdHRlclwiLHNvY2lhbEFjdGlvbjpcInR3ZWV0XCIsc29jaWFsVGFyZ2V0OmEuZGF0YS51cmx8fGEudGFyZ2V0LmdldEF0dHJpYnV0ZShcImRhdGEtdXJsXCIpfHxsb2NhdGlvbi5ocmVmfTt0aGlzLmIuc2VuZChcInNvY2lhbFwiLHooYix0aGlzLmEuZmllbGRzT2JqLHRoaXMuYix0aGlzLmEuaGl0RmlsdGVyLGEudGFyZ2V0LGEpKX19O1xuZy5BPWZ1bmN0aW9uKGEpe2lmKFwiZm9sbG93XCI9PWEucmVnaW9uKXt2YXIgYj17dHJhbnNwb3J0OlwiYmVhY29uXCIsc29jaWFsTmV0d29yazpcIlR3aXR0ZXJcIixzb2NpYWxBY3Rpb246XCJmb2xsb3dcIixzb2NpYWxUYXJnZXQ6YS5kYXRhLnNjcmVlbl9uYW1lfHxhLnRhcmdldC5nZXRBdHRyaWJ1dGUoXCJkYXRhLXNjcmVlbi1uYW1lXCIpfTt0aGlzLmIuc2VuZChcInNvY2lhbFwiLHooYix0aGlzLmEuZmllbGRzT2JqLHRoaXMuYix0aGlzLmEuaGl0RmlsdGVyLGEudGFyZ2V0LGEpKX19O2cuQj1mdW5jdGlvbihhKXt0aGlzLmIuc2VuZChcInNvY2lhbFwiLHooe3RyYW5zcG9ydDpcImJlYWNvblwiLHNvY2lhbE5ldHdvcms6XCJGYWNlYm9va1wiLHNvY2lhbEFjdGlvbjpcImxpa2VcIixzb2NpYWxUYXJnZXQ6YX0sdGhpcy5hLmZpZWxkc09iaix0aGlzLmIsdGhpcy5hLmhpdEZpbHRlcikpfTtcbmcuRj1mdW5jdGlvbihhKXt0aGlzLmIuc2VuZChcInNvY2lhbFwiLHooe3RyYW5zcG9ydDpcImJlYWNvblwiLHNvY2lhbE5ldHdvcms6XCJGYWNlYm9va1wiLHNvY2lhbEFjdGlvbjpcInVubGlrZVwiLHNvY2lhbFRhcmdldDphfSx0aGlzLmEuZmllbGRzT2JqLHRoaXMuYix0aGlzLmEuaGl0RmlsdGVyKSl9O2cucmVtb3ZlPWZ1bmN0aW9uKCl7d2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJsb2FkXCIsdGhpcy51KTt0cnl7d2luZG93LkZCLkV2ZW50LnVuc3Vic2NyaWJlKFwiZWRnZS5jcmVhdGVcIix0aGlzLkIpLHdpbmRvdy5GQi5FdmVudC51bnN1YnNjcmliZShcImVkZ2UucmVtb3ZlXCIsdGhpcy5GKX1jYXRjaChhKXt9WGEodGhpcyl9O0coXCJzb2NpYWxXaWRnZXRUcmFja2VyXCIsV2EpO1xuZnVuY3Rpb24gWWEoYSxiKXtKKGEsSC5iYSk7aGlzdG9yeS5wdXNoU3RhdGUmJndpbmRvdy5hZGRFdmVudExpc3RlbmVyJiYodGhpcy5hPUEoe3Nob3VsZFRyYWNrVXJsQ2hhbmdlOnRoaXMuc2hvdWxkVHJhY2tVcmxDaGFuZ2UsdHJhY2tSZXBsYWNlU3RhdGU6ITEsZmllbGRzT2JqOnt9LGhpdEZpbHRlcjpudWxsfSxiKSx0aGlzLmI9YSx0aGlzLmM9bG9jYXRpb24ucGF0aG5hbWUrbG9jYXRpb24uc2VhcmNoLHRoaXMuSD10aGlzLkguYmluZCh0aGlzKSx0aGlzLkk9dGhpcy5JLmJpbmQodGhpcyksdGhpcy5DPXRoaXMuQy5iaW5kKHRoaXMpLHgoaGlzdG9yeSxcInB1c2hTdGF0ZVwiLHRoaXMuSCkseChoaXN0b3J5LFwicmVwbGFjZVN0YXRlXCIsdGhpcy5JKSx3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lcihcInBvcHN0YXRlXCIsdGhpcy5DKSl9Zz1ZYS5wcm90b3R5cGU7XG5nLkg9ZnVuY3Rpb24oYSl7dmFyIGI9dGhpcztyZXR1cm4gZnVuY3Rpb24oYyl7Zm9yKHZhciBkPVtdLGU9MDtlPGFyZ3VtZW50cy5sZW5ndGg7KytlKWRbZS0wXT1hcmd1bWVudHNbZV07YS5hcHBseShudWxsLFtdLmNvbmNhdChuKGQpKSk7WmEoYiwhMCl9fTtnLkk9ZnVuY3Rpb24oYSl7dmFyIGI9dGhpcztyZXR1cm4gZnVuY3Rpb24oYyl7Zm9yKHZhciBkPVtdLGU9MDtlPGFyZ3VtZW50cy5sZW5ndGg7KytlKWRbZS0wXT1hcmd1bWVudHNbZV07YS5hcHBseShudWxsLFtdLmNvbmNhdChuKGQpKSk7WmEoYiwhMSl9fTtnLkM9ZnVuY3Rpb24oKXtaYSh0aGlzLCEwKX07XG5mdW5jdGlvbiBaYShhLGIpe3NldFRpbWVvdXQoZnVuY3Rpb24oKXt2YXIgYz1hLmMsZD1sb2NhdGlvbi5wYXRobmFtZStsb2NhdGlvbi5zZWFyY2g7YyE9ZCYmYS5hLnNob3VsZFRyYWNrVXJsQ2hhbmdlLmNhbGwoYSxkLGMpJiYoYS5jPWQsYS5iLnNldCh7cGFnZTpkLHRpdGxlOmRvY3VtZW50LnRpdGxlfSksKGJ8fGEuYS50cmFja1JlcGxhY2VTdGF0ZSkmJmEuYi5zZW5kKFwicGFnZXZpZXdcIix6KHt0cmFuc3BvcnQ6XCJiZWFjb25cIn0sYS5hLmZpZWxkc09iaixhLmIsYS5hLmhpdEZpbHRlcikpKX0sMCl9Zy5zaG91bGRUcmFja1VybENoYW5nZT1mdW5jdGlvbihhLGIpe3JldHVybiEoIWF8fCFiKX07Zy5yZW1vdmU9ZnVuY3Rpb24oKXt5KGhpc3RvcnksXCJwdXNoU3RhdGVcIix0aGlzLkgpO3koaGlzdG9yeSxcInJlcGxhY2VTdGF0ZVwiLHRoaXMuSSk7d2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJwb3BzdGF0ZVwiLHRoaXMuQyl9O0coXCJ1cmxDaGFuZ2VUcmFja2VyXCIsWWEpO30pKCk7XG5cbiIsIiggZnVuY3Rpb24oICQgKSB7XG5cblx0Lypcblx0ICogQ3JlYXRlIGEgR29vZ2xlIEFuYWx5dGljcyBldmVudFxuXHQgKiBjYXRlZ29yeTogRXZlbnQgQ2F0ZWdvcnlcblx0ICogbGFiZWw6IEV2ZW50IExhYmVsXG5cdCAqIGFjdGlvbjogRXZlbnQgQWN0aW9uXG5cdCAqIHZhbHVlOiBvcHRpb25hbFxuXHQqL1xuXHRmdW5jdGlvbiB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoIHR5cGUsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsLCB2YWx1ZSApIHtcblx0XHRpZiAoIHR5cGVvZiBnYSAhPT0gJ3VuZGVmaW5lZCcgKSB7XG5cdFx0XHRpZiAoIHR5cGVvZiB2YWx1ZSA9PT0gJ3VuZGVmaW5lZCcgKSB7XG5cdFx0XHRcdGdhKCAnc2VuZCcsIHR5cGUsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRnYSggJ3NlbmQnLCB0eXBlLCBjYXRlZ29yeSwgYWN0aW9uLCBsYWJlbCwgdmFsdWUgKTtcblx0XHRcdH1cblx0XHR9IGVsc2Uge1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblx0fVxuXG5cdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MgKSB7XG5cdFx0aWYgKCAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zcGVjaWFsICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zcGVjaWFsLmVuYWJsZWQgKSB7XG5cdFx0XHQvLyBleHRlcm5hbCBsaW5rc1xuXHRcdFx0JCggJ2FbaHJlZl49XCJodHRwXCJdOm5vdChbaHJlZio9XCI6Ly8nICsgZG9jdW1lbnQuZG9tYWluICsgJ1wiXSknICkuY2xpY2soIGZ1bmN0aW9uKCkge1xuXHRcdFx0ICAgIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ091dGJvdW5kIGxpbmtzJywgJ0NsaWNrJywgdGhpcy5ocmVmICk7XG5cdFx0XHR9KTtcblxuXHRcdFx0Ly8gbWFpbHRvIGxpbmtzXG5cdFx0XHQkKCAnYVtocmVmXj1cIm1haWx0b1wiXScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cdFx0XHQgICAgd3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnTWFpbHMnLCAnQ2xpY2snLCB0aGlzLmhyZWYuc3Vic3RyaW5nKCA3ICkgKTtcblx0XHRcdH0pO1xuXG5cdFx0XHQvLyB0ZWwgbGlua3Ncblx0XHRcdCQoICdhW2hyZWZePVwidGVsXCJdJyApLmNsaWNrKCBmdW5jdGlvbigpIHtcblx0XHRcdCAgICB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdUZWxlcGhvbmUnLCAnQ2FsbCcsIHRoaXMuaHJlZi5zdWJzdHJpbmcoIDcgKSApO1xuXHRcdFx0fSk7XG5cblx0XHRcdC8vIGludGVybmFsIGxpbmtzXG5cdFx0XHQkKCAnYTpub3QoW2hyZWZePVwiKGh0dHA6fGh0dHBzOik/Ly9cIl0sW2hyZWZePVwiI1wiXSxbaHJlZl49XCJtYWlsdG86XCJdKScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cdFx0XHRcdC8vIHRyYWNrIGRvd25sb2Fkc1xuXHRcdFx0XHRpZiAoICcnICE9PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc3BlY2lhbC5kb3dubG9hZF9yZWdleCApIHtcblx0XHRcdFx0XHR2YXIgdXJsID0gdGhpcy5ocmVmO1xuXHRcdFx0XHRcdHZhciBjaGVja0Rvd25sb2FkID0gbmV3IFJlZ0V4cCggXCJcXFxcLihcIiArIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zcGVjaWFsLmRvd25sb2FkX3JlZ2V4ICsgXCIpKFtcXD8jXS4qKT8kXCIsIFwiaVwiICk7XG5cdFx0XHRcdFx0dmFyIGlzRG93bmxvYWQgPSBjaGVja0Rvd25sb2FkLnRlc3QoIHVybCApO1xuXHRcdFx0XHRcdGlmICggdHJ1ZSA9PT0gaXNEb3dubG9hZCApIHtcblx0XHRcdFx0XHRcdHZhciBjaGVja0Rvd25sb2FkRXh0ZW5zaW9uID0gbmV3IFJlZ0V4cChcIlxcXFwuKFwiICsgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNwZWNpYWwuZG93bmxvYWRfcmVnZXggKyBcIikoW1xcPyNdLiopPyRcIiwgXCJpXCIpO1xuXHRcdFx0XHRcdFx0dmFyIGV4dGVuc2lvblJlc3VsdCA9IGNoZWNrRG93bmxvYWRFeHRlbnNpb24uZXhlYyggdXJsICk7XG5cdFx0XHRcdFx0XHR2YXIgZXh0ZW5zaW9uID0gJyc7XG5cdFx0XHRcdFx0XHRpZiAoIG51bGwgIT09IGV4dGVuc2lvblJlc3VsdCApIHtcblx0XHRcdFx0XHRcdFx0ZXh0ZW5zaW9uID0gZXh0ZW5zaW9uUmVzdWx0WzFdO1xuXHRcdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdFx0ZXh0ZW5zaW9uID0gZXh0ZW5zaW9uUmVzdWx0O1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0Ly8gd2UgY2FuJ3QgdXNlIHRoZSB1cmwgZm9yIHRoZSB2YWx1ZSBoZXJlLCBldmVuIHRob3VnaCB0aGF0IHdvdWxkIGJlIG5pY2UsIGJlY2F1c2UgdmFsdWUgaXMgc3VwcG9zZWQgdG8gYmUgYW4gaW50ZWdlclxuXHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnRG93bmxvYWRzJywgZXh0ZW5zaW9uLCB0aGlzLmhyZWYgKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5hZmZpbGlhdGUuZW5hYmxlZCApIHtcblx0XHRcdC8vIGFueSBsaW5rIGNvdWxkIGJlIGFuIGFmZmlsaWF0ZSwgaSBndWVzcz9cblx0XHRcdCQoICdhJyApLmNsaWNrKCBmdW5jdGlvbigpIHtcblx0XHRcdFx0Ly8gdHJhY2sgYWZmaWxpYXRlc1xuXHRcdFx0XHRpZiAoICcnICE9PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlLmFmZmlsaWF0ZV9yZWdleCApIHtcblx0XHRcdFx0XHR2YXIgY2hlY2tBZmZpbGlhdGUgPSBuZXcgUmVnRXhwKCBcIlxcXFwuKFwiICsgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmFmZmlsaWF0ZS5hZmZpbGlhdGVfcmVnZXggKyBcIikoW1xcPyNdLiopPyRcIiwgXCJpXCIgKTtcblx0XHRcdFx0XHR2YXIgaXNBZmZpbGlhdGUgPSBjaGVja0FmZmlsaWF0ZS50ZXN0KCB1cmwgKTtcblx0XHRcdFx0XHRpZiAoIHRydWUgPT09IGlzQWZmaWxpYXRlICkge1xuXHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnQWZmaWxpYXRlJywgJ0NsaWNrJywgdGhpcy5ocmVmICk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9KTtcblx0XHR9XG5cblx0XHQvLyBiYXNpYyBmb3JtIHN1Ym1pdHNcblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmZvcm1fc3VibWlzc2lvbnMgJiYgdHJ1ZSA9PT0gYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmZvcm1fc3VibWlzc2lvbnMuZW5hYmxlZCApIHtcblx0XHRcdCQoICdpbnB1dFt0eXBlPVwic3VibWl0XCJdLCBidXR0b25bdHlwZT1cInN1Ym1pdFwiXScgKS5jbGljayggZnVuY3Rpb24oIGYgKSB7XG5cdCAgICAgICAgICAgIHZhciBjYXRlZ29yeSA9ICQoIHRoaXMgKS5kYXRhKCAnZ2EtY2F0ZWdvcnknICkgfHwgJ0Zvcm0nO1xuXHQgICAgICAgICAgICB2YXIgYWN0aW9uID0gJCggdGhpcyApLmRhdGEoICdnYS1hY3Rpb24nICkgfHwgJ1N1Ym1pdCc7XG5cdCAgICAgICAgICAgIHZhciBsYWJlbCA9ICQoIHRoaXMgKS5kYXRhKCAnZ2EtbGFiZWwnICkgfHwgdGhpcy5uYW1lIHx8IHRoaXMudmFsdWU7XG5cdCAgICAgICAgICAgIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgY2F0ZWdvcnksIGFjdGlvbiwgbGFiZWwgKTtcblx0ICAgICAgICB9KTtcblx0XHR9XG5cblx0fVxuXG5cdCQoIGRvY3VtZW50ICkucmVhZHkoIGZ1bmN0aW9uKCkge1xuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MudHJhY2tfYWRibG9ja2VyICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy50cmFja19hZGJsb2NrZXIuZW5hYmxlZCApIHtcblx0XHRcdGlmICggdHlwZW9mIHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IgPT09ICd1bmRlZmluZWQnICkge1xuXHRcdFx0XHR3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdBZGJsb2NrJywgJ09uJywgeyAnbm9uSW50ZXJhY3Rpb24nOiAxIH0gKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IuaW5pdChcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHRkZWJ1ZzogZmFsc2UsXG5cdFx0XHRcdFx0XHRmb3VuZDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRcdHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ0FkYmxvY2snLCAnT24nLCB7ICdub25JbnRlcmFjdGlvbic6IDEgfSApO1xuXHRcdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRcdG5vdEZvdW5kOiBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnQWRibG9jaycsICdPZmYnLCB7ICdub25JbnRlcmFjdGlvbic6IDEgfSApO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0KTtcblx0XHRcdH1cblx0XHR9XG5cdH0pO1xuXG59ICkoIGpRdWVyeSApO1xuIl19
