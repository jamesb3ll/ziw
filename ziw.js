/**
 * Ziw — An HTML-first JavaScript framework.
 *
 * HTML renders immediately. JS only activates through event delegation
 * when users interact with the page.
 *
 * HTML API:
 *   jscomponent="Name"  — marks an element as a component root
 *   jsaction="actionName" — marks an element as triggering a named action
 *   jssrc="./path.js"   — URL of the component's JS file (enables lazy loading)
 *   jsload="eager|interaction|visible|idle" — when to load the JS
 *
 * JS API:
 *   Ziw.register('Name', {
 *     actions: {
 *       actionName: {
 *         click(event, actionEl, componentEl) { ... },
 *         keydown(event, actionEl, componentEl) { ... }
 *       }
 *     }
 *   });
 */
(function () {
  'use strict';

  // Map<string, componentDef> — registered component definitions keyed by name.
  var componentRegistry = new Map();

  // Set<string> — DOM event type names that already have a global listener.
  var activeEventTypes = new Set();

  // Map<string, Promise> — in-flight script loads keyed by src URL.
  var pendingLoads = new Map();

  // Array<{event, actionEl, compEl, compName, actionName, eventType}>
  // Buffered events for "interaction" components waiting to load.
  var eventQueue = [];

  // Shared IntersectionObserver instance, created lazily.
  var visibilityObserver = null;

  // Default event types installed eagerly so interaction-triggered
  // components can catch events before any JS registers.
  var DEFAULT_EVENT_TYPES = [
    'click', 'keydown', 'keyup', 'input', 'change',
    'focus', 'blur', 'submit',
    'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    'mousemove', 'mouseup', 'mousedown',
  ];

  /**
   * Install a single capture-phase listener on `document` for the given event
   * type, if one hasn't been installed yet.
   *
   * Capture phase is used so that:
   *  1. The framework sees events before any stopPropagation calls.
   *  2. Non-bubbling events (focus, blur) are still intercepted.
   */
  function ensureEventListener(eventType) {
    if (activeEventTypes.has(eventType)) return;
    activeEventTypes.add(eventType);
    document.addEventListener(eventType, globalDispatch, true);
  }

  /**
   * Load a component's JS file by injecting a <script> tag.
   * Returns a Promise that resolves when the script loads.
   * Deduplicates via pendingLoads so the same src is never fetched twice.
   */
  function loadComponent(name, src) {
    if (pendingLoads.has(src)) return pendingLoads.get(src);

    var promise = new Promise(function (resolve, reject) {
      var script = document.createElement('script');
      script.src = src;
      script.onload = function () {
        replayEvents(name);
        resolve();
      };
      script.onerror = function () {
        pendingLoads.delete(src);
        reject(new Error('Failed to load component script: ' + src));
      };
      document.head.appendChild(script);
    });

    pendingLoads.set(src, promise);
    return promise;
  }

  /**
   * After a component loads, replay any buffered events for it.
   */
  function replayEvents(compName) {
    var remaining = [];
    for (var i = 0; i < eventQueue.length; i++) {
      var entry = eventQueue[i];
      if (entry.compName === compName) {
        var def = componentRegistry.get(compName);
        if (def && def.actions && def.actions[entry.actionName]) {
          var handler = def.actions[entry.actionName][entry.eventType];
          if (handler) {
            handler(entry.event, entry.actionEl, entry.compEl);
          }
        }
      } else {
        remaining.push(entry);
      }
    }
    eventQueue = remaining;
  }

  /**
   * Get or create the shared IntersectionObserver for "visible" components.
   */
  function getVisibilityObserver() {
    if (visibilityObserver) return visibilityObserver;
    visibilityObserver = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          var el = entries[i].target;
          var name = el.getAttribute('jscomponent');
          var src = el.getAttribute('jssrc');
          visibilityObserver.unobserve(el);
          if (name && src && !componentRegistry.has(name)) {
            loadComponent(name, src);
          }
        }
      }
    });
    return visibilityObserver;
  }

  /**
   * Scan the DOM for [jscomponent][jssrc] elements and set up lazy loading
   * based on their jsload attribute.
   */
  function scan(root) {
    root = root || document;
    var elements = root.querySelectorAll('[jscomponent][jssrc]');

    for (var i = 0; i < elements.length; i++) {
      var el = elements[i];
      var name = el.getAttribute('jscomponent');
      var src = el.getAttribute('jssrc');
      var loadStrategy = el.getAttribute('jsload') || 'eager';

      // Skip if already registered.
      if (componentRegistry.has(name)) continue;

      if (loadStrategy === 'eager') {
        loadComponent(name, src);
      } else if (loadStrategy === 'visible') {
        getVisibilityObserver().observe(el);
      } else if (loadStrategy === 'idle') {
        (function (n, s) {
          var schedule = window.requestIdleCallback || function (fn) { setTimeout(fn, 1); };
          schedule(function () {
            if (!componentRegistry.has(n)) {
              loadComponent(n, s);
            }
          });
        })(name, src);
      }
      // "interaction" — handled by globalDispatch, no setup needed here.
    }
  }

  /**
   * Core dispatch algorithm (runs in capture phase).
   *
   * 1. Walk up from event.target looking for elements with a `jsaction` attribute.
   * 2. For each jsaction element found, walk up (inclusive) looking for the
   *    nearest ancestor with a `jscomponent` attribute.
   * 3. Check if that component's registered definition has an action matching
   *    the jsaction name AND a handler for this event type.
   * 4. If yes — call the handler and stop.
   * 5. If no — continue walking to outer jscomponent ancestors (action bubbling).
   * 6. If no component handles the action, continue the outer walk to find
   *    higher jsaction elements.
   *
   * For unregistered components with jssrc + jsload="interaction", buffer the
   * event and trigger a load.
   */
  function globalDispatch(event) {
    var eventType = event.type;
    var el = event.target;

    // Outer walk: find jsaction elements from target upward.
    while (el && el !== document) {
      var actionName = el.getAttribute && el.getAttribute('jsaction');
      if (actionName) {
        // Inner walk: find the nearest jscomponent ancestor (inclusive).
        var compEl = el;
        while (compEl && compEl !== document) {
          var compName = compEl.getAttribute && compEl.getAttribute('jscomponent');
          if (compName) {
            var def = componentRegistry.get(compName);
            if (def && def.actions && def.actions[actionName]) {
              var handler = def.actions[actionName][eventType];
              if (handler) {
                handler(event, el, compEl);
                return; // Handled — stop dispatch.
              }
            }

            // Component not registered yet — check for lazy load.
            if (!def) {
              var src = compEl.getAttribute('jssrc');
              var loadStrategy = compEl.getAttribute('jsload');
              if (src && loadStrategy === 'interaction') {
                eventQueue.push({
                  event: event,
                  actionEl: el,
                  compEl: compEl,
                  compName: compName,
                  actionName: actionName,
                  eventType: eventType
                });
                loadComponent(compName, src);
                return; // Event buffered — stop dispatch.
              }
            }

            // This component didn't handle it; keep walking up for outer
            // jscomponent ancestors (action bubbling).
          }
          compEl = compEl.parentElement;
        }
      }
      el = el.parentElement;
    }
  }

  /**
   * Register a component definition.
   *
   * @param {string} name — must match the `jscomponent` attribute value in HTML.
   * @param {object} def  — component definition with an `actions` object.
   */
  function register(name, def) {
    componentRegistry.set(name, def);

    // Extract every event type mentioned across all actions and ensure a
    // global listener is installed for each one.
    if (def.actions) {
      var actionNames = Object.keys(def.actions);
      for (var i = 0; i < actionNames.length; i++) {
        var eventTypes = Object.keys(def.actions[actionNames[i]]);
        for (var j = 0; j < eventTypes.length; j++) {
          ensureEventListener(eventTypes[j]);
        }
      }
    }
  }

  // Install default event listeners so interaction-triggered lazy components
  // can catch events before any component JS has loaded.
  for (var i = 0; i < DEFAULT_EVENT_TYPES.length; i++) {
    ensureEventListener(DEFAULT_EVENT_TYPES[i]);
  }

  // Auto-scan on DOMContentLoaded (or immediately if already loaded).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }

  // Public API
  window.Ziw = {
    register: register,
    scan: scan
  };
})();
