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
//# sourceMappingURL=data:application/json;charset=utf8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImFkYmxvY2tEZXRlY3Rvci5qcyIsImF1dG90cmFjay5qcyIsIndwLWV2ZW50LXRyYWNraW5nLmpzIl0sIm5hbWVzIjpbIndpbiIsInZlcnNpb24iLCJvZnMiLCJjbCIsIm5vb3AiLCJ0ZXN0ZWRPbmNlIiwidGVzdEV4ZWN1dGluZyIsImlzT2xkSUVldmVudHMiLCJhZGRFdmVudExpc3RlbmVyIiwidW5kZWZpbmVkIiwiX29wdGlvbnMiLCJsb29wRGVsYXkiLCJtYXhMb29wIiwiZGVidWciLCJmb3VuZCIsIm5vdGZvdW5kIiwiY29tcGxldGUiLCJwYXJzZUFzSnNvbiIsImRhdGEiLCJyZXN1bHQiLCJmbkRhdGEiLCJKU09OIiwicGFyc2UiLCJleCIsIkZ1bmN0aW9uIiwibG9nIiwiQWpheEhlbHBlciIsIm9wdHMiLCJ4aHIiLCJYTUxIdHRwUmVxdWVzdCIsInN1Y2Nlc3MiLCJmYWlsIiwibWUiLCJtZXRob2QiLCJhYm9ydCIsInN0YXRlQ2hhbmdlIiwidmFscyIsInJlYWR5U3RhdGUiLCJzdGF0dXMiLCJyZXNwb25zZSIsIm9ucmVhZHlzdGF0ZWNoYW5nZSIsInN0YXJ0Iiwib3BlbiIsInVybCIsInNlbmQiLCJCbG9ja0xpc3RUcmFja2VyIiwiZXh0ZXJuYWxCbG9ja2xpc3REYXRhIiwiYWRkVXJsIiwic3RhdGUiLCJmb3JtYXQiLCJzZXRSZXN1bHQiLCJ1cmxLZXkiLCJvYmoiLCJsaXN0ZW5lcnMiLCJiYWl0Tm9kZSIsInF1aWNrQmFpdCIsImNzc0NsYXNzIiwiYmFpdFRyaWdnZXJzIiwibnVsbFByb3BzIiwiemVyb1Byb3BzIiwiZXhlUmVzdWx0IiwicXVpY2siLCJyZW1vdGUiLCJmaW5kUmVzdWx0IiwidGltZXJJZHMiLCJ0ZXN0IiwiZG93bmxvYWQiLCJpc0Z1bmMiLCJmbiIsIm1ha2VFbCIsInRhZyIsImF0dHJpYnV0ZXMiLCJrIiwidiIsImVsIiwiYXR0ciIsImQiLCJkb2N1bWVudCIsImNyZWF0ZUVsZW1lbnQiLCJoYXNPd25Qcm9wZXJ0eSIsInNldEF0dHJpYnV0ZSIsImF0dGFjaEV2ZW50TGlzdGVuZXIiLCJkb20iLCJldmVudE5hbWUiLCJoYW5kbGVyIiwiYXR0YWNoRXZlbnQiLCJtZXNzYWdlIiwiaXNFcnJvciIsImNvbnNvbGUiLCJlcnJvciIsImFqYXhEb3dubG9hZHMiLCJsb2FkRXhlY3V0ZVVybCIsImFqYXgiLCJibG9ja0xpc3RzIiwiaW50ZXJ2YWxJZCIsInJldHJ5Q291bnQiLCJ0cnlFeGVjdXRlVGVzdCIsImxpc3REYXRhIiwiYmVnaW5UZXN0Iiwic2V0SW50ZXJ2YWwiLCJjbGVhckludGVydmFsIiwicHVzaCIsImZldGNoUmVtb3RlTGlzdHMiLCJpIiwibGVuZ3RoIiwiY2FuY2VsUmVtb3RlRG93bmxvYWRzIiwiYWoiLCJwb3AiLCJiYWl0IiwiY2FzdEJhaXQiLCJzZXRUaW1lb3V0IiwicmVlbEluIiwiYiIsImJvZHkiLCJ0IiwiYmFpdFN0eWxlIiwic3R5bGUiLCJhcHBlbmRDaGlsZCIsImF0dGVtcHROdW0iLCJjbGVhckJhaXROb2RlIiwiY2xlYXJUaW1lb3V0IiwiZ2V0QXR0cmlidXRlIiwid2luZG93IiwiZ2V0Q29tcHV0ZWRTdHlsZSIsImJhaXRUZW1wIiwiZ2V0UHJvcGVydHlWYWx1ZSIsIm5vdGlmeUxpc3RlbmVycyIsInJlbW92ZSIsInJlbW92ZUNoaWxkIiwic3RvcEZpc2hpbmciLCJmdW5jcyIsIk1lc3NhZ2UiLCJhdHRhY2hPckZpcmUiLCJmaXJlTm93IiwiaW1wbCIsImluaXQiLCJvcHRpb25zIiwidG9Mb3dlckNhc2UiLCJnIiwiYWEiLCJPYmplY3QiLCJkZWZpbmVQcm9wZXJ0aWVzIiwiZGVmaW5lUHJvcGVydHkiLCJhIiwiYyIsImdldCIsInNldCIsIlR5cGVFcnJvciIsIkFycmF5IiwicHJvdG90eXBlIiwidmFsdWUiLCJnbG9iYWwiLCJsIiwiU3ltYm9sIiwiYmEiLCJjYSIsIm0iLCJpdGVyYXRvciIsImNvbmZpZ3VyYWJsZSIsIndyaXRhYmxlIiwiZGEiLCJlYSIsImRvbmUiLCJuZXh0IiwiZmEiLCJjYWxsIiwibiIsImhhIiwiY29uc3RydWN0b3IiLCJlIiwiZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yIiwicCIsIkVsZW1lbnQiLCJpYSIsIm1hdGNoZXMiLCJtYXRjaGVzU2VsZWN0b3IiLCJ3ZWJraXRNYXRjaGVzU2VsZWN0b3IiLCJtb3pNYXRjaGVzU2VsZWN0b3IiLCJtc01hdGNoZXNTZWxlY3RvciIsIm9NYXRjaGVzU2VsZWN0b3IiLCJqYSIsIm5vZGVUeXBlIiwia2EiLCJwYXJlbnROb2RlIiwicXVlcnlTZWxlY3RvckFsbCIsImxhIiwicSIsImgiLCJjb21wb3NlZCIsImNvbXBvc2VkUGF0aCIsImYiLCJGIiwidGFyZ2V0IiwiY29uY2F0IiwiUyIsImoiLCJyZW1vdmVFdmVudExpc3RlbmVyIiwibWEiLCJuYW1lIiwibmEiLCJyIiwidSIsImxvY2F0aW9uIiwiaHJlZiIsImNoYXJBdCIsInBvcnQiLCJob3N0IiwicmVwbGFjZSIsImhhc2giLCJob3N0bmFtZSIsIm9yaWdpbiIsInByb3RvY29sIiwicGF0aG5hbWUiLCJzZWFyY2giLCJ3Iiwib2EiLCJjb250ZXh0IiwiUCIsImFyZ3VtZW50cyIsImFwcGx5IiwieCIsInBhIiwicWEiLCJ5IiwiaW5kZXhPZiIsInNwbGljZSIsImJpbmQiLCJmaWx0ZXIiLCJ6IiwiYnVpbGRIaXRUYXNrIiwiQSIsIkIiLCJrZXlzIiwiZm9yRWFjaCIsInJhIiwic2xpY2UiLCJzYSIsInRhIiwidWEiLCJDIiwidmEiLCJ0aW1lb3V0IiwiUiIsImFzc2lnbiIsInRvVXBwZXJDYXNlIiwiRCIsIkUiLCJ3YSIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsIkciLCJHb29nbGVBbmFseXRpY3NPYmplY3QiLCJnYURldklkcyIsImdhcGx1Z2lucyIsIkgiLCJUIiwiVSIsIlYiLCJYIiwiWSIsIloiLCIkIiwiVyIsIkkiLCJKIiwicGFyc2VJbnQiLCJzdWJzdHIiLCJLIiwic3RyaXBRdWVyeSIsInF1ZXJ5RGltZW5zaW9uSW5kZXgiLCJwYWdlIiwieGEiLCJpbmRleEZpbGVuYW1lIiwic3BsaXQiLCJqb2luIiwidHJhaWxpbmdTbGFzaCIsInlhIiwidXJsRmllbGRzRmlsdGVyIiwiaXNBcnJheSIsInF1ZXJ5UGFyYW1zV2hpdGVsaXN0IiwibWFwIiwiTCIsImV2ZW50cyIsImZpZWxkc09iaiIsImF0dHJpYnV0ZVByZWZpeCIsInR5cGUiLCJoaXRUeXBlIiwidHJhbnNwb3J0IiwiaGl0RmlsdGVyIiwiemEiLCJJbnRlcnNlY3Rpb25PYnNlcnZlciIsIk11dGF0aW9uT2JzZXJ2ZXIiLCJyb290TWFyZ2luIiwiTSIsIk8iLCJpdGVtcyIsImVsZW1lbnRzIiwib2JzZXJ2ZUVsZW1lbnRzIiwidGhyZXNob2xkIiwiaWQiLCJnZXRFbGVtZW50QnlJZCIsIm9ic2VydmUiLCJjaGlsZExpc3QiLCJzdWJ0cmVlIiwicmVxdWVzdEFuaW1hdGlvbkZyYW1lIiwidW5vYnNlcnZlRWxlbWVudHMiLCJzb21lIiwiQWEiLCJ0cmFja0ZpcnN0SW1wcmVzc2lvbk9ubHkiLCJ1bm9ic2VydmUiLCJkaXNjb25uZWN0IiwidW5vYnNlcnZlQWxsRWxlbWVudHMiLCJyZW1vdmVkTm9kZXMiLCJOIiwiYWRkZWROb2RlcyIsImNoaWxkTm9kZXMiLCJpbnRlcnNlY3Rpb25SYXRpbyIsImludGVyc2VjdGlvblJlY3QiLCJ0b3AiLCJib3R0b20iLCJsZWZ0IiwicmlnaHQiLCJldmVudENhdGVnb3J5IiwiZXZlbnRBY3Rpb24iLCJldmVudExhYmVsIiwibm9uSW50ZXJhY3Rpb24iLCJOYSIsIkJhIiwiQ2EiLCJleHRlcm5hbFNldCIsIlEiLCJEYSIsIkVhIiwibG9jYWxTdG9yYWdlIiwic2V0SXRlbSIsInJlbW92ZUl0ZW0iLCJGYSIsImdldEl0ZW0iLCJzdHJpbmdpZnkiLCJHYSIsImtleSIsIm9sZFZhbHVlIiwibmV3VmFsdWUiLCJIYSIsInRpbWVab25lIiwiSW50bCIsIkRhdGVUaW1lRm9ybWF0IiwiaGl0VGltZSIsImlzRXhwaXJlZCIsIklhIiwiRGF0ZSIsImluY3JlYXNlVGhyZXNob2xkIiwic2Vzc2lvblRpbWVvdXQiLCJKYSIsIm8iLCJLYSIsImRvY3VtZW50RWxlbWVudCIsIm1pbiIsIm1heCIsInJvdW5kIiwicGFnZVlPZmZzZXQiLCJvZmZzZXRIZWlnaHQiLCJzY3JvbGxIZWlnaHQiLCJpbm5lckhlaWdodCIsInNlc3Npb25JZCIsImV2ZW50VmFsdWUiLCJTdHJpbmciLCJtYXhTY3JvbGxNZXRyaWNJbmRleCIsIkxhIiwiTWEiLCJtYXRjaE1lZGlhIiwiY2hhbmdlVGVtcGxhdGUiLCJjaGFuZ2VUaW1lb3V0IiwiZGVmaW5pdGlvbnMiLCJPYSIsImRpbWVuc2lvbkluZGV4IiwiUGEiLCJRYSIsIlJhIiwibWVkaWEiLCJhZGRMaXN0ZW5lciIsInJlbW92ZUxpc3RlbmVyIiwiZm9ybVNlbGVjdG9yIiwic2hvdWxkVHJhY2tPdXRib3VuZEZvcm0iLCJhY3Rpb24iLCJuYXZpZ2F0b3IiLCJzZW5kQmVhY29uIiwicHJldmVudERlZmF1bHQiLCJoaXRDYWxsYmFjayIsInN1Ym1pdCIsImxpbmtTZWxlY3RvciIsInNob3VsZFRyYWNrT3V0Ym91bmRMaW5rIiwibWV0YUtleSIsImN0cmxLZXkiLCJzaGlmdEtleSIsImFsdEtleSIsIndoaWNoIiwiZGVmYXVsdFByZXZlbnRlZCIsIlNhIiwidmlzaWJpbGl0eVN0YXRlIiwidmlzaWJsZVRocmVzaG9sZCIsInNlbmRJbml0aWFsUGFnZXZpZXciLCJzIiwiVGEiLCJ0aW1lIiwicGFnZUlkIiwicGFnZUxvYWRzTWV0cmljSW5kZXgiLCJVYSIsIlZhIiwicXVldWVUaW1lIiwidmlzaWJsZU1ldHJpY0luZGV4IiwiV2EiLCJGQiIsIkV2ZW50Iiwic3Vic2NyaWJlIiwidHd0dHIiLCJyZWFkeSIsIlhhIiwidW5iaW5kIiwicmVnaW9uIiwic29jaWFsTmV0d29yayIsInNvY2lhbEFjdGlvbiIsInNvY2lhbFRhcmdldCIsInNjcmVlbl9uYW1lIiwidW5zdWJzY3JpYmUiLCJZYSIsImhpc3RvcnkiLCJwdXNoU3RhdGUiLCJzaG91bGRUcmFja1VybENoYW5nZSIsInRyYWNrUmVwbGFjZVN0YXRlIiwiWmEiLCJ0aXRsZSIsIndwX2FuYWx5dGljc190cmFja2luZ19ldmVudCIsImNhdGVnb3J5IiwibGFiZWwiLCJnYSIsImFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncyIsInNjcm9sbCIsImVuYWJsZWQiLCJzY3JvbGxEZXB0aCIsIm1pbkhlaWdodCIsIm1pbmltdW1faGVpZ2h0Iiwic2Nyb2xsX2VsZW1lbnRzIiwicGVyY2VudGFnZSIsInVzZXJUaW1pbmciLCJ1c2VyX3RpbWluZyIsInBpeGVsRGVwdGgiLCJwaXhlbF9kZXB0aCIsIm5vbl9pbnRlcmFjdGlvbiIsInNwZWNpYWwiLCJkb21haW4iLCJjbGljayIsInN1YnN0cmluZyIsImRvd25sb2FkX3JlZ2V4IiwiY2hlY2tEb3dubG9hZCIsIlJlZ0V4cCIsImlzRG93bmxvYWQiLCJjaGVja0Rvd25sb2FkRXh0ZW5zaW9uIiwiZXh0ZW5zaW9uUmVzdWx0IiwiZXhlYyIsImV4dGVuc2lvbiIsImFmZmlsaWF0ZSIsImFmZmlsaWF0ZV9yZWdleCIsImNoZWNrQWZmaWxpYXRlIiwiaXNBZmZpbGlhdGUiLCJmcmFnbWVudCIsIm9uaGFzaGNoYW5nZSIsImZvcm1fc3VibWlzc2lvbnMiLCJ0cmFja19hZGJsb2NrZXIiLCJhZGJsb2NrRGV0ZWN0b3IiLCJub3RGb3VuZCIsImpRdWVyeSJdLCJtYXBwaW5ncyI6IkFBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUE7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBaUNBOztBQUNBLENBQUMsVUFBU0EsR0FBVCxFQUFjO0FBRWQsTUFBSUMsT0FBTyxHQUFHLEtBQWQ7QUFFQSxNQUFJQyxHQUFHLEdBQUcsUUFBVjtBQUFBLE1BQW9CQyxFQUFFLEdBQUcsUUFBekI7O0FBQ0EsTUFBSUMsSUFBSSxHQUFHLFNBQVBBLElBQU8sR0FBVSxDQUFFLENBQXZCOztBQUVBLE1BQUlDLFVBQVUsR0FBRyxLQUFqQjtB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OUIsT0FBaEksRUFBMEk7QUFDekksVUFBSyxPQUFPN1QsTUFBTSxDQUFDNFYsZUFBZCxLQUFrQyxXQUF2QyxFQUFxRDtBQUNwRHJDLFFBQUFBLDJCQUEyQixDQUFFLE9BQUYsRUFBVyxTQUFYLEVBQXNCLElBQXRCLEVBQTRCO0FBQUUsNEJBQWtCO0FBQXBCLFNBQTVCLENBQTNCO0FBQ0EsT0FGRCxNQUVPO0FBQ052VCxRQUFBQSxNQUFNLENBQUM0VixlQUFQLENBQXVCL1UsSUFBdkIsQ0FDQztBQUNDMUgsVUFBQUEsS0FBSyxFQUFFLEtBRFI7QUFFQ0MsVUFBQUEsS0FBSyxFQUFFLGlCQUFXO0FBQ2pCbWEsWUFBQUEsMkJBQTJCLENBQUUsT0FBRixFQUFXLFNBQVgsRUFBc0IsSUFBdEIsRUFBNEI7QUFBRSxnQ0FBa0I7QUFBcEIsYUFBNUIsQ0FBM0I7QUFDQSxXQUpGO0FBS0NzQyxVQUFBQSxRQUFRLEVBQUUsb0JBQVc7QUFDcEJ0QyxZQUFBQSwyQkFBMkIsQ0FBRSxPQUFGLEVBQVcsU0FBWCxFQUFzQixLQUF0QixFQUE2QjtBQUFFLGdDQUFrQjtBQUFwQixhQUE3QixDQUEzQjtBQUNBO0FBUEYsU0FERDtBQVdBO0FBQ0Q7QUFDRCxHQWxCRDtBQW9CQSxDQXZJRCxFQXVJS3VDLE1BdklMIiwiZmlsZSI6IndwLWFuYWx5dGljcy10cmFja2luZy1nZW5lcmF0b3ItZnJvbnQtZW5kLmpzIiwic291cmNlc0NvbnRlbnQiOlsiLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cbi8vIEFkQmxvY2sgZGV0ZWN0b3Jcbi8vXG4vLyBBdHRlbXB0cyB0byBkZXRlY3QgdGhlIHByZXNlbmNlIG9mIEFkIEJsb2NrZXIgc29mdHdhcmUgYW5kIG5vdGlmeSBsaXN0ZW5lciBvZiBpdHMgZXhpc3RlbmNlLlxuLy8gQ29weXJpZ2h0IChjKSAyMDE3IElBQlxuLy9cbi8vIFRoZSBCU0QtMyBMaWNlbnNlXG4vLyBSZWRpc3RyaWJ1dGlvbiBhbmQgdXNlIGluIHNvdXJjZSBhbmQgYmluYXJ5IGZvcm1zLCB3aXRoIG9yIHdpdGhvdXQgbW9kaWZpY2F0aW9uLCBhcmUgcGVybWl0dGVkIHByb3ZpZGVkIHRoYXQgdGhlIGZvbGxvd2luZyBjb25kaXRpb25zIGFyZSBtZXQ6XG4vLyAxLiBSZWRpc3RyaWJ1dGlvbnMgb2Ygc291cmNlIGNvZGUgbXVzdCByZXRhaW4gdGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UsIHRoaXMgbGlzdCBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIuXG4vLyAyLiBSZWRpc3RyaWJ1dGlvbnMgaW4gYmluYXJ5IGZvcm0gbXVzdCByZXByb2R1Y2UgdGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UsIHRoaXMgbGlzdCBvZiBjb25kaXRpb25zIGFuZCB0aGUgZm9sbG93aW5nIGRpc2NsYWltZXIgaW4gdGhlIGRvY3VtZW50YXRpb24gYW5kL29yIG90aGVyIG1hdGVyaWFscyBwcm92aWRlZCB3aXRoIHRoZSBkaXN0cmlidXRpb24uXG4vLyAzLiBOZWl0aGVyIHRoZSBuYW1lIG9mIHRoZSBjb3B5cmlnaHQgaG9sZGVyIG5vciB0aGUgbmFtZXMgb2YgaXRzIGNvbnRyaWJ1dG9ycyBtYXkgYmUgdXNlZCB0byBlbmRvcnNlIG9yIHByb21vdGUgcHJvZHVjdHMgZGVyaXZlZCBmcm9tIHRoaXMgc29mdHdhcmUgd2l0aG91dCBzcGVjaWZpYyBwcmlvciB3cml0dGVuIHBlcm1pc3Npb24uXG4vLyBUSElTIFNPRlRXQVJFIElTIFBST1ZJREVEIEJZIFRIRSBDT1BZUklHSFQgSE9MREVSUyBBTkQgQ09OVFJJQlVUT1JTIFwiQVMgSVNcIiBBTkQgQU5ZIEVYUFJFU1MgT1IgSU1QTElFRCBXQVJSQU5USUVTLCBJTkNMVURJTkcsIEJVVCBOT1QgTElNSVRFRCBUTywgVEhFIElNUExJRUQgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFkgQU5EIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFSRSBESVNDTEFJTUVELiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQ09QWVJJR0hUIEhPTERFUiBPUiBDT05UUklCVVRPUlMgQkUgTElBQkxFIEZPUiBBTlkgRElSRUNULCBJTkRJUkVDVCwgSU5DSURFTlRBTCwgU1BFQ0lBTCwgRVhFTVBMQVJZLCBPUiBDT05TRVFVRU5USUFMIERBTUFHRVMgKElOQ0xVRElORywgQlVUIE5PVCBMSU1JVEVEIFRPLCBQUk9DVVJFTUVOVCBPRiBTVUJTVElUVVRFIEdPT0RTIE9SIFNFUlZJQ0VTOyBMT1NTIE9GIFVTRSwgREFUQSwgT1IgUFJPRklUUzsgT1IgQlVTSU5FU1MgSU5URVJSVVBUSU9OKSBIT1dFVkVSIENBVVNFRCBBTkQgT04gQU5ZIFRIRU9SWSBPRiBMSUFCSUxJVFksIFdIRVRIRVIgSU4gQ09OVFJBQ1QsIFNUUklDVCBMSUFCSUxJVFksIE9SIFRPUlQgKElOQ0xVRElORyBORUdMSUdFTkNFIE9SIE9USEVSV0lTRSkgQVJJU0lORyBJTiBBTlkgV0FZIE9VVCBPRiBUSEUgVVNFIE9GIFRISVMgU09GVFdBUkUsIEVWRU4gSUYgQURWSVNFRCBPRiBUSEUgUE9TU0lCSUxJVFkgT0YgU1VDSCBEQU1BR0UuXG4vLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxuXG4vKipcbiogQG5hbWUgd2luZG93LmFkYmxvY2tEZXRlY3RvclxuKlxuKiBJQUIgQWRibG9jayBkZXRlY3Rvci5cbiogVXNhZ2U6IHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IuaW5pdChvcHRpb25zKTtcbipcbiogT3B0aW9ucyBvYmplY3Qgc2V0dGluZ3NcbipcbipcdEBwcm9wIGRlYnVnOiAgYm9vbGVhblxuKiAgICAgICAgIEZsYWcgdG8gaW5kaWNhdGUgYWRkaXRpb25hbCBkZWJ1ZyBvdXRwdXQgc2hvdWxkIGJlIHByaW50ZWQgdG8gY29uc29sZVxuKlxuKlx0QHByb3AgZm91bmQ6IEBmdW5jdGlvblxuKiAgICAgICAgIENhbGxiYWNrIGZ1bmN0aW9uIHRvIGZpcmUgaWYgYWRibG9jayBpcyBkZXRlY3RlZFxuKlxuKlx0QHByb3Agbm90Zm91bmQ6IEBmdW5jdGlvblxuKiAgICAgICAgIENhbGxiYWNrIGZ1bmN0aW9uIHRvIGZpcmUgaWYgYWRibG9jayBpcyBub3QgZGV0ZWN0ZWQuXG4qICAgICAgICAgTk9URTogdGhpcyBmdW5jdGlvbiBtYXkgZmlyZSBtdWx0aXBsZSB0aW1lcyBhbmQgZ2l2ZSBmYWxzZSBuZWdhdGl2ZVxuKiAgICAgICAgIHJlc3BvbnNlcyBkdXJpbmcgYSB0ZXN0IHVudGlsIGFkYmxvY2sgaXMgc3VjY2Vzc2Z1bGx5IGRldGVjdGVkLlxuKlxuKlx0QHByb3AgY29tcGxldGU6IEBmdW5jdGlvblxuKiAgICAgICAgIENhbGxiYWNrIGZ1bmN0aW9uIHRvIGZpcmUgb25jZSBhIHJvdW5kIG9mIHRlc3RpbmcgaXMgY29tcGxldGUuXG4qICAgICAgICAgVGhlIHRlc3QgcmVzdWx0IChib29sZWFuKSBpcyBpbmNsdWRlZCBhcyBhIHBhcmFtZXRlciB0byBjYWxsYmFja1xuKlxuKiBleGFtcGxlOiBcdHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IuaW5pdChcblx0XHRcdFx0e1xuXHRcdFx0XHRcdGZvdW5kOiBmdW5jdGlvbigpeyAuLi59LFxuIFx0XHRcdFx0XHRub3RGb3VuZDogZnVuY3Rpb24oKXsuLi59XG5cdFx0XHRcdH1cblx0XHRcdCk7XG4qXG4qXG4qL1xuXG5cInVzZSBzdHJpY3RcIjtcbihmdW5jdGlvbih3aW4pIHtcblxuXHR2YXIgdmVyc2lvbiA9ICcxLjAnO1xuXG5cdHZhciBvZnMgPSAnb2Zmc2V0JywgY2wgPSAnY2xpZW50Jztcblx0dmFyIG5vb3AgPSBmdW5jdGlvbigpe307XG5cblx0dmFyIHRlc3RlZE9uY2UgPSBmYWxzZTtcblx0dmFyIHRlc3RFeGVjdXRpbmcgPSBmYWxzZTtcblxuXHR2YXIgaXNPbGRJRWV2ZW50cyA9ICh3aW4uYWRkRXZlbnRMaXN0ZW5lciA9PT0gdW5kZWZpbmVkKTtcblxuXHQvKipcblx0KiBPcHRpb25zIHNldCB3aXRoIGRlZmF1bHQgb3B0aW9ucyBpbml0aWFsaXplZFxuXHQqXG5cdCovXG5cdHZhciBfb3B0aW9ucyA9IHtcblx0XHRsb29wRGVsYXk6IDUwLFxuXHRcdG1heExvb3A6IDUsXG5cdFx0ZGVidWc6IHRydWUsXG5cdFx0Zm91bmQ6IG5vb3AsIFx0XHRcdFx0XHQvLyBmdW5jdGlvbiB0byBmaXJlIHdoZW4gYWRibG9jayBkZXRlY3RlZFxuXHRcdG5vdGZvdW5kOiBub29wLCBcdFx0XHRcdC8vIGZ1bmN0aW9uIHRvIGZpcmUgaWYgYWRibG9jayBub3QgZGV0ZWN0ZWQgYWZ0ZXIgdGVzdGluZ1xuXHRcdGNvbXBsZXRlOiBub29wICBcdFx0XHRcdC8vIGZ1bmN0aW9uIHRvIGZpcmUgYWZ0ZXIgdGVzdGluZyBjb21wbGV0ZXMsIHBhc3NpbmcgcmVzdWx0IGFzIHBhcmFtZXRlclxuXHR9XG5cblx0ZnVuY3Rpb24gcGFyc2VBc0pzb24oZGF0YSl7XG5cdFx0dmFyIHJlc3VsdCwgZm5EYXRhO1xuXHRcdHRyeXtcblx0XHRcdHJlc3VsdCA9IEpTT04ucGFyc2UoZGF0YSk7XG5cdFx0fVxuXHRcdGNhdGNoKGV4KXtcblx0XHRcdHRyeXtcblx0XHRcdFx0Zm5EYXRhID0gbmV3IEZ1bmN0aW9uKFwicmV0dXJuIFwiICsgZGF0YSk7XG5cdFx0XHRcdHJlc3VsdCA9IGZuRGF0YSgpO1xuXHRcdFx0fVxuXHRcdFx0Y2F0Y2goZXgpe1xuXHRcdFx0XHRsb2coJ0ZhaWxlZCBzZWNvbmRhcnkgSlNPTiBwYXJzZScsIHRydWUpO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiByZXN1bHQ7XG5cdH1cblxuXHQvKipcblx0KiBBamF4IGhlbHBlciBvYmplY3QgdG8gZG93bmxvYWQgZXh0ZXJuYWwgc2NyaXB0cy5cblx0KiBJbml0aWFsaXplIG9iamVjdCB3aXRoIGFuIG9wdGlvbnMgb2JqZWN0XG5cdCogRXg6XG5cdCAge1xuXHRcdCAgdXJsIDogJ2h0dHA6Ly9leGFtcGxlLm9yZy91cmxfdG9fZG93bmxvYWQnLFxuXHRcdCAgbWV0aG9kOiAnUE9TVHxHRVQnLFxuXHRcdCAgc3VjY2VzczogY2FsbGJhY2tfZnVuY3Rpb24sXG5cdFx0ICBmYWlsOiAgY2FsbGJhY2tfZnVuY3Rpb25cblx0ICB9XG5cdCovXG5cdHZhciBBamF4SGVscGVyID0gZnVuY3Rpb24ob3B0cyl7XG5cdFx0dmFyIHhociA9IG5ldyBYTUxIdHRwUmVxdWVzdCgpO1xuXG5cdFx0dGhpcy5zdWNjZXNzID0gb3B0cy5zdWNjZXNzIHx8IG5vb3A7XG5cdFx0dGhpcy5mYWlsID0gb3B0cy5mYWlsIHx8IG5vb3A7XG5cdFx0dmFyIG1lID0gdGhpcztcblxuXHRcdHZhciBtZXRob2QgPSBvcHRzLm1ldGhvZCB8fCAnZ2V0JztcblxuXHRcdC8qKlxuXHRcdCogQWJvcnQgdGhlIHJlcXVlc3Rcblx0XHQqL1xuXHRcdHRoaXMuYWJvcnQgPSBmdW5jdGlvbigpe1xuXHRcdFx0dHJ5e1xuXHRcdFx0XHR4aHIuYWJvcnQoKTtcblx0XHRcdH1cblx0XHRcdGNhdGNoKGV4KXtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmdW5jdGlvbiBzdGF0ZUNoYW5nZSh2YWxzKXtcblx0XHRcdGlmKHhoci5yZWFkeVN0YXRlID09IDQpe1xuXHRcdFx0XHRpZih4aHIuc3RhdHVzID09IDIwMCl7XG5cdFx0XHRcdFx0bWUuc3VjY2Vzcyh4aHIucmVzcG9uc2UpO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGVsc2V7XG5cdFx0XHRcdFx0Ly8gZmFpbGVkXG5cdFx0XHRcdFx0bWUuZmFpbCh4aHIuc3RhdHVzKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHhoci5vbnJlYWR5c3RhdGVjaGFuZ2UgPSBzdGF0ZUNoYW5nZTtcblxuXHRcdGZ1bmN0aW9uIHN0YXJ0KCl7XG5cdFx0XHR4aHIub3BlbihtZXRob2QsIG9wdHMudXJsLCB0cnVlKTtcblx0XHRcdHhoci5zZW5kKCk7XG5cdFx0fVxuXG5cdFx0c3RhcnQoKTtcblx0fVxuXG5cdC8qKlxuXHQqIE9iamVjdCB0cmFja2luZyB0aGUgdmFyaW91cyBibG9jayBsaXN0c1xuXHQqL1xuXHR2YXIgQmxvY2tMaXN0VHJhY2tlciA9IGZ1bmN0aW9uKCl7XG5cdFx0dmFyIG1lID0gdGhpcztcblx0XHR2YXIgZXh0ZXJuYWxCbG9ja2xpc3REYXRhID0ge307XG5cblx0XHQvKipcblx0XHQqIEFkZCBhIG5ldyBleHRlcm5hbCBVUkwgdG8gdHJhY2tcblx0XHQqL1xuXHRcdHRoaXMuYWRkVXJsID0gZnVuY3Rpb24odXJsKXtcblx0XHRcdGV4dGVybmFsQmxvY2tsaXN0RGF0YVt1cmxdID0ge1xuXHRcdFx0XHR1cmw6IHVybCxcblx0XHRcdFx0c3RhdGU6ICdwZW5kaW5nJyxcblx0XHRcdFx0Zm9ybWF0OiBudWxsLFxuXHRcdFx0XHRkYXRhOiBudWxsLFxuXHRcdFx0XHRyZXN1bHQ6IG51bGxcblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGV4dGVybmFsQmxvY2tsaXN0RGF0YVt1cmxdO1xuXHRcdH1cblxuXHRcdC8qKlxuXHRcdCogTG9hZHMgYSBibG9jayBsaXN0IGRlZmluaXRpb25cblx0XHQqL1xuXHRcdHRoaXMuc2V0UmVzdWx0ID0gZnVuY3Rpb24odXJsS2V5LCBzdGF0ZSwgZGF0YSl7XG5cdFx0XHR2YXIgb2JqID0gZXh0ZXJuYWxCbG9ja2xpc3REYXRhW3VybEtleV07XG5cdFx0XHRpZihvYmogPT0gbnVsbCl7XG5cdFx0XHRcdG9iaiA9IHRoaXMuYWRkVXJsKHVybEtleSk7XG5cdFx0XHR9XG5cblx0XHRcdG9iai5zdGF0ZSA9IHN0YXRlO1xuXHRcdFx0aWYoZGF0YSA9PSBudWxsKXtcblx0XHRcdFx0b2JqLnJlc3VsdCA9IG51bGw7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0aWYodHlwZW9mIGRhdGEgPT09ICdzdHJpbmcnKXtcblx0XHRcdFx0dHJ5e1xuXHRcdFx0XHRcdGRhdGEgPSBwYXJzZUFzSnNvbihkYXRhKTtcblx0XHRcdFx0XHRvYmouZm9ybWF0ID0gJ2pzb24nO1xuXHRcdFx0XHR9XG5cdFx0XHRcdGNhdGNoKGV4KXtcblx0XHRcdFx0XHRvYmouZm9ybWF0ID0gJ2Vhc3lsaXN0Jztcblx0XHRcdFx0XHQvLyBwYXJzZUVhc3lMaXN0KGRhdGEpO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRvYmouZGF0YSA9IGRhdGE7XG5cblx0XHRcdHJldHVybiBvYmo7XG5cdFx0fVxuXG5cdH1cblxuXHR2YXIgbGlzdGVuZXJzID0gW107IC8vIGV2ZW50IHJlc3BvbnNlIGxpc3RlbmVyc1xuXHR2YXIgYmFpdE5vZGUgPSBudWxsO1xuXHR2YXIgcXVpY2tCYWl0ID0ge1xuXHRcdGNzc0NsYXNzOiAncHViXzMwMHgyNTAgcHViXzMwMHgyNTBtIHB1Yl83Mjh4OTAgdGV4dC1hZCB0ZXh0QWQgdGV4dF9hZCB0ZXh0X2FkcyB0ZXh0LWFkcyB0ZXh0LWFkLWxpbmtzJ1xuXHR9O1xuXHR2YXIgYmFpdFRyaWdnZXJzID0ge1xuXHRcdG51bGxQcm9wczogW29mcyArICdQYXJlbnQnXSxcblx0XHR6ZXJvUHJvcHM6IFtdXG5cdH07XG5cblx0YmFpdFRyaWdnZXJzLnplcm9Qcm9wcyA9IFtcblx0XHRvZnMgKydIZWlnaHQnLCBvZnMgKydMZWZ0Jywgb2ZzICsnVG9wJywgb2ZzICsnV2lkdGgnLCBvZnMgKydIZWlnaHQnLFxuXHRcdGNsICsgJ0hlaWdodCcsIGNsICsgJ1dpZHRoJ1xuXHRdO1xuXG5cdC8vIHJlc3VsdCBvYmplY3Rcblx0dmFyIGV4ZVJlc3VsdCA9IHtcblx0XHRxdWljazogbnVsbCxcblx0XHRyZW1vdGU6IG51bGxcblx0fTtcblxuXHR2YXIgZmluZFJlc3VsdCA9IG51bGw7IC8vIHJlc3VsdCBvZiB0ZXN0IGZvciBhZCBibG9ja2VyXG5cblx0dmFyIHRpbWVySWRzID0ge1xuXHRcdHRlc3Q6IDAsXG5cdFx0ZG93bmxvYWQ6IDBcblx0fTtcblxuXHRmdW5jdGlvbiBpc0Z1bmMoZm4pe1xuXHRcdHJldHVybiB0eXBlb2YoZm4pID09ICdmdW5jdGlvbic7XG5cdH1cblxuXHQvKipcblx0KiBNYWtlIGEgRE9NIGVsZW1lbnRcblx0Ki9cblx0ZnVuY3Rpb24gbWFrZUVsKHRhZywgYXR0cmlidXRlcyl7XG5cdFx0dmFyIGssIHYsIGVsLCBhdHRyID0gYXR0cmlidXRlcztcblx0XHR2YXIgZCA9IGRvY3VtZW50O1xuXG5cdFx0ZWwgPSBkLmNyZWF0ZUVsZW1lbnQodGFnKTtcblxuXHRcdGlmKGF0dHIpe1xuXHRcdFx0Zm9yKGsgaW4gYXR0cil7XG5cdFx0XHRcdGlmKGF0dHIuaGFzT3duUHJvcGVydHkoaykpe1xuXHRcdFx0XHRcdGVsLnNldEF0dHJpYnV0ZShrLCBhdHRyW2tdKTtcblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBlbDtcblx0fVxuXG5cdGZ1bmN0aW9uIGF0dGFjaEV2ZW50TGlzdGVuZXIoZG9tLCBldmVudE5hbWUsIGhhbmRsZXIpe1xuXHRcdGlmKGlzT2xkSUVldmVudHMpe1xuXHRcdFx0ZG9tLmF0dGFjaEV2ZW50KCdvbicgKyBldmVudE5hbWUsIGhhbmRsZXIpO1xuXHRcdH1cblx0XHRlbHNle1xuXHRcdFx0ZG9tLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBoYW5kbGVyLCBmYWxzZSk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gbG9nKG1lc3NhZ2UsIGlzRXJyb3Ipe1xuXHRcdGlmKCFfb3B0aW9ucy5kZWJ1ZyAmJiAhaXNFcnJvcil7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGlmKHdpbi5jb25zb2xlICYmIHdpbi5jb25zb2xlLmxvZyl7XG5cdFx0XHRpZihpc0Vycm9yKXtcblx0XHRcdFx0Y29uc29sZS5lcnJvcignW0FCRF0gJyArIG1lc3NhZ2UpO1xuXHRcdFx0fVxuXHRcdFx0ZWxzZXtcblx0XHRcdFx0Y29uc29sZS5sb2coJ1tBQkRdICcgKyBtZXNzYWdlKTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHR2YXIgYWpheERvd25sb2FkcyA9IFtdO1xuXG5cdC8qKlxuXHQqIExvYWQgYW5kIGV4ZWN1dGUgdGhlIFVSTCBpbnNpZGUgYSBjbG9zdXJlIGZ1bmN0aW9uXG5cdCovXG5cdGZ1bmN0aW9uIGxvYWRFeGVjdXRlVXJsKHVybCl7XG5cdFx0dmFyIGFqYXgsIHJlc3VsdDtcblxuXHRcdGJsb2NrTGlzdHMuYWRkVXJsKHVybCk7XG5cdFx0Ly8gc2V0dXAgY2FsbCBmb3IgcmVtb3RlIGxpc3Rcblx0XHRhamF4ID0gbmV3IEFqYXhIZWxwZXIoXG5cdFx0XHR7XG5cdFx0XHRcdHVybDogdXJsLFxuXHRcdFx0XHRzdWNjZXNzOiBmdW5jdGlvbihkYXRhKXtcblx0XHRcdFx0XHRsb2coJ2Rvd25sb2FkZWQgZmlsZSAnICsgdXJsKTsgLy8gdG9kbyAtIHBhcnNlIGFuZCBzdG9yZSB1bnRpbCB1c2Vcblx0XHRcdFx0XHRyZXN1bHQgPSBibG9ja0xpc3RzLnNldFJlc3VsdCh1cmwsICdzdWNjZXNzJywgZGF0YSk7XG5cdFx0XHRcdFx0dHJ5e1xuXHRcdFx0XHRcdFx0dmFyIGludGVydmFsSWQgPSAwLFxuXHRcdFx0XHRcdFx0XHRyZXRyeUNvdW50ID0gMDtcblxuXHRcdFx0XHRcdFx0dmFyIHRyeUV4ZWN1dGVUZXN0ID0gZnVuY3Rpb24obGlzdERhdGEpe1xuXHRcdFx0XHRcdFx0XHRpZighdGVzdEV4ZWN1dGluZyl7XG5cdFx0XHRcdFx0XHRcdFx0YmVnaW5UZXN0KGxpc3REYXRhLCB0cnVlKTtcblx0XHRcdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRcdGlmKGZpbmRSZXN1bHQgPT0gdHJ1ZSl7XG5cdFx0XHRcdFx0XHRcdHJldHVybjtcblx0XHRcdFx0XHRcdH1cblxuXHRcdFx0XHRcdFx0aWYodHJ5RXhlY3V0ZVRlc3QocmVzdWx0LmRhdGEpKXtcblx0XHRcdFx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdFx0ZWxzZXtcblx0XHRcdFx0XHRcdFx0bG9nKCdQYXVzZSBiZWZvcmUgdGVzdCBleGVjdXRpb24nKTtcblx0XHRcdFx0XHRcdFx0aW50ZXJ2YWxJZCA9IHNldEludGVydmFsKGZ1bmN0aW9uKCl7XG5cdFx0XHRcdFx0XHRcdFx0aWYodHJ5RXhlY3V0ZVRlc3QocmVzdWx0LmRhdGEpIHx8IHJldHJ5Q291bnQrKyA+IDUpe1xuXHRcdFx0XHRcdFx0XHRcdFx0Y2xlYXJJbnRlcnZhbChpbnRlcnZhbElkKTtcblx0XHRcdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHRcdH0sIDI1MCk7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGNhdGNoKGV4KXtcblx0XHRcdFx0XHRcdGxvZyhleC5tZXNzYWdlICsgJyB1cmw6ICcgKyB1cmwsIHRydWUpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fSxcblx0XHRcdFx0ZmFpbDogZnVuY3Rpb24oc3RhdHVzKXtcblx0XHRcdFx0XHRsb2coc3RhdHVzLCB0cnVlKTtcblx0XHRcdFx0XHRibG9ja0xpc3RzLnNldFJlc3VsdCh1cmwsICdlcnJvcicsIG51bGwpO1xuXHRcdFx0XHR9XG5cdFx0XHR9KTtcblxuXHRcdGFqYXhEb3dubG9hZHMucHVzaChhamF4KTtcblx0fVxuXG5cblx0LyoqXG5cdCogRmV0Y2ggdGhlIGV4dGVybmFsIGxpc3RzIGFuZCBpbml0aWF0ZSB0aGUgdGVzdHNcblx0Ki9cblx0ZnVuY3Rpb24gZmV0Y2hSZW1vdGVMaXN0cygpe1xuXHRcdHZhciBpLCB1cmw7XG5cdFx0dmFyIG9wdHMgPSBfb3B0aW9ucztcblxuXHRcdGZvcihpPTA7aTxvcHRzLmJsb2NrTGlzdHMubGVuZ3RoO2krKyl7XG5cdFx0XHR1cmwgPSBvcHRzLmJsb2NrTGlzdHNbaV07XG5cdFx0XHRsb2FkRXhlY3V0ZVVybCh1cmwpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGNhbmNlbFJlbW90ZURvd25sb2Fkcygpe1xuXHRcdHZhciBpLCBhajtcblxuXHRcdGZvcihpPWFqYXhEb3dubG9hZHMubGVuZ3RoLTE7aSA+PSAwO2ktLSl7XG5cdFx0XHRhaiA9IGFqYXhEb3dubG9hZHMucG9wKCk7XG5cdFx0XHRhai5hYm9ydCgpO1xuXHRcdH1cblx0fVxuXG5cblx0Ly8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cblx0LyoqXG5cdCogQmVnaW4gZXhlY3V0aW9uIG9mIHRoZSB0ZXN0XG5cdCovXG5cdGZ1bmN0aW9uIGJlZ2luVGVzdChiYWl0KXtcblx0XHRsb2coJ3N0YXJ0IGJlZ2luVGVzdCcpO1xuXHRcdGlmKGZpbmRSZXN1bHQgPT0gdHJ1ZSl7XG5cdFx0XHRyZXR1cm47IC8vIHdlIGZvdW5kIGl0LiBkb24ndCBjb250aW51ZSBleGVjdXRpbmdcblx0XHR9XG5cdFx0dGVzdEV4ZWN1dGluZyA9IHRydWU7XG5cdFx0Y2FzdEJhaXQoYmFpdCk7XG5cblx0XHRleGVSZXN1bHQucXVpY2sgPSAndGVzdGluZyc7XG5cblx0XHR0aW1lcklkcy50ZXN0ID0gc2V0VGltZW91dChcblx0XHRcdGZ1bmN0aW9uKCl7IHJlZWxJbihiYWl0LCAxKTsgfSxcblx0XHRcdDUpO1xuXHR9XG5cblx0LyoqXG5cdCogQ3JlYXRlIHRoZSBiYWl0IG5vZGUgdG8gc2VlIGhvdyB0aGUgYnJvd3NlciBwYWdlIHJlYWN0c1xuXHQqL1xuXHRmdW5jdGlvbiBjYXN0QmFpdChiYWl0KXtcblx0XHR2YXIgaSwgZCA9IGRvY3VtZW50LCBiID0gZC5ib2R5O1xuXHRcdHZhciB0O1xuXHRcdHZhciBiYWl0U3R5bGUgPSAnd2lkdGg6IDFweCAhaW1wb3J0YW50OyBoZWlnaHQ6IDFweCAhaW1wb3J0YW50OyBwb3NpdGlvbjogYWJzb2x1dGUgIWltcG9ydGFudDsgbGVmdDogLTEwMDAwcHggIWltcG9ydGFudDsgdG9wOiAtMTAwMHB4ICFpbXBvcnRhbnQ7J1xuXG5cdFx0aWYoYmFpdCA9PSBudWxsIHx8IHR5cGVvZihiYWl0KSA9PSAnc3RyaW5nJyl7XG5cdFx0XHRsb2coJ2ludmFsaWQgYmFpdCBiZWluZyBjYXN0Jyk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0aWYoYmFpdC5zdHlsZSAhPSBudWxsKXtcblx0XHRcdGJhaXRTdHlsZSArPSBiYWl0LnN0eWxlO1xuXHRcdH1cblxuXHRcdGJhaXROb2RlID0gbWFrZUVsKCdkaXYnLCB7XG5cdFx0XHQnY2xhc3MnOiBiYWl0LmNzc0NsYXNzLFxuXHRcdFx0J3N0eWxlJzogYmFpdFN0eWxlXG5cdFx0fSk7XG5cblx0XHRsb2coJ2FkZGluZyBiYWl0IG5vZGUgdG8gRE9NJyk7XG5cblx0XHRiLmFwcGVuZENoaWxkKGJhaXROb2RlKTtcblxuXHRcdC8vIHRvdWNoIHRoZXNlIHByb3BlcnRpZXNcblx0XHRmb3IoaT0wO2k8YmFpdFRyaWdnZXJzLm51bGxQcm9wcy5sZW5ndGg7aSsrKXtcblx0XHRcdHQgPSBiYWl0Tm9kZVtiYWl0VHJpZ2dlcnMubnVsbFByb3BzW2ldXTtcblx0XHR9XG5cdFx0Zm9yKGk9MDtpPGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHMubGVuZ3RoO2krKyl7XG5cdFx0XHR0ID0gYmFpdE5vZGVbYmFpdFRyaWdnZXJzLnplcm9Qcm9wc1tpXV07XG5cdFx0fVxuXHR9XG5cblx0LyoqXG5cdCogUnVuIHRlc3RzIHRvIHNlZSBpZiBicm93c2VyIGhhcyB0YWtlbiB0aGUgYmFpdCBhbmQgYmxvY2tlZCB0aGUgYmFpdCBlbGVtZW50XG5cdCovXG5cdGZ1bmN0aW9uIHJlZWxJbihiYWl0LCBhdHRlbXB0TnVtKXtcblx0XHR2YXIgaSwgaywgdjtcblx0XHR2YXIgYm9keSA9IGRvY3VtZW50LmJvZHk7XG5cdFx0dmFyIGZvdW5kID0gZmFsc2U7XG5cblx0XHRpZihiYWl0Tm9kZSA9PSBudWxsKXtcblx0XHRcdGxvZygncmVjYXN0IGJhaXQnKTtcblx0XHRcdGNhc3RCYWl0KGJhaXQgfHwgcXVpY2tCYWl0KTtcblx0XHR9XG5cblx0XHRpZih0eXBlb2YoYmFpdCkgPT0gJ3N0cmluZycpe1xuXHRcdFx0bG9nKCdpbnZhbGlkIGJhaXQgdXNlZCcsIHRydWUpO1xuXHRcdFx0aWYoY2xlYXJCYWl0Tm9kZSgpKXtcblx0XHRcdFx0c2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0XHRcdHRlc3RFeGVjdXRpbmcgPSBmYWxzZTtcblx0XHRcdFx0fSwgNSk7XG5cdFx0XHR9XG5cblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHRpZih0aW1lcklkcy50ZXN0ID4gMCl7XG5cdFx0XHRjbGVhclRpbWVvdXQodGltZXJJZHMudGVzdCk7XG5cdFx0XHR0aW1lcklkcy50ZXN0ID0gMDtcblx0XHR9XG5cblx0XHQvLyB0ZXN0IGZvciBpc3N1ZXNcblxuXHRcdGlmKGJvZHkuZ2V0QXR0cmlidXRlKCdhYnAnKSAhPT0gbnVsbCl7XG5cdFx0XHRsb2coJ2ZvdW5kIGFkYmxvY2sgYm9keSBhdHRyaWJ1dGUnKTtcblx0XHRcdGZvdW5kID0gdHJ1ZTtcblx0XHR9XG5cblx0XHRmb3IoaT0wO2k8YmFpdFRyaWdnZXJzLm51bGxQcm9wcy5sZW5ndGg7aSsrKXtcblx0XHRcdGlmKGJhaXROb2RlW2JhaXRUcmlnZ2Vycy5udWxsUHJvcHNbaV1dID09IG51bGwpe1xuXHRcdFx0XHRpZihhdHRlbXB0TnVtPjQpXG5cdFx0XHRcdGZvdW5kID0gdHJ1ZTtcblx0XHRcdFx0bG9nKCdmb3VuZCBhZGJsb2NrIG51bGwgYXR0cjogJyArIGJhaXRUcmlnZ2Vycy5udWxsUHJvcHNbaV0pO1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblx0XHRcdGlmKGZvdW5kID09IHRydWUpe1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblx0XHR9XG5cblx0XHRmb3IoaT0wO2k8YmFpdFRyaWdnZXJzLnplcm9Qcm9wcy5sZW5ndGg7aSsrKXtcblx0XHRcdGlmKGZvdW5kID09IHRydWUpe1xuXHRcdFx0XHRicmVhaztcblx0XHRcdH1cblx0XHRcdGlmKGJhaXROb2RlW2JhaXRUcmlnZ2Vycy56ZXJvUHJvcHNbaV1dID09IDApe1xuXHRcdFx0XHRpZihhdHRlbXB0TnVtPjQpXG5cdFx0XHRcdGZvdW5kID0gdHJ1ZTtcblx0XHRcdFx0bG9nKCdmb3VuZCBhZGJsb2NrIHplcm8gYXR0cjogJyArIGJhaXRUcmlnZ2Vycy56ZXJvUHJvcHNbaV0pO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlICE9PSB1bmRlZmluZWQpIHtcblx0XHRcdHZhciBiYWl0VGVtcCA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKGJhaXROb2RlLCBudWxsKTtcblx0XHRcdGlmKGJhaXRUZW1wLmdldFByb3BlcnR5VmFsdWUoJ2Rpc3BsYXknKSA9PSAnbm9uZSdcblx0XHRcdHx8IGJhaXRUZW1wLmdldFByb3BlcnR5VmFsdWUoJ3Zpc2liaWxpdHknKSA9PSAnaGlkZGVuJykge1xuXHRcdFx0XHRpZihhdHRlbXB0TnVtPjQpXG5cdFx0XHRcdGZvdW5kID0gdHJ1ZTtcblx0XHRcdFx0bG9nKCdmb3VuZCBhZGJsb2NrIGNvbXB1dGVkU3R5bGUgaW5kaWNhdG9yJyk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0dGVzdGVkT25jZSA9IHRydWU7XG5cblx0XHRpZihmb3VuZCB8fCBhdHRlbXB0TnVtKysgPj0gX29wdGlvbnMubWF4TG9vcCl7XG5cdFx0XHRmaW5kUmVzdWx0ID0gZm91bmQ7XG5cdFx0XHRsb2coJ2V4aXRpbmcgdGVzdCBsb29wIC0gdmFsdWU6ICcgKyBmaW5kUmVzdWx0KTtcblx0XHRcdG5vdGlmeUxpc3RlbmVycygpO1xuXHRcdFx0aWYoY2xlYXJCYWl0Tm9kZSgpKXtcblx0XHRcdFx0c2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0XHRcdHRlc3RFeGVjdXRpbmcgPSBmYWxzZTtcblx0XHRcdFx0fSwgNSk7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdGVsc2V7XG5cdFx0XHR0aW1lcklkcy50ZXN0ID0gc2V0VGltZW91dChmdW5jdGlvbigpe1xuXHRcdFx0XHRyZWVsSW4oYmFpdCwgYXR0ZW1wdE51bSk7XG5cdFx0XHR9LCBfb3B0aW9ucy5sb29wRGVsYXkpO1xuXHRcdH1cblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQmFpdE5vZGUoKXtcblx0XHRpZihiYWl0Tm9kZSA9PT0gbnVsbCl7XG5cdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHR9XG5cblx0XHR0cnl7XG5cdFx0XHRpZihpc0Z1bmMoYmFpdE5vZGUucmVtb3ZlKSl7XG5cdFx0XHRcdGJhaXROb2RlLnJlbW92ZSgpO1xuXHRcdFx0fVxuXHRcdFx0ZG9jdW1lbnQuYm9keS5yZW1vdmVDaGlsZChiYWl0Tm9kZSk7XG5cdFx0fVxuXHRcdGNhdGNoKGV4KXtcblx0XHR9XG5cdFx0YmFpdE5vZGUgPSBudWxsO1xuXG5cdFx0cmV0dXJuIHRydWU7XG5cdH1cblxuXHQvKipcblx0KiBIYWx0IHRoZSB0ZXN0IGFuZCBhbnkgcGVuZGluZyB0aW1lb3V0c1xuXHQqL1xuXHRmdW5jdGlvbiBzdG9wRmlzaGluZygpe1xuXHRcdGlmKHRpbWVySWRzLnRlc3QgPiAwKXtcblx0XHRcdGNsZWFyVGltZW91dCh0aW1lcklkcy50ZXN0KTtcblx0XHR9XG5cdFx0aWYodGltZXJJZHMuZG93bmxvYWQgPiAwKXtcblx0XHRcdGNsZWFyVGltZW91dCh0aW1lcklkcy5kb3dubG9hZCk7XG5cdFx0fVxuXG5cdFx0Y2FuY2VsUmVtb3RlRG93bmxvYWRzKCk7XG5cblx0XHRjbGVhckJhaXROb2RlKCk7XG5cdH1cblxuXHQvKipcblx0KiBGaXJlIGFsbCByZWdpc3RlcmVkIGxpc3RlbmVyc1xuXHQqL1xuXHRmdW5jdGlvbiBub3RpZnlMaXN0ZW5lcnMoKXtcblx0XHR2YXIgaSwgZnVuY3M7XG5cdFx0aWYoZmluZFJlc3VsdCA9PT0gbnVsbCl7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHRcdGZvcihpPTA7aTxsaXN0ZW5lcnMubGVuZ3RoO2krKyl7XG5cdFx0XHRmdW5jcyA9IGxpc3RlbmVyc1tpXTtcblx0XHRcdHRyeXtcblx0XHRcdFx0aWYoZnVuY3MgIT0gbnVsbCl7XG5cdFx0XHRcdFx0aWYoaXNGdW5jKGZ1bmNzWydjb21wbGV0ZSddKSl7XG5cdFx0XHRcdFx0XHRmdW5jc1snY29tcGxldGUnXShmaW5kUmVzdWx0KTtcblx0XHRcdFx0XHR9XG5cblx0XHRcdFx0XHRpZihmaW5kUmVzdWx0ICYmIGlzRnVuYyhmdW5jc1snZm91bmQnXSkpe1xuXHRcdFx0XHRcdFx0ZnVuY3NbJ2ZvdW5kJ10oKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZWxzZSBpZihmaW5kUmVzdWx0ID09PSBmYWxzZSAmJiBpc0Z1bmMoZnVuY3NbJ25vdGZvdW5kJ10pKXtcblx0XHRcdFx0XHRcdGZ1bmNzWydub3Rmb3VuZCddKCk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0XHRjYXRjaChleCl7XG5cdFx0XHRcdGxvZygnRmFpbHVyZSBpbiBub3RpZnkgbGlzdGVuZXJzICcgKyBleC5NZXNzYWdlLCB0cnVlKTtcblx0XHRcdH1cblx0XHR9XG5cdH1cblxuXHQvKipcblx0KiBBdHRhY2hlcyBldmVudCBsaXN0ZW5lciBvciBmaXJlcyBpZiBldmVudHMgaGF2ZSBhbHJlYWR5IHBhc3NlZC5cblx0Ki9cblx0ZnVuY3Rpb24gYXR0YWNoT3JGaXJlKCl7XG5cdFx0dmFyIGZpcmVOb3cgPSBmYWxzZTtcblx0XHR2YXIgZm47XG5cblx0XHRpZihkb2N1bWVudC5yZWFkeVN0YXRlKXtcblx0XHRcdGlmKGRvY3VtZW50LnJlYWR5U3RhdGUgPT0gJ2NvbXBsZXRlJyl7XG5cdFx0XHRcdGZpcmVOb3cgPSB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGZuID0gZnVuY3Rpb24oKXtcblx0XHRcdGJlZ2luVGVzdChxdWlja0JhaXQsIGZhbHNlKTtcblx0XHR9XG5cblx0XHRpZihmaXJlTm93KXtcblx0XHRcdGZuKCk7XG5cdFx0fVxuXHRcdGVsc2V7XG5cdFx0XHRhdHRhY2hFdmVudExpc3RlbmVyKHdpbiwgJ2xvYWQnLCBmbik7XG5cdFx0fVxuXHR9XG5cblxuXHR2YXIgYmxvY2tMaXN0czsgLy8gdHJhY2tzIGV4dGVybmFsIGJsb2NrIGxpc3RzXG5cblx0LyoqXG5cdCogUHVibGljIGludGVyZmFjZSBvZiBhZGJsb2NrIGRldGVjdG9yXG5cdCovXG5cdHZhciBpbXBsID0ge1xuXHRcdC8qKlxuXHRcdCogVmVyc2lvbiBvZiB0aGUgYWRibG9jayBkZXRlY3RvciBwYWNrYWdlXG5cdFx0Ki9cblx0XHR2ZXJzaW9uOiB2ZXJzaW9uLFxuXG5cdFx0LyoqXG5cdFx0KiBJbml0aWFsaXphdGlvbiBmdW5jdGlvbi4gU2VlIGNvbW1lbnRzIGF0IHRvcCBmb3Igb3B0aW9ucyBvYmplY3Rcblx0XHQqL1xuXHRcdGluaXQ6IGZ1bmN0aW9uKG9wdGlvbnMpe1xuXHRcdFx0dmFyIGssIHYsIGZ1bmNzO1xuXG5cdFx0XHRpZighb3B0aW9ucyl7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0ZnVuY3MgPSB7XG5cdFx0XHRcdGNvbXBsZXRlOiBub29wLFxuXHRcdFx0XHRmb3VuZDogbm9vcCxcblx0XHRcdFx0bm90Zm91bmQ6IG5vb3Bcblx0XHRcdH07XG5cblx0XHRcdGZvcihrIGluIG9wdGlvbnMpe1xuXHRcdFx0XHRpZihvcHRpb25zLmhhc093blByb3BlcnR5KGspKXtcblx0XHRcdFx0XHRpZihrID09ICdjb21wbGV0ZScgfHwgayA9PSAnZm91bmQnIHx8IGsgPT0gJ25vdEZvdW5kJyl7XG5cdFx0XHRcdFx0XHRmdW5jc1trLnRvTG93ZXJDYXNlKCldID0gb3B0aW9uc1trXTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZWxzZXtcblx0XHRcdFx0XHRcdF9vcHRpb25zW2tdID0gb3B0aW9uc1trXTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblxuXHRcdFx0bGlzdGVuZXJzLnB1c2goZnVuY3MpO1xuXG5cdFx0XHRibG9ja0xpc3RzID0gbmV3IEJsb2NrTGlzdFRyYWNrZXIoKTtcblxuXHRcdFx0YXR0YWNoT3JGaXJlKCk7XG5cdFx0fVxuXHR9XG5cblx0d2luWydhZGJsb2NrRGV0ZWN0b3InXSA9IGltcGw7XG5cbn0pKHdpbmRvdylcbiIsIihmdW5jdGlvbigpe3ZhciBnLGFhPVwiZnVuY3Rpb25cIj09dHlwZW9mIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzP09iamVjdC5kZWZpbmVQcm9wZXJ0eTpmdW5jdGlvbihhLGIsYyl7aWYoYy5nZXR8fGMuc2V0KXRocm93IG5ldyBUeXBlRXJyb3IoXCJFUzMgZG9lcyBub3Qgc3VwcG9ydCBnZXR0ZXJzIGFuZCBzZXR0ZXJzLlwiKTthIT1BcnJheS5wcm90b3R5cGUmJmEhPU9iamVjdC5wcm90b3R5cGUmJihhW2JdPWMudmFsdWUpfSxrPVwidW5kZWZpbmVkXCIhPXR5cGVvZiB3aW5kb3cmJndpbmRvdz09PXRoaXM/dGhpczpcInVuZGVmaW5lZFwiIT10eXBlb2YgZ2xvYmFsJiZudWxsIT1nbG9iYWw/Z2xvYmFsOnRoaXM7ZnVuY3Rpb24gbCgpe2w9ZnVuY3Rpb24oKXt9O2suU3ltYm9sfHwoay5TeW1ib2w9YmEpfXZhciBjYT0wO2Z1bmN0aW9uIGJhKGEpe3JldHVyblwianNjb21wX3N5bWJvbF9cIisoYXx8XCJcIikrY2ErK31cbmZ1bmN0aW9uIG0oKXtsKCk7dmFyIGE9ay5TeW1ib2wuaXRlcmF0b3I7YXx8KGE9ay5TeW1ib2wuaXRlcmF0b3I9ay5TeW1ib2woXCJpdGVyYXRvclwiKSk7XCJmdW5jdGlvblwiIT10eXBlb2YgQXJyYXkucHJvdG90eXBlW2FdJiZhYShBcnJheS5wcm90b3R5cGUsYSx7Y29uZmlndXJhYmxlOiEwLHdyaXRhYmxlOiEwLHZhbHVlOmZ1bmN0aW9uKCl7cmV0dXJuIGRhKHRoaXMpfX0pO209ZnVuY3Rpb24oKXt9fWZ1bmN0aW9uIGRhKGEpe3ZhciBiPTA7cmV0dXJuIGVhKGZ1bmN0aW9uKCl7cmV0dXJuIGI8YS5sZW5ndGg/e2RvbmU6ITEsdmFsdWU6YVtiKytdfTp7ZG9uZTohMH19KX1mdW5jdGlvbiBlYShhKXttKCk7YT17bmV4dDphfTthW2suU3ltYm9sLml0ZXJhdG9yXT1mdW5jdGlvbigpe3JldHVybiB0aGlzfTtyZXR1cm4gYX1mdW5jdGlvbiBmYShhKXttKCk7bCgpO20oKTt2YXIgYj1hW1N5bWJvbC5pdGVyYXRvcl07cmV0dXJuIGI/Yi5jYWxsKGEpOmRhKGEpfVxuZnVuY3Rpb24gbihhKXtpZighKGEgaW5zdGFuY2VvZiBBcnJheSkpe2E9ZmEoYSk7Zm9yKHZhciBiLGM9W107IShiPWEubmV4dCgpKS5kb25lOyljLnB1c2goYi52YWx1ZSk7YT1jfXJldHVybiBhfWZ1bmN0aW9uIGhhKGEsYil7ZnVuY3Rpb24gYygpe31jLnByb3RvdHlwZT1iLnByb3RvdHlwZTthLmhhPWIucHJvdG90eXBlO2EucHJvdG90eXBlPW5ldyBjO2EucHJvdG90eXBlLmNvbnN0cnVjdG9yPWE7Zm9yKHZhciBkIGluIGIpaWYoT2JqZWN0LmRlZmluZVByb3BlcnRpZXMpe3ZhciBlPU9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoYixkKTtlJiZPYmplY3QuZGVmaW5lUHJvcGVydHkoYSxkLGUpfWVsc2UgYVtkXT1iW2RdfXZhciBwPXdpbmRvdy5FbGVtZW50LnByb3RvdHlwZSxpYT1wLm1hdGNoZXN8fHAubWF0Y2hlc1NlbGVjdG9yfHxwLndlYmtpdE1hdGNoZXNTZWxlY3Rvcnx8cC5tb3pNYXRjaGVzU2VsZWN0b3J8fHAubXNNYXRjaGVzU2VsZWN0b3J8fHAub01hdGNoZXNTZWxlY3RvcjtcbmZ1bmN0aW9uIGphKGEsYil7aWYoYSYmMT09YS5ub2RlVHlwZSYmYil7aWYoXCJzdHJpbmdcIj09dHlwZW9mIGJ8fDE9PWIubm9kZVR5cGUpcmV0dXJuIGE9PWJ8fGthKGEsYik7aWYoXCJsZW5ndGhcImluIGIpZm9yKHZhciBjPTAsZDtkPWJbY107YysrKWlmKGE9PWR8fGthKGEsZCkpcmV0dXJuITB9cmV0dXJuITF9ZnVuY3Rpb24ga2EoYSxiKXtpZihcInN0cmluZ1wiIT10eXBlb2YgYilyZXR1cm4hMTtpZihpYSlyZXR1cm4gaWEuY2FsbChhLGIpO2I9YS5wYXJlbnROb2RlLnF1ZXJ5U2VsZWN0b3JBbGwoYik7Zm9yKHZhciBjPTAsZDtkPWJbY107YysrKWlmKGQ9PWEpcmV0dXJuITA7cmV0dXJuITF9ZnVuY3Rpb24gbGEoYSl7Zm9yKHZhciBiPVtdO2EmJmEucGFyZW50Tm9kZSYmMT09YS5wYXJlbnROb2RlLm5vZGVUeXBlOylhPWEucGFyZW50Tm9kZSxiLnB1c2goYSk7cmV0dXJuIGJ9XG5mdW5jdGlvbiBxKGEsYixjKXtmdW5jdGlvbiBkKGEpe3ZhciBkO2lmKGguY29tcG9zZWQmJlwiZnVuY3Rpb25cIj09dHlwZW9mIGEuY29tcG9zZWRQYXRoKWZvcih2YXIgZT1hLmNvbXBvc2VkUGF0aCgpLGY9MCxGO0Y9ZVtmXTtmKyspMT09Ri5ub2RlVHlwZSYmamEoRixiKSYmKGQ9Rik7ZWxzZSBhOntpZigoZD1hLnRhcmdldCkmJjE9PWQubm9kZVR5cGUmJmIpZm9yKGQ9W2RdLmNvbmNhdChsYShkKSksZT0wO2Y9ZFtlXTtlKyspaWYoamEoZixiKSl7ZD1mO2JyZWFrIGF9ZD12b2lkIDB9ZCYmYy5jYWxsKGQsYSxkKX12YXIgZT1kb2N1bWVudCxoPXtjb21wb3NlZDohMCxTOiEwfSxoPXZvaWQgMD09PWg/e306aDtlLmFkZEV2ZW50TGlzdGVuZXIoYSxkLGguUyk7cmV0dXJue2o6ZnVuY3Rpb24oKXtlLnJlbW92ZUV2ZW50TGlzdGVuZXIoYSxkLGguUyl9fX1cbmZ1bmN0aW9uIG1hKGEpe3ZhciBiPXt9O2lmKCFhfHwxIT1hLm5vZGVUeXBlKXJldHVybiBiO2E9YS5hdHRyaWJ1dGVzO2lmKCFhLmxlbmd0aClyZXR1cm57fTtmb3IodmFyIGM9MCxkO2Q9YVtjXTtjKyspYltkLm5hbWVdPWQudmFsdWU7cmV0dXJuIGJ9dmFyIG5hPS86KDgwfDQ0MykkLyxyPWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoXCJhXCIpLHQ9e307XG5mdW5jdGlvbiB1KGEpe2E9YSYmXCIuXCIhPWE/YTpsb2NhdGlvbi5ocmVmO2lmKHRbYV0pcmV0dXJuIHRbYV07ci5ocmVmPWE7aWYoXCIuXCI9PWEuY2hhckF0KDApfHxcIi9cIj09YS5jaGFyQXQoMCkpcmV0dXJuIHUoci5ocmVmKTt2YXIgYj1cIjgwXCI9PXIucG9ydHx8XCI0NDNcIj09ci5wb3J0P1wiXCI6ci5wb3J0LGI9XCIwXCI9PWI/XCJcIjpiLGM9ci5ob3N0LnJlcGxhY2UobmEsXCJcIik7cmV0dXJuIHRbYV09e2hhc2g6ci5oYXNoLGhvc3Q6Yyxob3N0bmFtZTpyLmhvc3RuYW1lLGhyZWY6ci5ocmVmLG9yaWdpbjpyLm9yaWdpbj9yLm9yaWdpbjpyLnByb3RvY29sK1wiLy9cIitjLHBhdGhuYW1lOlwiL1wiPT1yLnBhdGhuYW1lLmNoYXJBdCgwKT9yLnBhdGhuYW1lOlwiL1wiK3IucGF0aG5hbWUscG9ydDpiLHByb3RvY29sOnIucHJvdG9jb2wsc2VhcmNoOnIuc2VhcmNofX12YXIgdz1bXTtcbmZ1bmN0aW9uIG9hKGEsYil7dmFyIGM9dGhpczt0aGlzLmNvbnRleHQ9YTt0aGlzLlA9Yjt0aGlzLmY9KHRoaXMuYz0vVGFzayQvLnRlc3QoYikpP2EuZ2V0KGIpOmFbYl07dGhpcy5iPVtdO3RoaXMuYT1bXTt0aGlzLmc9ZnVuY3Rpb24oYSl7Zm9yKHZhciBiPVtdLGQ9MDtkPGFyZ3VtZW50cy5sZW5ndGg7KytkKWJbZC0wXT1hcmd1bWVudHNbZF07cmV0dXJuIGMuYVtjLmEubGVuZ3RoLTFdLmFwcGx5KG51bGwsW10uY29uY2F0KG4oYikpKX07dGhpcy5jP2Euc2V0KGIsdGhpcy5nKTphW2JdPXRoaXMuZ31mdW5jdGlvbiB4KGEsYixjKXthPXBhKGEsYik7YS5iLnB1c2goYyk7cWEoYSl9ZnVuY3Rpb24geShhLGIsYyl7YT1wYShhLGIpO2M9YS5iLmluZGV4T2YoYyk7LTE8YyYmKGEuYi5zcGxpY2UoYywxKSwwPGEuYi5sZW5ndGg/cWEoYSk6YS5qKCkpfVxuZnVuY3Rpb24gcWEoYSl7YS5hPVtdO2Zvcih2YXIgYixjPTA7Yj1hLmJbY107YysrKXt2YXIgZD1hLmFbYy0xXXx8YS5mLmJpbmQoYS5jb250ZXh0KTthLmEucHVzaChiKGQpKX19b2EucHJvdG90eXBlLmo9ZnVuY3Rpb24oKXt2YXIgYT13LmluZGV4T2YodGhpcyk7LTE8YSYmKHcuc3BsaWNlKGEsMSksdGhpcy5jP3RoaXMuY29udGV4dC5zZXQodGhpcy5QLHRoaXMuZik6dGhpcy5jb250ZXh0W3RoaXMuUF09dGhpcy5mKX07ZnVuY3Rpb24gcGEoYSxiKXt2YXIgYz13LmZpbHRlcihmdW5jdGlvbihjKXtyZXR1cm4gYy5jb250ZXh0PT1hJiZjLlA9PWJ9KVswXTtjfHwoYz1uZXcgb2EoYSxiKSx3LnB1c2goYykpO3JldHVybiBjfVxuZnVuY3Rpb24geihhLGIsYyxkLGUsaCl7aWYoXCJmdW5jdGlvblwiPT10eXBlb2YgZCl7dmFyIGY9Yy5nZXQoXCJidWlsZEhpdFRhc2tcIik7cmV0dXJue2J1aWxkSGl0VGFzazpmdW5jdGlvbihjKXtjLnNldChhLG51bGwsITApO2Muc2V0KGIsbnVsbCwhMCk7ZChjLGUsaCk7ZihjKX19fXJldHVybiBBKHt9LGEsYil9ZnVuY3Rpb24gQihhLGIpe3ZhciBjPW1hKGEpLGQ9e307T2JqZWN0LmtleXMoYykuZm9yRWFjaChmdW5jdGlvbihhKXtpZighYS5pbmRleE9mKGIpJiZhIT1iK1wib25cIil7dmFyIGU9Y1thXTtcInRydWVcIj09ZSYmKGU9ITApO1wiZmFsc2VcIj09ZSYmKGU9ITEpO2E9cmEoYS5zbGljZShiLmxlbmd0aCkpO2RbYV09ZX19KTtyZXR1cm4gZH1cbmZ1bmN0aW9uIHNhKGEpe1wibG9hZGluZ1wiPT1kb2N1bWVudC5yZWFkeVN0YXRlP2RvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsZnVuY3Rpb24gYygpe2RvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJET01Db250ZW50TG9hZGVkXCIsYyk7YSgpfSk6YSgpfWZ1bmN0aW9uIHRhKGEsYil7dmFyIGM7cmV0dXJuIGZ1bmN0aW9uKGQpe2Zvcih2YXIgZT1bXSxoPTA7aDxhcmd1bWVudHMubGVuZ3RoOysraCllW2gtMF09YXJndW1lbnRzW2hdO2NsZWFyVGltZW91dChjKTtjPXNldFRpbWVvdXQoZnVuY3Rpb24oKXtyZXR1cm4gYS5hcHBseShudWxsLFtdLmNvbmNhdChuKGUpKSl9LGIpfX1mdW5jdGlvbiB1YShhKXtmdW5jdGlvbiBiKCl7Y3x8KGM9ITAsYSgpKX12YXIgYz0hMTtzZXRUaW1lb3V0KGIsMkUzKTtyZXR1cm4gYn12YXIgQz17fTtcbmZ1bmN0aW9uIHZhKGEsYil7ZnVuY3Rpb24gYygpe2NsZWFyVGltZW91dChlLnRpbWVvdXQpO2Uuc2VuZCYmeShhLFwic2VuZFwiLGUuc2VuZCk7ZGVsZXRlIENbZF07ZS5SLmZvckVhY2goZnVuY3Rpb24oYSl7cmV0dXJuIGEoKX0pfXZhciBkPWEuZ2V0KFwidHJhY2tpbmdJZFwiKSxlPUNbZF09Q1tkXXx8e307Y2xlYXJUaW1lb3V0KGUudGltZW91dCk7ZS50aW1lb3V0PXNldFRpbWVvdXQoYywwKTtlLlI9ZS5SfHxbXTtlLlIucHVzaChiKTtlLnNlbmR8fChlLnNlbmQ9ZnVuY3Rpb24oYSl7cmV0dXJuIGZ1bmN0aW9uKGIpe2Zvcih2YXIgZD1bXSxlPTA7ZTxhcmd1bWVudHMubGVuZ3RoOysrZSlkW2UtMF09YXJndW1lbnRzW2VdO2MoKTthLmFwcGx5KG51bGwsW10uY29uY2F0KG4oZCkpKX19LHgoYSxcInNlbmRcIixlLnNlbmQpKX1cbnZhciBBPU9iamVjdC5hc3NpZ258fGZ1bmN0aW9uKGEsYil7Zm9yKHZhciBjPVtdLGQ9MTtkPGFyZ3VtZW50cy5sZW5ndGg7KytkKWNbZC0xXT1hcmd1bWVudHNbZF07Zm9yKHZhciBkPTAsZT1jLmxlbmd0aDtkPGU7ZCsrKXt2YXIgaD1PYmplY3QoY1tkXSksZjtmb3IoZiBpbiBoKU9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChoLGYpJiYoYVtmXT1oW2ZdKX1yZXR1cm4gYX07ZnVuY3Rpb24gcmEoYSl7cmV0dXJuIGEucmVwbGFjZSgvW1xcLVxcX10rKFxcdz8pL2csZnVuY3Rpb24oYSxjKXtyZXR1cm4gYy50b1VwcGVyQ2FzZSgpfSl9ZnVuY3Rpb24gRChhKXtyZXR1cm5cIm9iamVjdFwiPT10eXBlb2YgYSYmbnVsbCE9PWF9dmFyIEU9ZnVuY3Rpb24gd2EoYil7cmV0dXJuIGI/KGJeMTYqTWF0aC5yYW5kb20oKT4+Yi80KS50b1N0cmluZygxNik6XCIxMDAwMDAwMC0xMDAwLTQwMDAtODAwMC0xMDAwMDAwMDAwMDBcIi5yZXBsYWNlKC9bMDE4XS9nLHdhKX07XG5mdW5jdGlvbiBHKGEsYil7dmFyIGM9d2luZG93Lkdvb2dsZUFuYWx5dGljc09iamVjdHx8XCJnYVwiO3dpbmRvd1tjXT13aW5kb3dbY118fGZ1bmN0aW9uKGEpe2Zvcih2YXIgYj1bXSxkPTA7ZDxhcmd1bWVudHMubGVuZ3RoOysrZCliW2QtMF09YXJndW1lbnRzW2RdOyh3aW5kb3dbY10ucT13aW5kb3dbY10ucXx8W10pLnB1c2goYil9O3dpbmRvdy5nYURldklkcz13aW5kb3cuZ2FEZXZJZHN8fFtdOzA+d2luZG93LmdhRGV2SWRzLmluZGV4T2YoXCJpNWlTam9cIikmJndpbmRvdy5nYURldklkcy5wdXNoKFwiaTVpU2pvXCIpO3dpbmRvd1tjXShcInByb3ZpZGVcIixhLGIpO3dpbmRvdy5nYXBsdWdpbnM9d2luZG93LmdhcGx1Z2luc3x8e307d2luZG93LmdhcGx1Z2luc1thLmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpK2Euc2xpY2UoMSldPWJ9dmFyIEg9e1Q6MSxVOjIsVjozLFg6NCxZOjUsWjo2LCQ6NyxhYTo4LGJhOjksVzoxMH0sST1PYmplY3Qua2V5cyhIKS5sZW5ndGg7XG5mdW5jdGlvbiBKKGEsYil7YS5zZXQoXCJcXHgyNl9hdlwiLFwiMi40LjFcIik7dmFyIGM9YS5nZXQoXCJcXHgyNl9hdVwiKSxjPXBhcnNlSW50KGN8fFwiMFwiLDE2KS50b1N0cmluZygyKTtpZihjLmxlbmd0aDxJKWZvcih2YXIgZD1JLWMubGVuZ3RoO2Q7KWM9XCIwXCIrYyxkLS07Yj1JLWI7Yz1jLnN1YnN0cigwLGIpKzErYy5zdWJzdHIoYisxKTthLnNldChcIlxceDI2X2F1XCIscGFyc2VJbnQoY3x8XCIwXCIsMikudG9TdHJpbmcoMTYpKX1mdW5jdGlvbiBLKGEsYil7SihhLEguVCk7dGhpcy5hPUEoe30sYik7dGhpcy5nPWE7dGhpcy5iPXRoaXMuYS5zdHJpcFF1ZXJ5JiZ0aGlzLmEucXVlcnlEaW1lbnNpb25JbmRleD9cImRpbWVuc2lvblwiK3RoaXMuYS5xdWVyeURpbWVuc2lvbkluZGV4Om51bGw7dGhpcy5mPXRoaXMuZi5iaW5kKHRoaXMpO3RoaXMuYz10aGlzLmMuYmluZCh0aGlzKTt4KGEsXCJnZXRcIix0aGlzLmYpO3goYSxcImJ1aWxkSGl0VGFza1wiLHRoaXMuYyl9XG5LLnByb3RvdHlwZS5mPWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXM7cmV0dXJuIGZ1bmN0aW9uKGMpe2lmKFwicGFnZVwiPT1jfHxjPT1iLmIpe3ZhciBkPXtsb2NhdGlvbjphKFwibG9jYXRpb25cIikscGFnZTphKFwicGFnZVwiKX07cmV0dXJuIHhhKGIsZClbY119cmV0dXJuIGEoYyl9fTtLLnByb3RvdHlwZS5jPWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXM7cmV0dXJuIGZ1bmN0aW9uKGMpe3ZhciBkPXhhKGIse2xvY2F0aW9uOmMuZ2V0KFwibG9jYXRpb25cIikscGFnZTpjLmdldChcInBhZ2VcIil9KTtjLnNldChkLG51bGwsITApO2EoYyl9fTtcbmZ1bmN0aW9uIHhhKGEsYil7dmFyIGM9dShiLnBhZ2V8fGIubG9jYXRpb24pLGQ9Yy5wYXRobmFtZTtpZihhLmEuaW5kZXhGaWxlbmFtZSl7dmFyIGU9ZC5zcGxpdChcIi9cIik7YS5hLmluZGV4RmlsZW5hbWU9PWVbZS5sZW5ndGgtMV0mJihlW2UubGVuZ3RoLTFdPVwiXCIsZD1lLmpvaW4oXCIvXCIpKX1cInJlbW92ZVwiPT1hLmEudHJhaWxpbmdTbGFzaD9kPWQucmVwbGFjZSgvXFwvKyQvLFwiXCIpOlwiYWRkXCI9PWEuYS50cmFpbGluZ1NsYXNoJiYoL1xcLlxcdyskLy50ZXN0KGQpfHxcIi9cIj09ZC5zdWJzdHIoLTEpfHwoZCs9XCIvXCIpKTtkPXtwYWdlOmQrKGEuYS5zdHJpcFF1ZXJ5P3lhKGEsYy5zZWFyY2gpOmMuc2VhcmNoKX07Yi5sb2NhdGlvbiYmKGQubG9jYXRpb249Yi5sb2NhdGlvbik7YS5iJiYoZFthLmJdPWMuc2VhcmNoLnNsaWNlKDEpfHxcIihub3Qgc2V0KVwiKTtyZXR1cm5cImZ1bmN0aW9uXCI9PXR5cGVvZiBhLmEudXJsRmllbGRzRmlsdGVyPyhiPWEuYS51cmxGaWVsZHNGaWx0ZXIoZCx1KSxjPXtwYWdlOmIucGFnZSxcbmxvY2F0aW9uOmIubG9jYXRpb259LGEuYiYmKGNbYS5iXT1iW2EuYl0pLGMpOmR9ZnVuY3Rpb24geWEoYSxiKXtpZihBcnJheS5pc0FycmF5KGEuYS5xdWVyeVBhcmFtc1doaXRlbGlzdCkpe3ZhciBjPVtdO2Iuc2xpY2UoMSkuc3BsaXQoXCJcXHgyNlwiKS5mb3JFYWNoKGZ1bmN0aW9uKGIpe3ZhciBkPWZhKGIuc3BsaXQoXCJcXHgzZFwiKSk7Yj1kLm5leHQoKS52YWx1ZTtkPWQubmV4dCgpLnZhbHVlOy0xPGEuYS5xdWVyeVBhcmFtc1doaXRlbGlzdC5pbmRleE9mKGIpJiZkJiZjLnB1c2goW2IsZF0pfSk7cmV0dXJuIGMubGVuZ3RoP1wiP1wiK2MubWFwKGZ1bmN0aW9uKGEpe3JldHVybiBhLmpvaW4oXCJcXHgzZFwiKX0pLmpvaW4oXCJcXHgyNlwiKTpcIlwifXJldHVyblwiXCJ9Sy5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7eSh0aGlzLmcsXCJnZXRcIix0aGlzLmYpO3kodGhpcy5nLFwiYnVpbGRIaXRUYXNrXCIsdGhpcy5jKX07RyhcImNsZWFuVXJsVHJhY2tlclwiLEspO1xuZnVuY3Rpb24gTChhLGIpe3ZhciBjPXRoaXM7SihhLEguVSk7aWYod2luZG93LmFkZEV2ZW50TGlzdGVuZXIpe3RoaXMuYT1BKHtldmVudHM6W1wiY2xpY2tcIl0sZmllbGRzT2JqOnt9LGF0dHJpYnV0ZVByZWZpeDpcImdhLVwifSxiKTt0aGlzLmY9YTt0aGlzLmM9dGhpcy5jLmJpbmQodGhpcyk7dmFyIGQ9XCJbXCIrdGhpcy5hLmF0dHJpYnV0ZVByZWZpeCtcIm9uXVwiO3RoaXMuYj17fTt0aGlzLmEuZXZlbnRzLmZvckVhY2goZnVuY3Rpb24oYSl7Yy5iW2FdPXEoYSxkLGMuYyl9KX19XG5MLnByb3RvdHlwZS5jPWZ1bmN0aW9uKGEsYil7dmFyIGM9dGhpcy5hLmF0dHJpYnV0ZVByZWZpeDtpZighKDA+Yi5nZXRBdHRyaWJ1dGUoYytcIm9uXCIpLnNwbGl0KC9cXHMqLFxccyovKS5pbmRleE9mKGEudHlwZSkpKXt2YXIgYz1CKGIsYyksZD1BKHt9LHRoaXMuYS5maWVsZHNPYmosYyk7dGhpcy5mLnNlbmQoYy5oaXRUeXBlfHxcImV2ZW50XCIseih7dHJhbnNwb3J0OlwiYmVhY29uXCJ9LGQsdGhpcy5mLHRoaXMuYS5oaXRGaWx0ZXIsYixhKSl9fTtMLnByb3RvdHlwZS5yZW1vdmU9ZnVuY3Rpb24oKXt2YXIgYT10aGlzO09iamVjdC5rZXlzKHRoaXMuYikuZm9yRWFjaChmdW5jdGlvbihiKXthLmJbYl0uaigpfSl9O0coXCJldmVudFRyYWNrZXJcIixMKTtcbmZ1bmN0aW9uIHphKGEsYil7dmFyIGM9dGhpcztKKGEsSC5WKTt3aW5kb3cuSW50ZXJzZWN0aW9uT2JzZXJ2ZXImJndpbmRvdy5NdXRhdGlvbk9ic2VydmVyJiYodGhpcy5hPUEoe3Jvb3RNYXJnaW46XCIwcHhcIixmaWVsZHNPYmo6e30sYXR0cmlidXRlUHJlZml4OlwiZ2EtXCJ9LGIpLHRoaXMuYz1hLHRoaXMuTT10aGlzLk0uYmluZCh0aGlzKSx0aGlzLk89dGhpcy5PLmJpbmQodGhpcyksdGhpcy5LPXRoaXMuSy5iaW5kKHRoaXMpLHRoaXMuTD10aGlzLkwuYmluZCh0aGlzKSx0aGlzLmI9bnVsbCx0aGlzLml0ZW1zPVtdLHRoaXMuaT17fSx0aGlzLmg9e30sc2EoZnVuY3Rpb24oKXtjLmEuZWxlbWVudHMmJmMub2JzZXJ2ZUVsZW1lbnRzKGMuYS5lbGVtZW50cyl9KSl9Zz16YS5wcm90b3R5cGU7XG5nLm9ic2VydmVFbGVtZW50cz1mdW5jdGlvbihhKXt2YXIgYj10aGlzO2E9TSh0aGlzLGEpO3RoaXMuaXRlbXM9dGhpcy5pdGVtcy5jb25jYXQoYS5pdGVtcyk7dGhpcy5pPUEoe30sYS5pLHRoaXMuaSk7dGhpcy5oPUEoe30sYS5oLHRoaXMuaCk7YS5pdGVtcy5mb3JFYWNoKGZ1bmN0aW9uKGEpe3ZhciBjPWIuaFthLnRocmVzaG9sZF09Yi5oW2EudGhyZXNob2xkXXx8bmV3IEludGVyc2VjdGlvbk9ic2VydmVyKGIuTyx7cm9vdE1hcmdpbjpiLmEucm9vdE1hcmdpbix0aHJlc2hvbGQ6WythLnRocmVzaG9sZF19KTsoYT1iLmlbYS5pZF18fChiLmlbYS5pZF09ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoYS5pZCkpKSYmYy5vYnNlcnZlKGEpfSk7dGhpcy5ifHwodGhpcy5iPW5ldyBNdXRhdGlvbk9ic2VydmVyKHRoaXMuTSksdGhpcy5iLm9ic2VydmUoZG9jdW1lbnQuYm9keSx7Y2hpbGRMaXN0OiEwLHN1YnRyZWU6ITB9KSk7cmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uKCl7fSl9O1xuZy51bm9ic2VydmVFbGVtZW50cz1mdW5jdGlvbihhKXt2YXIgYj1bXSxjPVtdO3RoaXMuaXRlbXMuZm9yRWFjaChmdW5jdGlvbihkKXthLnNvbWUoZnVuY3Rpb24oYSl7YT1BYShhKTtyZXR1cm4gYS5pZD09PWQuaWQmJmEudGhyZXNob2xkPT09ZC50aHJlc2hvbGQmJmEudHJhY2tGaXJzdEltcHJlc3Npb25Pbmx5PT09ZC50cmFja0ZpcnN0SW1wcmVzc2lvbk9ubHl9KT9jLnB1c2goZCk6Yi5wdXNoKGQpfSk7aWYoYi5sZW5ndGgpe3ZhciBkPU0odGhpcyxiKSxlPU0odGhpcyxjKTt0aGlzLml0ZW1zPWQuaXRlbXM7dGhpcy5pPWQuaTt0aGlzLmg9ZC5oO2MuZm9yRWFjaChmdW5jdGlvbihhKXtpZighZC5pW2EuaWRdKXt2YXIgYj1lLmhbYS50aHJlc2hvbGRdLGM9ZS5pW2EuaWRdO2MmJmIudW5vYnNlcnZlKGMpO2QuaFthLnRocmVzaG9sZF18fGUuaFthLnRocmVzaG9sZF0uZGlzY29ubmVjdCgpfX0pfWVsc2UgdGhpcy51bm9ic2VydmVBbGxFbGVtZW50cygpfTtcbmcudW5vYnNlcnZlQWxsRWxlbWVudHM9ZnVuY3Rpb24oKXt2YXIgYT10aGlzO09iamVjdC5rZXlzKHRoaXMuaCkuZm9yRWFjaChmdW5jdGlvbihiKXthLmhbYl0uZGlzY29ubmVjdCgpfSk7dGhpcy5iLmRpc2Nvbm5lY3QoKTt0aGlzLmI9bnVsbDt0aGlzLml0ZW1zPVtdO3RoaXMuaT17fTt0aGlzLmg9e319O2Z1bmN0aW9uIE0oYSxiKXt2YXIgYz1bXSxkPXt9LGU9e307Yi5sZW5ndGgmJmIuZm9yRWFjaChmdW5jdGlvbihiKXtiPUFhKGIpO2MucHVzaChiKTtlW2IuaWRdPWEuaVtiLmlkXXx8bnVsbDtkW2IudGhyZXNob2xkXT1hLmhbYi50aHJlc2hvbGRdfHxudWxsfSk7cmV0dXJue2l0ZW1zOmMsaTplLGg6ZH19Zy5NPWZ1bmN0aW9uKGEpe2Zvcih2YXIgYj0wLGM7Yz1hW2JdO2IrKyl7Zm9yKHZhciBkPTAsZTtlPWMucmVtb3ZlZE5vZGVzW2RdO2QrKylOKHRoaXMsZSx0aGlzLkwpO2ZvcihkPTA7ZT1jLmFkZGVkTm9kZXNbZF07ZCsrKU4odGhpcyxlLHRoaXMuSyl9fTtcbmZ1bmN0aW9uIE4oYSxiLGMpezE9PWIubm9kZVR5cGUmJmIuaWQgaW4gYS5pJiZjKGIuaWQpO2Zvcih2YXIgZD0wLGU7ZT1iLmNoaWxkTm9kZXNbZF07ZCsrKU4oYSxlLGMpfVxuZy5PPWZ1bmN0aW9uKGEpe2Zvcih2YXIgYj1bXSxjPTAsZDtkPWFbY107YysrKWZvcih2YXIgZT0wLGg7aD10aGlzLml0ZW1zW2VdO2UrKyl7dmFyIGY7aWYoZj1kLnRhcmdldC5pZD09PWguaWQpKGY9aC50aHJlc2hvbGQpP2Y9ZC5pbnRlcnNlY3Rpb25SYXRpbz49ZjooZj1kLmludGVyc2VjdGlvblJlY3QsZj0wPGYudG9wfHwwPGYuYm90dG9tfHwwPGYubGVmdHx8MDxmLnJpZ2h0KTtpZihmKXt2YXIgdj1oLmlkO2Y9ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQodik7dmFyIHY9e3RyYW5zcG9ydDpcImJlYWNvblwiLGV2ZW50Q2F0ZWdvcnk6XCJWaWV3cG9ydFwiLGV2ZW50QWN0aW9uOlwiaW1wcmVzc2lvblwiLGV2ZW50TGFiZWw6dixub25JbnRlcmFjdGlvbjohMH0sTmE9QSh7fSx0aGlzLmEuZmllbGRzT2JqLEIoZix0aGlzLmEuYXR0cmlidXRlUHJlZml4KSk7dGhpcy5jLnNlbmQoXCJldmVudFwiLHoodixOYSx0aGlzLmMsdGhpcy5hLmhpdEZpbHRlcixmKSk7aC50cmFja0ZpcnN0SW1wcmVzc2lvbk9ubHkmJlxuYi5wdXNoKGgpfX1iLmxlbmd0aCYmdGhpcy51bm9ic2VydmVFbGVtZW50cyhiKX07Zy5LPWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXMsYz10aGlzLmlbYV09ZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoYSk7dGhpcy5pdGVtcy5mb3JFYWNoKGZ1bmN0aW9uKGQpe2E9PWQuaWQmJmIuaFtkLnRocmVzaG9sZF0ub2JzZXJ2ZShjKX0pfTtnLkw9ZnVuY3Rpb24oYSl7dmFyIGI9dGhpcyxjPXRoaXMuaVthXTt0aGlzLml0ZW1zLmZvckVhY2goZnVuY3Rpb24oZCl7YT09ZC5pZCYmYi5oW2QudGhyZXNob2xkXS51bm9ic2VydmUoYyl9KTt0aGlzLmlbYV09bnVsbH07Zy5yZW1vdmU9ZnVuY3Rpb24oKXt0aGlzLnVub2JzZXJ2ZUFsbEVsZW1lbnRzKCl9O0coXCJpbXByZXNzaW9uVHJhY2tlclwiLHphKTtmdW5jdGlvbiBBYShhKXtcInN0cmluZ1wiPT10eXBlb2YgYSYmKGE9e2lkOmF9KTtyZXR1cm4gQSh7dGhyZXNob2xkOjAsdHJhY2tGaXJzdEltcHJlc3Npb25Pbmx5OiEwfSxhKX1cbmZ1bmN0aW9uIEJhKCl7dGhpcy5hPXt9fWZ1bmN0aW9uIENhKGEsYil7KGEuYS5leHRlcm5hbFNldD1hLmEuZXh0ZXJuYWxTZXR8fFtdKS5wdXNoKGIpfUJhLnByb3RvdHlwZS5jYT1mdW5jdGlvbihhLGIpe2Zvcih2YXIgYz1bXSxkPTE7ZDxhcmd1bWVudHMubGVuZ3RoOysrZCljW2QtMV09YXJndW1lbnRzW2RdOyh0aGlzLmFbYV09dGhpcy5hW2FdfHxbXSkuZm9yRWFjaChmdW5jdGlvbihhKXtyZXR1cm4gYS5hcHBseShudWxsLFtdLmNvbmNhdChuKGMpKSl9KX07dmFyIE89e30sUD0hMSxRO2Z1bmN0aW9uIFIoYSxiKXtiPXZvaWQgMD09PWI/e306Yjt0aGlzLmE9e307dGhpcy5iPWE7dGhpcy53PWI7dGhpcy5sPW51bGx9aGEoUixCYSk7ZnVuY3Rpb24gUyhhLGIsYyl7YT1bXCJhdXRvdHJhY2tcIixhLGJdLmpvaW4oXCI6XCIpO09bYV18fChPW2FdPW5ldyBSKGEsYyksUHx8KHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwic3RvcmFnZVwiLERhKSxQPSEwKSk7cmV0dXJuIE9bYV19XG5mdW5jdGlvbiBFYSgpe2lmKG51bGwhPVEpcmV0dXJuIFE7dHJ5e3dpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbShcImF1dG90cmFja1wiLFwiYXV0b3RyYWNrXCIpLHdpbmRvdy5sb2NhbFN0b3JhZ2UucmVtb3ZlSXRlbShcImF1dG90cmFja1wiKSxRPSEwfWNhdGNoKGEpe1E9ITF9cmV0dXJuIFF9Ui5wcm90b3R5cGUuZ2V0PWZ1bmN0aW9uKCl7aWYodGhpcy5sKXJldHVybiB0aGlzLmw7aWYoRWEoKSl0cnl7dGhpcy5sPUZhKHdpbmRvdy5sb2NhbFN0b3JhZ2UuZ2V0SXRlbSh0aGlzLmIpKX1jYXRjaChhKXt9cmV0dXJuIHRoaXMubD1BKHt9LHRoaXMudyx0aGlzLmwpfTtSLnByb3RvdHlwZS5zZXQ9ZnVuY3Rpb24oYSl7dGhpcy5sPUEoe30sdGhpcy53LHRoaXMubCxhKTtpZihFYSgpKXRyeXt2YXIgYj1KU09OLnN0cmluZ2lmeSh0aGlzLmwpO3dpbmRvdy5sb2NhbFN0b3JhZ2Uuc2V0SXRlbSh0aGlzLmIsYil9Y2F0Y2goYyl7fX07XG5mdW5jdGlvbiBHYShhKXthLmw9e307aWYoRWEoKSl0cnl7d2luZG93LmxvY2FsU3RvcmFnZS5yZW1vdmVJdGVtKGEuYil9Y2F0Y2goYil7fX1SLnByb3RvdHlwZS5qPWZ1bmN0aW9uKCl7ZGVsZXRlIE9bdGhpcy5iXTtPYmplY3Qua2V5cyhPKS5sZW5ndGh8fCh3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInN0b3JhZ2VcIixEYSksUD0hMSl9O2Z1bmN0aW9uIERhKGEpe3ZhciBiPU9bYS5rZXldO2lmKGIpe3ZhciBjPUEoe30sYi53LEZhKGEub2xkVmFsdWUpKTthPUEoe30sYi53LEZhKGEubmV3VmFsdWUpKTtiLmw9YTtiLmNhKFwiZXh0ZXJuYWxTZXRcIixhLGMpfX1mdW5jdGlvbiBGYShhKXt2YXIgYj17fTtpZihhKXRyeXtiPUpTT04ucGFyc2UoYSl9Y2F0Y2goYyl7fXJldHVybiBifXZhciBUPXt9O1xuZnVuY3Rpb24gVShhLGIsYyl7dGhpcy5mPWE7dGhpcy50aW1lb3V0PWJ8fEhhO3RoaXMudGltZVpvbmU9Yzt0aGlzLmI9dGhpcy5iLmJpbmQodGhpcyk7eChhLFwic2VuZEhpdFRhc2tcIix0aGlzLmIpO3RyeXt0aGlzLmM9bmV3IEludGwuRGF0ZVRpbWVGb3JtYXQoXCJlbi1VU1wiLHt0aW1lWm9uZTp0aGlzLnRpbWVab25lfSl9Y2F0Y2goZCl7fXRoaXMuYT1TKGEuZ2V0KFwidHJhY2tpbmdJZFwiKSxcInNlc3Npb25cIix7aGl0VGltZTowLGlzRXhwaXJlZDohMX0pO3RoaXMuYS5nZXQoKS5pZHx8dGhpcy5hLnNldCh7aWQ6RSgpfSl9ZnVuY3Rpb24gSWEoYSxiLGMpe3ZhciBkPWEuZ2V0KFwidHJhY2tpbmdJZFwiKTtyZXR1cm4gVFtkXT9UW2RdOlRbZF09bmV3IFUoYSxiLGMpfWZ1bmN0aW9uIFYoYSl7cmV0dXJuIGEuYS5nZXQoKS5pZH1cblUucHJvdG90eXBlLmlzRXhwaXJlZD1mdW5jdGlvbihhKXthPXZvaWQgMD09PWE/Vih0aGlzKTphO2lmKGEhPVYodGhpcykpcmV0dXJuITA7YT10aGlzLmEuZ2V0KCk7aWYoYS5pc0V4cGlyZWQpcmV0dXJuITA7dmFyIGI9YS5oaXRUaW1lO3JldHVybiBiJiYoYT1uZXcgRGF0ZSxiPW5ldyBEYXRlKGIpLGEtYj42RTQqdGhpcy50aW1lb3V0fHx0aGlzLmMmJnRoaXMuYy5mb3JtYXQoYSkhPXRoaXMuYy5mb3JtYXQoYikpPyEwOiExfTtVLnByb3RvdHlwZS5iPWZ1bmN0aW9uKGEpe3ZhciBiPXRoaXM7cmV0dXJuIGZ1bmN0aW9uKGMpe2EoYyk7dmFyIGQ9Yy5nZXQoXCJzZXNzaW9uQ29udHJvbFwiKTtjPVwic3RhcnRcIj09ZHx8Yi5pc0V4cGlyZWQoKTt2YXIgZD1cImVuZFwiPT1kLGU9Yi5hLmdldCgpO2UuaGl0VGltZT0rbmV3IERhdGU7YyYmKGUuaXNFeHBpcmVkPSExLGUuaWQ9RSgpKTtkJiYoZS5pc0V4cGlyZWQ9ITApO2IuYS5zZXQoZSl9fTtcblUucHJvdG90eXBlLmo9ZnVuY3Rpb24oKXt5KHRoaXMuZixcInNlbmRIaXRUYXNrXCIsdGhpcy5iKTt0aGlzLmEuaigpO2RlbGV0ZSBUW3RoaXMuZi5nZXQoXCJ0cmFja2luZ0lkXCIpXX07dmFyIEhhPTMwO2Z1bmN0aW9uIFcoYSxiKXtKKGEsSC5XKTt3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lciYmKHRoaXMuYj1BKHtpbmNyZWFzZVRocmVzaG9sZDoyMCxzZXNzaW9uVGltZW91dDpIYSxmaWVsZHNPYmo6e319LGIpLHRoaXMuZj1hLHRoaXMuYz1KYSh0aGlzKSx0aGlzLmc9dGEodGhpcy5nLmJpbmQodGhpcyksNTAwKSx0aGlzLm89dGhpcy5vLmJpbmQodGhpcyksdGhpcy5hPVMoYS5nZXQoXCJ0cmFja2luZ0lkXCIpLFwicGx1Z2lucy9tYXgtc2Nyb2xsLXRyYWNrZXJcIiksdGhpcy5tPUlhKGEsdGhpcy5iLnNlc3Npb25UaW1lb3V0LHRoaXMuYi50aW1lWm9uZSkseChhLFwic2V0XCIsdGhpcy5vKSxLYSh0aGlzKSl9XG5mdW5jdGlvbiBLYShhKXsxMDA+KGEuYS5nZXQoKVthLmNdfHwwKSYmd2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJzY3JvbGxcIixhLmcpfVxuVy5wcm90b3R5cGUuZz1mdW5jdGlvbigpe3ZhciBhPWRvY3VtZW50LmRvY3VtZW50RWxlbWVudCxiPWRvY3VtZW50LmJvZHksYT1NYXRoLm1pbigxMDAsTWF0aC5tYXgoMCxNYXRoLnJvdW5kKHdpbmRvdy5wYWdlWU9mZnNldC8oTWF0aC5tYXgoYS5vZmZzZXRIZWlnaHQsYS5zY3JvbGxIZWlnaHQsYi5vZmZzZXRIZWlnaHQsYi5zY3JvbGxIZWlnaHQpLXdpbmRvdy5pbm5lckhlaWdodCkqMTAwKSkpLGI9Vih0aGlzLm0pO2IhPXRoaXMuYS5nZXQoKS5zZXNzaW9uSWQmJihHYSh0aGlzLmEpLHRoaXMuYS5zZXQoe3Nlc3Npb25JZDpifSkpO2lmKHRoaXMubS5pc0V4cGlyZWQodGhpcy5hLmdldCgpLnNlc3Npb25JZCkpR2EodGhpcy5hKTtlbHNlIGlmKGI9dGhpcy5hLmdldCgpW3RoaXMuY118fDAsYT5iJiYoMTAwIT1hJiYxMDAhPWJ8fHdpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwic2Nyb2xsXCIsdGhpcy5nKSxiPWEtYiwxMDA9PWF8fGI+PXRoaXMuYi5pbmNyZWFzZVRocmVzaG9sZCkpe3ZhciBjPVxue307dGhpcy5hLnNldCgoY1t0aGlzLmNdPWEsYy5zZXNzaW9uSWQ9Vih0aGlzLm0pLGMpKTthPXt0cmFuc3BvcnQ6XCJiZWFjb25cIixldmVudENhdGVnb3J5OlwiTWF4IFNjcm9sbFwiLGV2ZW50QWN0aW9uOlwiaW5jcmVhc2VcIixldmVudFZhbHVlOmIsZXZlbnRMYWJlbDpTdHJpbmcoYSksbm9uSW50ZXJhY3Rpb246ITB9O3RoaXMuYi5tYXhTY3JvbGxNZXRyaWNJbmRleCYmKGFbXCJtZXRyaWNcIit0aGlzLmIubWF4U2Nyb2xsTWV0cmljSW5kZXhdPWIpO3RoaXMuZi5zZW5kKFwiZXZlbnRcIix6KGEsdGhpcy5iLmZpZWxkc09iaix0aGlzLmYsdGhpcy5iLmhpdEZpbHRlcikpfX07Vy5wcm90b3R5cGUubz1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjLGQpe2EoYyxkKTt2YXIgZT17fTsoRChjKT9jOihlW2NdPWQsZSkpLnBhZ2UmJihjPWIuYyxiLmM9SmEoYiksYi5jIT1jJiZLYShiKSl9fTtcbmZ1bmN0aW9uIEphKGEpe2E9dShhLmYuZ2V0KFwicGFnZVwiKXx8YS5mLmdldChcImxvY2F0aW9uXCIpKTtyZXR1cm4gYS5wYXRobmFtZSthLnNlYXJjaH1XLnByb3RvdHlwZS5yZW1vdmU9ZnVuY3Rpb24oKXt0aGlzLm0uaigpO3dpbmRvdy5yZW1vdmVFdmVudExpc3RlbmVyKFwic2Nyb2xsXCIsdGhpcy5nKTt5KHRoaXMuZixcInNldFwiLHRoaXMubyl9O0coXCJtYXhTY3JvbGxUcmFja2VyXCIsVyk7dmFyIExhPXt9O2Z1bmN0aW9uIE1hKGEsYil7SihhLEguWCk7d2luZG93Lm1hdGNoTWVkaWEmJih0aGlzLmE9QSh7Y2hhbmdlVGVtcGxhdGU6dGhpcy5jaGFuZ2VUZW1wbGF0ZSxjaGFuZ2VUaW1lb3V0OjFFMyxmaWVsZHNPYmo6e319LGIpLEQodGhpcy5hLmRlZmluaXRpb25zKSYmKGI9dGhpcy5hLmRlZmluaXRpb25zLHRoaXMuYS5kZWZpbml0aW9ucz1BcnJheS5pc0FycmF5KGIpP2I6W2JdLHRoaXMuYj1hLHRoaXMuYz1bXSxPYSh0aGlzKSkpfVxuZnVuY3Rpb24gT2EoYSl7YS5hLmRlZmluaXRpb25zLmZvckVhY2goZnVuY3Rpb24oYil7aWYoYi5uYW1lJiZiLmRpbWVuc2lvbkluZGV4KXt2YXIgYz1QYShiKTthLmIuc2V0KFwiZGltZW5zaW9uXCIrYi5kaW1lbnNpb25JbmRleCxjKTtRYShhLGIpfX0pfWZ1bmN0aW9uIFBhKGEpe3ZhciBiO2EuaXRlbXMuZm9yRWFjaChmdW5jdGlvbihhKXtSYShhLm1lZGlhKS5tYXRjaGVzJiYoYj1hKX0pO3JldHVybiBiP2IubmFtZTpcIihub3Qgc2V0KVwifVxuZnVuY3Rpb24gUWEoYSxiKXtiLml0ZW1zLmZvckVhY2goZnVuY3Rpb24oYyl7Yz1SYShjLm1lZGlhKTt2YXIgZD10YShmdW5jdGlvbigpe3ZhciBjPVBhKGIpLGQ9YS5iLmdldChcImRpbWVuc2lvblwiK2IuZGltZW5zaW9uSW5kZXgpO2MhPT1kJiYoYS5iLnNldChcImRpbWVuc2lvblwiK2IuZGltZW5zaW9uSW5kZXgsYyksYz17dHJhbnNwb3J0OlwiYmVhY29uXCIsZXZlbnRDYXRlZ29yeTpiLm5hbWUsZXZlbnRBY3Rpb246XCJjaGFuZ2VcIixldmVudExhYmVsOmEuYS5jaGFuZ2VUZW1wbGF0ZShkLGMpLG5vbkludGVyYWN0aW9uOiEwfSxhLmIuc2VuZChcImV2ZW50XCIseihjLGEuYS5maWVsZHNPYmosYS5iLGEuYS5oaXRGaWx0ZXIpKSl9LGEuYS5jaGFuZ2VUaW1lb3V0KTtjLmFkZExpc3RlbmVyKGQpO2EuYy5wdXNoKHtmYTpjLGRhOmR9KX0pfU1hLnByb3RvdHlwZS5yZW1vdmU9ZnVuY3Rpb24oKXtmb3IodmFyIGE9MCxiO2I9dGhpcy5jW2FdO2ErKyliLmZhLnJlbW92ZUxpc3RlbmVyKGIuZGEpfTtcbk1hLnByb3RvdHlwZS5jaGFuZ2VUZW1wbGF0ZT1mdW5jdGlvbihhLGIpe3JldHVybiBhK1wiIFxceDNkXFx4M2UgXCIrYn07RyhcIm1lZGlhUXVlcnlUcmFja2VyXCIsTWEpO2Z1bmN0aW9uIFJhKGEpe3JldHVybiBMYVthXXx8KExhW2FdPXdpbmRvdy5tYXRjaE1lZGlhKGEpKX1mdW5jdGlvbiBYKGEsYil7SihhLEguWSk7d2luZG93LmFkZEV2ZW50TGlzdGVuZXImJih0aGlzLmE9QSh7Zm9ybVNlbGVjdG9yOlwiZm9ybVwiLHNob3VsZFRyYWNrT3V0Ym91bmRGb3JtOnRoaXMuc2hvdWxkVHJhY2tPdXRib3VuZEZvcm0sZmllbGRzT2JqOnt9LGF0dHJpYnV0ZVByZWZpeDpcImdhLVwifSxiKSx0aGlzLmI9YSx0aGlzLmM9cShcInN1Ym1pdFwiLHRoaXMuYS5mb3JtU2VsZWN0b3IsdGhpcy5mLmJpbmQodGhpcykpKX1cblgucHJvdG90eXBlLmY9ZnVuY3Rpb24oYSxiKXt2YXIgYz17dHJhbnNwb3J0OlwiYmVhY29uXCIsZXZlbnRDYXRlZ29yeTpcIk91dGJvdW5kIEZvcm1cIixldmVudEFjdGlvbjpcInN1Ym1pdFwiLGV2ZW50TGFiZWw6dShiLmFjdGlvbikuaHJlZn07aWYodGhpcy5hLnNob3VsZFRyYWNrT3V0Ym91bmRGb3JtKGIsdSkpe25hdmlnYXRvci5zZW5kQmVhY29ufHwoYS5wcmV2ZW50RGVmYXVsdCgpLGMuaGl0Q2FsbGJhY2s9dWEoZnVuY3Rpb24oKXtiLnN1Ym1pdCgpfSkpO3ZhciBkPUEoe30sdGhpcy5hLmZpZWxkc09iaixCKGIsdGhpcy5hLmF0dHJpYnV0ZVByZWZpeCkpO3RoaXMuYi5zZW5kKFwiZXZlbnRcIix6KGMsZCx0aGlzLmIsdGhpcy5hLmhpdEZpbHRlcixiLGEpKX19O1xuWC5wcm90b3R5cGUuc2hvdWxkVHJhY2tPdXRib3VuZEZvcm09ZnVuY3Rpb24oYSxiKXthPWIoYS5hY3Rpb24pO3JldHVybiBhLmhvc3RuYW1lIT1sb2NhdGlvbi5ob3N0bmFtZSYmXCJodHRwXCI9PWEucHJvdG9jb2wuc2xpY2UoMCw0KX07WC5wcm90b3R5cGUucmVtb3ZlPWZ1bmN0aW9uKCl7dGhpcy5jLmooKX07RyhcIm91dGJvdW5kRm9ybVRyYWNrZXJcIixYKTtcbmZ1bmN0aW9uIFkoYSxiKXt2YXIgYz10aGlzO0ooYSxILlopO3dpbmRvdy5hZGRFdmVudExpc3RlbmVyJiYodGhpcy5hPUEoe2V2ZW50czpbXCJjbGlja1wiXSxsaW5rU2VsZWN0b3I6XCJhLCBhcmVhXCIsc2hvdWxkVHJhY2tPdXRib3VuZExpbms6dGhpcy5zaG91bGRUcmFja091dGJvdW5kTGluayxmaWVsZHNPYmo6e30sYXR0cmlidXRlUHJlZml4OlwiZ2EtXCJ9LGIpLHRoaXMuYz1hLHRoaXMuZj10aGlzLmYuYmluZCh0aGlzKSx0aGlzLmI9e30sdGhpcy5hLmV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGEpe2MuYlthXT1xKGEsYy5hLmxpbmtTZWxlY3RvcixjLmYpfSkpfVxuWS5wcm90b3R5cGUuZj1mdW5jdGlvbihhLGIpe3ZhciBjPXRoaXM7aWYodGhpcy5hLnNob3VsZFRyYWNrT3V0Ym91bmRMaW5rKGIsdSkpe3ZhciBkPWIuZ2V0QXR0cmlidXRlKFwiaHJlZlwiKXx8Yi5nZXRBdHRyaWJ1dGUoXCJ4bGluazpocmVmXCIpLGU9dShkKSxlPXt0cmFuc3BvcnQ6XCJiZWFjb25cIixldmVudENhdGVnb3J5OlwiT3V0Ym91bmQgTGlua1wiLGV2ZW50QWN0aW9uOmEudHlwZSxldmVudExhYmVsOmUuaHJlZn0saD1BKHt9LHRoaXMuYS5maWVsZHNPYmosQihiLHRoaXMuYS5hdHRyaWJ1dGVQcmVmaXgpKSxmPXooZSxoLHRoaXMuYyx0aGlzLmEuaGl0RmlsdGVyLGIsYSk7aWYobmF2aWdhdG9yLnNlbmRCZWFjb258fFwiY2xpY2tcIiE9YS50eXBlfHxcIl9ibGFua1wiPT1iLnRhcmdldHx8YS5tZXRhS2V5fHxhLmN0cmxLZXl8fGEuc2hpZnRLZXl8fGEuYWx0S2V5fHwxPGEud2hpY2gpdGhpcy5jLnNlbmQoXCJldmVudFwiLGYpO2Vsc2V7dmFyIHY9ZnVuY3Rpb24oKXt3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsXG52KTtpZighYS5kZWZhdWx0UHJldmVudGVkKXthLnByZXZlbnREZWZhdWx0KCk7dmFyIGI9Zi5oaXRDYWxsYmFjaztmLmhpdENhbGxiYWNrPXVhKGZ1bmN0aW9uKCl7XCJmdW5jdGlvblwiPT10eXBlb2YgYiYmYigpO2xvY2F0aW9uLmhyZWY9ZH0pfWMuYy5zZW5kKFwiZXZlbnRcIixmKX07d2luZG93LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLHYpfX19O1kucHJvdG90eXBlLnNob3VsZFRyYWNrT3V0Ym91bmRMaW5rPWZ1bmN0aW9uKGEsYil7YT1hLmdldEF0dHJpYnV0ZShcImhyZWZcIil8fGEuZ2V0QXR0cmlidXRlKFwieGxpbms6aHJlZlwiKTtiPWIoYSk7cmV0dXJuIGIuaG9zdG5hbWUhPWxvY2F0aW9uLmhvc3RuYW1lJiZcImh0dHBcIj09Yi5wcm90b2NvbC5zbGljZSgwLDQpfTtZLnByb3RvdHlwZS5yZW1vdmU9ZnVuY3Rpb24oKXt2YXIgYT10aGlzO09iamVjdC5rZXlzKHRoaXMuYikuZm9yRWFjaChmdW5jdGlvbihiKXthLmJbYl0uaigpfSl9O0coXCJvdXRib3VuZExpbmtUcmFja2VyXCIsWSk7XG52YXIgWj1FKCk7XG5mdW5jdGlvbiBTYShhLGIpe3ZhciBjPXRoaXM7SihhLEguJCk7ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlJiYodGhpcy5hPUEoe3Nlc3Npb25UaW1lb3V0OkhhLHZpc2libGVUaHJlc2hvbGQ6NUUzLHNlbmRJbml0aWFsUGFnZXZpZXc6ITEsZmllbGRzT2JqOnt9fSxiKSx0aGlzLmI9YSx0aGlzLmc9ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlLHRoaXMubT1udWxsLHRoaXMubz0hMSx0aGlzLnY9dGhpcy52LmJpbmQodGhpcyksdGhpcy5zPXRoaXMucy5iaW5kKHRoaXMpLHRoaXMuRz10aGlzLkcuYmluZCh0aGlzKSx0aGlzLk49dGhpcy5OLmJpbmQodGhpcyksdGhpcy5jPVMoYS5nZXQoXCJ0cmFja2luZ0lkXCIpLFwicGx1Z2lucy9wYWdlLXZpc2liaWxpdHktdHJhY2tlclwiKSxDYSh0aGlzLmMsdGhpcy5OKSx0aGlzLmY9SWEoYSx0aGlzLmEuc2Vzc2lvblRpbWVvdXQsdGhpcy5hLnRpbWVab25lKSx4KGEsXCJzZXRcIix0aGlzLnYpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwidW5sb2FkXCIsdGhpcy5HKSxcbmRvY3VtZW50LmFkZEV2ZW50TGlzdGVuZXIoXCJ2aXNpYmlsaXR5Y2hhbmdlXCIsdGhpcy5zKSx2YSh0aGlzLmIsZnVuY3Rpb24oKXtpZihcInZpc2libGVcIj09ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlKWMuYS5zZW5kSW5pdGlhbFBhZ2V2aWV3JiYoVGEoYyx7ZWE6ITB9KSxjLm89ITApLGMuYy5zZXQoe3RpbWU6K25ldyBEYXRlLHN0YXRlOlwidmlzaWJsZVwiLHBhZ2VJZDpaLHNlc3Npb25JZDpWKGMuZil9KTtlbHNlIGlmKGMuYS5zZW5kSW5pdGlhbFBhZ2V2aWV3JiZjLmEucGFnZUxvYWRzTWV0cmljSW5kZXgpe3ZhciBhPXt9LGE9KGEudHJhbnNwb3J0PVwiYmVhY29uXCIsYS5ldmVudENhdGVnb3J5PVwiUGFnZSBWaXNpYmlsaXR5XCIsYS5ldmVudEFjdGlvbj1cInBhZ2UgbG9hZFwiLGEuZXZlbnRMYWJlbD1cIihub3Qgc2V0KVwiLGFbXCJtZXRyaWNcIitjLmEucGFnZUxvYWRzTWV0cmljSW5kZXhdPTEsYS5ub25JbnRlcmFjdGlvbj0hMCxhKTtjLmIuc2VuZChcImV2ZW50XCIseihhLGMuYS5maWVsZHNPYmosXG5jLmIsYy5hLmhpdEZpbHRlcikpfX0pKX1nPVNhLnByb3RvdHlwZTtcbmcucz1mdW5jdGlvbigpe3ZhciBhPXRoaXM7aWYoXCJ2aXNpYmxlXCI9PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZXx8XCJoaWRkZW5cIj09ZG9jdW1lbnQudmlzaWJpbGl0eVN0YXRlKXt2YXIgYj1VYSh0aGlzKSxjPXt0aW1lOituZXcgRGF0ZSxzdGF0ZTpkb2N1bWVudC52aXNpYmlsaXR5U3RhdGUscGFnZUlkOlosc2Vzc2lvbklkOlYodGhpcy5mKX07XCJ2aXNpYmxlXCI9PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSYmdGhpcy5hLnNlbmRJbml0aWFsUGFnZXZpZXcmJiF0aGlzLm8mJihUYSh0aGlzKSx0aGlzLm89ITApO1wiaGlkZGVuXCI9PWRvY3VtZW50LnZpc2liaWxpdHlTdGF0ZSYmdGhpcy5tJiZjbGVhclRpbWVvdXQodGhpcy5tKTt0aGlzLmYuaXNFeHBpcmVkKGIuc2Vzc2lvbklkKT8oR2EodGhpcy5jKSxcImhpZGRlblwiPT10aGlzLmcmJlwidmlzaWJsZVwiPT1kb2N1bWVudC52aXNpYmlsaXR5U3RhdGUmJihjbGVhclRpbWVvdXQodGhpcy5tKSx0aGlzLm09c2V0VGltZW91dChmdW5jdGlvbigpe2EuYy5zZXQoYyk7XG5UYShhLHtoaXRUaW1lOmMudGltZX0pfSx0aGlzLmEudmlzaWJsZVRocmVzaG9sZCkpKTooYi5wYWdlSWQ9PVomJlwidmlzaWJsZVwiPT1iLnN0YXRlJiZWYSh0aGlzLGIpLHRoaXMuYy5zZXQoYykpO3RoaXMuZz1kb2N1bWVudC52aXNpYmlsaXR5U3RhdGV9fTtmdW5jdGlvbiBVYShhKXt2YXIgYj1hLmMuZ2V0KCk7XCJ2aXNpYmxlXCI9PWEuZyYmXCJoaWRkZW5cIj09Yi5zdGF0ZSYmYi5wYWdlSWQhPVomJihiLnN0YXRlPVwidmlzaWJsZVwiLGIucGFnZUlkPVosYS5jLnNldChiKSk7cmV0dXJuIGJ9XG5mdW5jdGlvbiBWYShhLGIsYyl7Yz0oYz9jOnt9KS5oaXRUaW1lO3ZhciBkPXtoaXRUaW1lOmN9LGQ9KGQ/ZDp7fSkuaGl0VGltZTsoYj1iLnRpbWU/KGR8fCtuZXcgRGF0ZSktYi50aW1lOjApJiZiPj1hLmEudmlzaWJsZVRocmVzaG9sZCYmKGI9TWF0aC5yb3VuZChiLzFFMyksZD17dHJhbnNwb3J0OlwiYmVhY29uXCIsbm9uSW50ZXJhY3Rpb246ITAsZXZlbnRDYXRlZ29yeTpcIlBhZ2UgVmlzaWJpbGl0eVwiLGV2ZW50QWN0aW9uOlwidHJhY2tcIixldmVudFZhbHVlOmIsZXZlbnRMYWJlbDpcIihub3Qgc2V0KVwifSxjJiYoZC5xdWV1ZVRpbWU9K25ldyBEYXRlLWMpLGEuYS52aXNpYmxlTWV0cmljSW5kZXgmJihkW1wibWV0cmljXCIrYS5hLnZpc2libGVNZXRyaWNJbmRleF09YiksYS5iLnNlbmQoXCJldmVudFwiLHooZCxhLmEuZmllbGRzT2JqLGEuYixhLmEuaGl0RmlsdGVyKSkpfVxuZnVuY3Rpb24gVGEoYSxiKXt2YXIgYz1iP2I6e307Yj1jLmhpdFRpbWU7dmFyIGM9Yy5lYSxkPXt0cmFuc3BvcnQ6XCJiZWFjb25cIn07YiYmKGQucXVldWVUaW1lPStuZXcgRGF0ZS1iKTtjJiZhLmEucGFnZUxvYWRzTWV0cmljSW5kZXgmJihkW1wibWV0cmljXCIrYS5hLnBhZ2VMb2Fkc01ldHJpY0luZGV4XT0xKTthLmIuc2VuZChcInBhZ2V2aWV3XCIseihkLGEuYS5maWVsZHNPYmosYS5iLGEuYS5oaXRGaWx0ZXIpKX1nLnY9ZnVuY3Rpb24oYSl7dmFyIGI9dGhpcztyZXR1cm4gZnVuY3Rpb24oYyxkKXt2YXIgZT17fSxlPUQoYyk/YzooZVtjXT1kLGUpO2UucGFnZSYmZS5wYWdlIT09Yi5iLmdldChcInBhZ2VcIikmJlwidmlzaWJsZVwiPT1iLmcmJmIucygpO2EoYyxkKX19O2cuTj1mdW5jdGlvbihhLGIpe2EudGltZSE9Yi50aW1lJiYoYi5wYWdlSWQhPVp8fFwidmlzaWJsZVwiIT1iLnN0YXRlfHx0aGlzLmYuaXNFeHBpcmVkKGIuc2Vzc2lvbklkKXx8VmEodGhpcyxiLHtoaXRUaW1lOmEudGltZX0pKX07XG5nLkc9ZnVuY3Rpb24oKXtcImhpZGRlblwiIT10aGlzLmcmJnRoaXMucygpfTtnLnJlbW92ZT1mdW5jdGlvbigpe3RoaXMuYy5qKCk7dGhpcy5mLmooKTt5KHRoaXMuYixcInNldFwiLHRoaXMudik7d2luZG93LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJ1bmxvYWRcIix0aGlzLkcpO2RvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJ2aXNpYmlsaXR5Y2hhbmdlXCIsdGhpcy5zKX07RyhcInBhZ2VWaXNpYmlsaXR5VHJhY2tlclwiLFNhKTtcbmZ1bmN0aW9uIFdhKGEsYil7SihhLEguYWEpO3dpbmRvdy5hZGRFdmVudExpc3RlbmVyJiYodGhpcy5hPUEoe2ZpZWxkc09iajp7fSxoaXRGaWx0ZXI6bnVsbH0sYiksdGhpcy5iPWEsdGhpcy51PXRoaXMudS5iaW5kKHRoaXMpLHRoaXMuSj10aGlzLkouYmluZCh0aGlzKSx0aGlzLkQ9dGhpcy5ELmJpbmQodGhpcyksdGhpcy5BPXRoaXMuQS5iaW5kKHRoaXMpLHRoaXMuQj10aGlzLkIuYmluZCh0aGlzKSx0aGlzLkY9dGhpcy5GLmJpbmQodGhpcyksXCJjb21wbGV0ZVwiIT1kb2N1bWVudC5yZWFkeVN0YXRlP3dpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwibG9hZFwiLHRoaXMudSk6dGhpcy51KCkpfWc9V2EucHJvdG90eXBlO1xuZy51PWZ1bmN0aW9uKCl7aWYod2luZG93LkZCKXRyeXt3aW5kb3cuRkIuRXZlbnQuc3Vic2NyaWJlKFwiZWRnZS5jcmVhdGVcIix0aGlzLkIpLHdpbmRvdy5GQi5FdmVudC5zdWJzY3JpYmUoXCJlZGdlLnJlbW92ZVwiLHRoaXMuRil9Y2F0Y2goYSl7fXdpbmRvdy50d3R0ciYmdGhpcy5KKCl9O2cuSj1mdW5jdGlvbigpe3ZhciBhPXRoaXM7dHJ5e3dpbmRvdy50d3R0ci5yZWFkeShmdW5jdGlvbigpe3dpbmRvdy50d3R0ci5ldmVudHMuYmluZChcInR3ZWV0XCIsYS5EKTt3aW5kb3cudHd0dHIuZXZlbnRzLmJpbmQoXCJmb2xsb3dcIixhLkEpfSl9Y2F0Y2goYil7fX07ZnVuY3Rpb24gWGEoYSl7dHJ5e3dpbmRvdy50d3R0ci5yZWFkeShmdW5jdGlvbigpe3dpbmRvdy50d3R0ci5ldmVudHMudW5iaW5kKFwidHdlZXRcIixhLkQpO3dpbmRvdy50d3R0ci5ldmVudHMudW5iaW5kKFwiZm9sbG93XCIsYS5BKX0pfWNhdGNoKGIpe319XG5nLkQ9ZnVuY3Rpb24oYSl7aWYoXCJ0d2VldFwiPT1hLnJlZ2lvbil7dmFyIGI9e3RyYW5zcG9ydDpcImJlYWNvblwiLHNvY2lhbE5ldHdvcms6XCJUd2l0dGVyXCIsc29jaWFsQWN0aW9uOlwidHdlZXRcIixzb2NpYWxUYXJnZXQ6YS5kYXRhLnVybHx8YS50YXJnZXQuZ2V0QXR0cmlidXRlKFwiZGF0YS11cmxcIil8fGxvY2F0aW9uLmhyZWZ9O3RoaXMuYi5zZW5kKFwic29jaWFsXCIseihiLHRoaXMuYS5maWVsZHNPYmosdGhpcy5iLHRoaXMuYS5oaXRGaWx0ZXIsYS50YXJnZXQsYSkpfX07XG5nLkE9ZnVuY3Rpb24oYSl7aWYoXCJmb2xsb3dcIj09YS5yZWdpb24pe3ZhciBiPXt0cmFuc3BvcnQ6XCJiZWFjb25cIixzb2NpYWxOZXR3b3JrOlwiVHdpdHRlclwiLHNvY2lhbEFjdGlvbjpcImZvbGxvd1wiLHNvY2lhbFRhcmdldDphLmRhdGEuc2NyZWVuX25hbWV8fGEudGFyZ2V0LmdldEF0dHJpYnV0ZShcImRhdGEtc2NyZWVuLW5hbWVcIil9O3RoaXMuYi5zZW5kKFwic29jaWFsXCIseihiLHRoaXMuYS5maWVsZHNPYmosdGhpcy5iLHRoaXMuYS5oaXRGaWx0ZXIsYS50YXJnZXQsYSkpfX07Zy5CPWZ1bmN0aW9uKGEpe3RoaXMuYi5zZW5kKFwic29jaWFsXCIseih7dHJhbnNwb3J0OlwiYmVhY29uXCIsc29jaWFsTmV0d29yazpcIkZhY2Vib29rXCIsc29jaWFsQWN0aW9uOlwibGlrZVwiLHNvY2lhbFRhcmdldDphfSx0aGlzLmEuZmllbGRzT2JqLHRoaXMuYix0aGlzLmEuaGl0RmlsdGVyKSl9O1xuZy5GPWZ1bmN0aW9uKGEpe3RoaXMuYi5zZW5kKFwic29jaWFsXCIseih7dHJhbnNwb3J0OlwiYmVhY29uXCIsc29jaWFsTmV0d29yazpcIkZhY2Vib29rXCIsc29jaWFsQWN0aW9uOlwidW5saWtlXCIsc29jaWFsVGFyZ2V0OmF9LHRoaXMuYS5maWVsZHNPYmosdGhpcy5iLHRoaXMuYS5oaXRGaWx0ZXIpKX07Zy5yZW1vdmU9ZnVuY3Rpb24oKXt3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcImxvYWRcIix0aGlzLnUpO3RyeXt3aW5kb3cuRkIuRXZlbnQudW5zdWJzY3JpYmUoXCJlZGdlLmNyZWF0ZVwiLHRoaXMuQiksd2luZG93LkZCLkV2ZW50LnVuc3Vic2NyaWJlKFwiZWRnZS5yZW1vdmVcIix0aGlzLkYpfWNhdGNoKGEpe31YYSh0aGlzKX07RyhcInNvY2lhbFdpZGdldFRyYWNrZXJcIixXYSk7XG5mdW5jdGlvbiBZYShhLGIpe0ooYSxILmJhKTtoaXN0b3J5LnB1c2hTdGF0ZSYmd2luZG93LmFkZEV2ZW50TGlzdGVuZXImJih0aGlzLmE9QSh7c2hvdWxkVHJhY2tVcmxDaGFuZ2U6dGhpcy5zaG91bGRUcmFja1VybENoYW5nZSx0cmFja1JlcGxhY2VTdGF0ZTohMSxmaWVsZHNPYmo6e30saGl0RmlsdGVyOm51bGx9LGIpLHRoaXMuYj1hLHRoaXMuYz1sb2NhdGlvbi5wYXRobmFtZStsb2NhdGlvbi5zZWFyY2gsdGhpcy5IPXRoaXMuSC5iaW5kKHRoaXMpLHRoaXMuST10aGlzLkkuYmluZCh0aGlzKSx0aGlzLkM9dGhpcy5DLmJpbmQodGhpcykseChoaXN0b3J5LFwicHVzaFN0YXRlXCIsdGhpcy5IKSx4KGhpc3RvcnksXCJyZXBsYWNlU3RhdGVcIix0aGlzLkkpLHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKFwicG9wc3RhdGVcIix0aGlzLkMpKX1nPVlhLnByb3RvdHlwZTtcbmcuSD1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjKXtmb3IodmFyIGQ9W10sZT0wO2U8YXJndW1lbnRzLmxlbmd0aDsrK2UpZFtlLTBdPWFyZ3VtZW50c1tlXTthLmFwcGx5KG51bGwsW10uY29uY2F0KG4oZCkpKTtaYShiLCEwKX19O2cuST1mdW5jdGlvbihhKXt2YXIgYj10aGlzO3JldHVybiBmdW5jdGlvbihjKXtmb3IodmFyIGQ9W10sZT0wO2U8YXJndW1lbnRzLmxlbmd0aDsrK2UpZFtlLTBdPWFyZ3VtZW50c1tlXTthLmFwcGx5KG51bGwsW10uY29uY2F0KG4oZCkpKTtaYShiLCExKX19O2cuQz1mdW5jdGlvbigpe1phKHRoaXMsITApfTtcbmZ1bmN0aW9uIFphKGEsYil7c2V0VGltZW91dChmdW5jdGlvbigpe3ZhciBjPWEuYyxkPWxvY2F0aW9uLnBhdGhuYW1lK2xvY2F0aW9uLnNlYXJjaDtjIT1kJiZhLmEuc2hvdWxkVHJhY2tVcmxDaGFuZ2UuY2FsbChhLGQsYykmJihhLmM9ZCxhLmIuc2V0KHtwYWdlOmQsdGl0bGU6ZG9jdW1lbnQudGl0bGV9KSwoYnx8YS5hLnRyYWNrUmVwbGFjZVN0YXRlKSYmYS5iLnNlbmQoXCJwYWdldmlld1wiLHooe3RyYW5zcG9ydDpcImJlYWNvblwifSxhLmEuZmllbGRzT2JqLGEuYixhLmEuaGl0RmlsdGVyKSkpfSwwKX1nLnNob3VsZFRyYWNrVXJsQ2hhbmdlPWZ1bmN0aW9uKGEsYil7cmV0dXJuISghYXx8IWIpfTtnLnJlbW92ZT1mdW5jdGlvbigpe3koaGlzdG9yeSxcInB1c2hTdGF0ZVwiLHRoaXMuSCk7eShoaXN0b3J5LFwicmVwbGFjZVN0YXRlXCIsdGhpcy5JKTt3aW5kb3cucmVtb3ZlRXZlbnRMaXN0ZW5lcihcInBvcHN0YXRlXCIsdGhpcy5DKX07RyhcInVybENoYW5nZVRyYWNrZXJcIixZYSk7fSkoKTtcblxuIiwiKCBmdW5jdGlvbiggJCApIHtcblxuXHQvKlxuXHQgKiBDcmVhdGUgYSBHb29nbGUgQW5hbHl0aWNzIGV2ZW50XG5cdCAqIGNhdGVnb3J5OiBFdmVudCBDYXRlZ29yeVxuXHQgKiBsYWJlbDogRXZlbnQgTGFiZWxcblx0ICogYWN0aW9uOiBFdmVudCBBY3Rpb25cblx0ICogdmFsdWU6IG9wdGlvbmFsXG5cdCovXG5cdGZ1bmN0aW9uIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggdHlwZSwgY2F0ZWdvcnksIGFjdGlvbiwgbGFiZWwsIHZhbHVlICkge1xuXHRcdGlmICggdHlwZW9mIGdhICE9PSAndW5kZWZpbmVkJyApIHtcblx0XHRcdGlmICggdHlwZW9mIHZhbHVlID09PSAndW5kZWZpbmVkJyApIHtcblx0XHRcdFx0Z2EoICdzZW5kJywgdHlwZSwgY2F0ZWdvcnksIGFjdGlvbiwgbGFiZWwgKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGdhKCAnc2VuZCcsIHR5cGUsIGNhdGVnb3J5LCBhY3Rpb24sIGxhYmVsLCB2YWx1ZSApO1xuXHRcdFx0fVxuXHRcdH0gZWxzZSB7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXHR9XG5cblx0aWYgKCAndW5kZWZpbmVkJyAhPT0gdHlwZW9mIGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncyApIHtcblxuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zY3JvbGwuZW5hYmxlZCApIHtcblx0XHRcdCQuc2Nyb2xsRGVwdGgoe1xuXHRcdFx0ICBtaW5IZWlnaHQ6IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zY3JvbGwubWluaW11bV9oZWlnaHQsXG5cdFx0XHQgIGVsZW1lbnRzOiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsLnNjcm9sbF9lbGVtZW50cy5zcGxpdCgnLCAnKSxcblx0XHRcdCAgcGVyY2VudGFnZTogYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbC5wZXJjZW50YWdlLFxuXHRcdFx0ICB1c2VyVGltaW5nOiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsLnVzZXJfdGltaW5nLFxuXHRcdFx0ICBwaXhlbERlcHRoOiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc2Nyb2xsLnBpeGVsX2RlcHRoLFxuXHRcdFx0ICBub25JbnRlcmFjdGlvbjogYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNjcm9sbC5ub25faW50ZXJhY3Rpb25cblx0XHRcdH0pO1xuXHRcdH1cblxuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc3BlY2lhbCAmJiB0cnVlID09PSBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc3BlY2lhbC5lbmFibGVkICkge1xuXG5cdFx0XHQvLyBleHRlcm5hbCBsaW5rc1xuXHRcdFx0JCggJ2FbaHJlZl49XCJodHRwXCJdOm5vdChbaHJlZio9XCI6Ly8nICsgZG9jdW1lbnQuZG9tYWluICsgJ1wiXSknICkuY2xpY2soIGZ1bmN0aW9uKCkge1xuXHRcdFx0ICAgIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ091dGJvdW5kIGxpbmtzJywgJ0NsaWNrJywgdGhpcy5ocmVmICk7XG5cdFx0XHR9KTtcblxuXHRcdFx0Ly8gbWFpbHRvIGxpbmtzXG5cdFx0XHQkKCAnYVtocmVmXj1cIm1haWx0b1wiXScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cdFx0XHQgICAgd3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnTWFpbHMnLCAnQ2xpY2snLCB0aGlzLmhyZWYuc3Vic3RyaW5nKCA3ICkgKTtcblx0XHRcdH0pO1xuXG5cdFx0XHQvLyB0ZWwgbGlua3Ncblx0XHRcdCQoICdhW2hyZWZePVwidGVsXCJdJyApLmNsaWNrKCBmdW5jdGlvbigpIHtcblx0XHRcdCAgICB3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdUZWxlcGhvbmUnLCAnQ2FsbCcsIHRoaXMuaHJlZi5zdWJzdHJpbmcoIDcgKSApO1xuXHRcdFx0fSk7XG5cblx0XHRcdC8vIGludGVybmFsIGxpbmtzXG5cdFx0XHQkKCAnYTpub3QoW2hyZWZePVwiKGh0dHA6fGh0dHBzOik/Ly9cIl0sW2hyZWZePVwiI1wiXSxbaHJlZl49XCJtYWlsdG86XCJdKScgKS5jbGljayggZnVuY3Rpb24oKSB7XG5cblx0XHRcdFx0Ly8gdHJhY2sgZG93bmxvYWRzXG5cdFx0XHRcdGlmICggJycgIT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5zcGVjaWFsLmRvd25sb2FkX3JlZ2V4ICkge1xuXHRcdFx0XHRcdHZhciB1cmwgPSB0aGlzLmhyZWY7XG5cdFx0XHRcdFx0dmFyIGNoZWNrRG93bmxvYWQgPSBuZXcgUmVnRXhwKCBcIlxcXFwuKFwiICsgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLnNwZWNpYWwuZG93bmxvYWRfcmVnZXggKyBcIikoW1xcPyNdLiopPyRcIiwgXCJpXCIgKTtcblx0XHRcdFx0XHR2YXIgaXNEb3dubG9hZCA9IGNoZWNrRG93bmxvYWQudGVzdCggdXJsICk7XG5cdFx0XHRcdFx0aWYgKCB0cnVlID09PSBpc0Rvd25sb2FkICkge1xuXHRcdFx0XHRcdFx0dmFyIGNoZWNrRG93bmxvYWRFeHRlbnNpb24gPSBuZXcgUmVnRXhwKFwiXFxcXC4oXCIgKyBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3Muc3BlY2lhbC5kb3dubG9hZF9yZWdleCArIFwiKShbXFw/I10uKik/JFwiLCBcImlcIik7XG5cdFx0XHRcdFx0XHR2YXIgZXh0ZW5zaW9uUmVzdWx0ID0gY2hlY2tEb3dubG9hZEV4dGVuc2lvbi5leGVjKCB1cmwgKTtcblx0XHRcdFx0XHRcdHZhciBleHRlbnNpb24gPSAnJztcblx0XHRcdFx0XHRcdGlmICggbnVsbCAhPT0gZXh0ZW5zaW9uUmVzdWx0ICkge1xuXHRcdFx0XHRcdFx0XHRleHRlbnNpb24gPSBleHRlbnNpb25SZXN1bHRbMV07XG5cdFx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0XHRleHRlbnNpb24gPSBleHRlbnNpb25SZXN1bHQ7XG5cdFx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0XHQvLyB3ZSBjYW4ndCB1c2UgdGhlIHVybCBmb3IgdGhlIHZhbHVlIGhlcmUsIGV2ZW4gdGhvdWdoIHRoYXQgd291bGQgYmUgbmljZSwgYmVjYXVzZSB2YWx1ZSBpcyBzdXBwb3NlZCB0byBiZSBhbiBpbnRlZ2VyXG5cdFx0XHRcdFx0XHR3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdEb3dubG9hZHMnLCBleHRlbnNpb24sIHRoaXMuaHJlZiApO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXG5cdFx0XHR9KTtcblxuXHRcdH1cblxuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5hZmZpbGlhdGUuZW5hYmxlZCApIHtcblx0XHRcdC8vIGFueSBsaW5rIGNvdWxkIGJlIGFuIGFmZmlsaWF0ZSwgaSBndWVzcz9cblx0XHRcdCQoICdhJyApLmNsaWNrKCBmdW5jdGlvbigpIHtcblxuXHRcdFx0XHQvLyB0cmFjayBhZmZpbGlhdGVzXG5cdFx0XHRcdGlmICggJycgIT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5hZmZpbGlhdGUuYWZmaWxpYXRlX3JlZ2V4ICkge1xuXHRcdFx0XHRcdHZhciBjaGVja0FmZmlsaWF0ZSA9IG5ldyBSZWdFeHAoIFwiXFxcXC4oXCIgKyBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MuYWZmaWxpYXRlLmFmZmlsaWF0ZV9yZWdleCArIFwiKShbXFw/I10uKik/JFwiLCBcImlcIiApO1xuXHRcdFx0XHRcdHZhciBpc0FmZmlsaWF0ZSA9IGNoZWNrQWZmaWxpYXRlLnRlc3QoIHVybCApO1xuXHRcdFx0XHRcdGlmICggdHJ1ZSA9PT0gaXNBZmZpbGlhdGUgKSB7XG5cdFx0XHRcdFx0XHR3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdBZmZpbGlhdGUnLCAnQ2xpY2snLCB0aGlzLmhyZWYgKTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblxuXHRcdFx0fSk7XG5cdFx0fVxuXG5cdFx0Ly8gbGluayBmcmFnbWVudHMgYXMgcGFnZXZpZXdzXG5cdFx0Ly8gZG9lcyBub3QgdXNlIHRoZSBldmVudCB0cmFja2luZyBtZXRob2Rcblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmZyYWdtZW50ICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy5mcmFnbWVudC5lbmFibGVkICkge1xuXHRcdFx0aWYgKCB0eXBlb2YgZ2EgIT09ICd1bmRlZmluZWQnICkge1xuXHRcdFx0XHR3aW5kb3cub25oYXNoY2hhbmdlID0gZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0Z2EoICdzZW5kJywgJ3BhZ2V2aWV3JywgbG9jYXRpb24ucGF0aG5hbWUgKyBsb2NhdGlvbi5zZWFyY2ggKyBsb2NhdGlvbi5oYXNoICk7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cblx0XHQvLyBiYXNpYyBmb3JtIHN1Ym1pdHNcblx0XHRpZiAoICd1bmRlZmluZWQnICE9PSB0eXBlb2YgYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmZvcm1fc3VibWlzc2lvbnMgJiYgdHJ1ZSA9PT0gYW5hbHl0aWNzX3RyYWNraW5nX3NldHRpbmdzLmZvcm1fc3VibWlzc2lvbnMuZW5hYmxlZCApIHtcblx0XHRcdCQoICdpbnB1dFt0eXBlPVwic3VibWl0XCJdLCBidXR0b25bdHlwZT1cInN1Ym1pdFwiXScgKS5jbGljayggZnVuY3Rpb24oIGYgKSB7XG5cdCAgICAgICAgICAgIHZhciBjYXRlZ29yeSA9ICQoIHRoaXMgKS5kYXRhKCAnZ2EtY2F0ZWdvcnknICkgfHwgJ0Zvcm0nO1xuXHQgICAgICAgICAgICB2YXIgYWN0aW9uID0gJCggdGhpcyApLmRhdGEoICdnYS1hY3Rpb24nICkgfHwgJ1N1Ym1pdCc7XG5cdCAgICAgICAgICAgIHZhciBsYWJlbCA9ICQoIHRoaXMgKS5kYXRhKCAnZ2EtbGFiZWwnICkgfHwgdGhpcy5uYW1lIHx8IHRoaXMudmFsdWU7XG5cdCAgICAgICAgICAgIHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgY2F0ZWdvcnksIGFjdGlvbiwgbGFiZWwgKTtcblx0ICAgICAgICB9KTtcblx0XHR9XG5cblx0fVxuXG5cdCQoIGRvY3VtZW50ICkucmVhZHkoIGZ1bmN0aW9uKCkge1xuXHRcdGlmICggJ3VuZGVmaW5lZCcgIT09IHR5cGVvZiBhbmFseXRpY3NfdHJhY2tpbmdfc2V0dGluZ3MudHJhY2tfYWRibG9ja2VyICYmIHRydWUgPT09IGFuYWx5dGljc190cmFja2luZ19zZXR0aW5ncy50cmFja19hZGJsb2NrZXIuZW5hYmxlZCApIHtcblx0XHRcdGlmICggdHlwZW9mIHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IgPT09ICd1bmRlZmluZWQnICkge1xuXHRcdFx0XHR3cF9hbmFseXRpY3NfdHJhY2tpbmdfZXZlbnQoICdldmVudCcsICdBZGJsb2NrJywgJ09uJywgeyAnbm9uSW50ZXJhY3Rpb24nOiAxIH0gKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHdpbmRvdy5hZGJsb2NrRGV0ZWN0b3IuaW5pdChcblx0XHRcdFx0XHR7XG5cdFx0XHRcdFx0XHRkZWJ1ZzogZmFsc2UsXG5cdFx0XHRcdFx0XHRmb3VuZDogZnVuY3Rpb24oKSB7XG5cdFx0XHRcdFx0XHRcdHdwX2FuYWx5dGljc190cmFja2luZ19ldmVudCggJ2V2ZW50JywgJ0FkYmxvY2snLCAnT24nLCB7ICdub25JbnRlcmFjdGlvbic6IDEgfSApO1xuXHRcdFx0XHRcdFx0fSxcblx0XHRcdFx0XHRcdG5vdEZvdW5kOiBmdW5jdGlvbigpIHtcblx0XHRcdFx0XHRcdFx0d3BfYW5hbHl0aWNzX3RyYWNraW5nX2V2ZW50KCAnZXZlbnQnLCAnQWRibG9jaycsICdPZmYnLCB7ICdub25JbnRlcmFjdGlvbic6IDEgfSApO1xuXHRcdFx0XHRcdFx0fVxuXHRcdFx0XHRcdH1cblx0XHRcdFx0KTtcblx0XHRcdH1cblx0XHR9XG5cdH0pO1xuXG59ICkoIGpRdWVyeSApO1xuIl19
