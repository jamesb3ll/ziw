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
 *   jsdata="key"        — binds element's textContent to a state key
 *   jsfor="key"         — repeats first child element for each item in a state array
 *   jsif="key"          — removes element when falsy, re-inserts when truthy (prefix ! to negate)
 *
 * JS API:
 *   Ziw.register('Name', {
 *     state: { key: initialValue },           // optional initial state
 *     init(compEl, state) { },                 // called once on activation
 *     update(compEl, state, prev) { },         // called after each setState
 *     destroy(compEl, state) { },              // called via Ziw.destroy(el)
 *     actions: {
 *       actionName: {
 *         click(event, actionEl, componentEl, { state, setState }) { ... }
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

  // WeakMap<Element, { state: object, prev: object }> — per-element state.
  var instanceStore = new WeakMap();

  // WeakMap<Element, Element> — stores the cloned template (first child) for each jsfor container.
  var forTemplates = new WeakMap();

  // WeakMap<Element, Array<{el, marker, key, negated, inDom}>> — jsif bindings per component.
  var ifBindingsStore = new WeakMap();

  // Default event types installed eagerly so interaction-triggered
  // components can catch events before any JS registers.
  var DEFAULT_EVENT_TYPES = [
    'click', 'keydown', 'keyup', 'input', 'change',
    'focus', 'blur', 'submit',
    // 'mouseover', 'mouseout', 'mouseenter', 'mouseleave',
    // 'mousemove', 'mouseup', 'mousedown',
  ];

  /**
   * Deep-clone a plain object (supports nested objects, arrays, and primitives).
   */
  function deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) {
      var arr = [];
      for (var i = 0; i < obj.length; i++) arr.push(deepClone(obj[i]));
      return arr;
    }
    var clone = {};
    var keys = Object.keys(obj);
    for (var i = 0; i < keys.length; i++) {
      clone[keys[i]] = deepClone(obj[keys[i]]);
    }
    return clone;
  }

  /**
   * Check whether a descendant element belongs to the given component element,
   * i.e. there is no closer jscomponent ancestor between them.
   */
  function belongsToComponent(el, compEl) {
    var ancestor = el.parentElement;
    while (ancestor && ancestor !== compEl) {
      if (ancestor.hasAttribute('jscomponent')) return false;
      ancestor = ancestor.parentElement;
    }
    return ancestor === compEl;
  }

  /**
   * Hydrate state from server-rendered [jsdata] elements.
   * Reads textContent and coerces to match the type of the existing state value.
   * Skips array keys (handled by hydrateForBindings) and jsfor-scoped elements.
   */
  function hydrateBindings(compEl, state) {
    var keys = Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (Array.isArray(state[key])) continue;
      var els = compEl.querySelectorAll('[jsdata="' + key + '"]');
      for (var j = 0; j < els.length; j++) {
        var el = els[j];
        if (!belongsToComponent(el, compEl)) continue;
        if (el.closest('[jsfor]') && el.closest('[jsfor]') !== compEl) continue;
        var text = el.textContent;
        var type = typeof state[key];
        if (type === 'number') {
          state[key] = parseFloat(text);
        } else if (type === 'boolean') {
          state[key] = text === 'true';
        } else {
          state[key] = text;
        }
        break; // First matching element wins.
      }
    }
  }

  /**
   * Update [jsdata] descendant elements within a component element.
   * Only updates bindings for the specified keys (or all keys if changedKeys is null).
   * Scoped: won't cross into nested jscomponent boundaries.
   * Skips jsdata elements inside jsfor containers (those are managed by updateForBindings).
   */
  function updateBindings(compEl, state, changedKeys) {
    var keys = changedKeys || Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var els = compEl.querySelectorAll('[jsdata="' + key + '"]');
      for (var j = 0; j < els.length; j++) {
        if (!belongsToComponent(els[j], compEl)) continue;
        // Skip jsdata elements that live inside a jsfor container —
        // those are rendered by updateForBindings with item-level scope.
        if (els[j].closest('[jsfor]') && els[j].closest('[jsfor]') !== compEl) continue;
        els[j].textContent = state[key];
      }
    }
  }

  /**
   * On init, find all [jsfor] containers within a component and snapshot
   * their first child element as the repeat template.
   */
  function initForBindings(compEl) {
    var containers = compEl.querySelectorAll('[jsfor]');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      if (!belongsToComponent(container, compEl)) continue;
      var firstChild = container.children[0];
      if (firstChild) {
        forTemplates.set(container, firstChild.cloneNode(true));
      }
    }
  }

  /**
   * Hydrate state from existing [jsfor] children in the DOM.
   * Reads textContent (primitives) or jsdata bindings (objects) from each
   * child element and writes the resulting array into state.
   */
  function hydrateForBindings(compEl, state) {
    var containers = compEl.querySelectorAll('[jsfor]');
    for (var i = 0; i < containers.length; i++) {
      var container = containers[i];
      if (!belongsToComponent(container, compEl)) continue;
      var key = container.getAttribute('jsfor');
      var template = forTemplates.get(container);
      if (!template) continue;

      var children = container.children;
      if (children.length === 0) continue;

      // Detect object mode: template has [jsdata] descendants or root jsdata.
      var isObjectMode = template.hasAttribute('jsdata') ||
                         template.querySelector('[jsdata]') !== null;

      var items = [];
      for (var j = 0; j < children.length; j++) {
        var child = children[j];
        if (isObjectMode) {
          var item = {};
          // Read from root jsdata.
          if (child.hasAttribute('jsdata')) {
            item[child.getAttribute('jsdata')] = child.textContent;
          }
          // Read from descendant jsdata bindings.
          var bindings = child.querySelectorAll('[jsdata]');
          for (var l = 0; l < bindings.length; l++) {
            item[bindings[l].getAttribute('jsdata')] = bindings[l].textContent;
          }
          items.push(item);
        } else {
          items.push(child.textContent);
        }
      }

      state[key] = items;
    }
  }

  /**
   * Re-render [jsfor] containers whose state key is in changedKeys.
   * For each item in the array: clone the template, resolve jsdata bindings
   * against the item (objects) or set textContent on the root (primitives).
   */
  function updateForBindings(compEl, state, changedKeys) {
    var keys = changedKeys || Object.keys(state);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!Array.isArray(state[key])) continue;
      var containers = compEl.querySelectorAll('[jsfor="' + key + '"]');
      for (var j = 0; j < containers.length; j++) {
        var container = containers[j];
        if (!belongsToComponent(container, compEl)) continue;
        var template = forTemplates.get(container);
        if (!template) continue;

        var items = state[key];
        container.innerHTML = '';

        for (var k = 0; k < items.length; k++) {
          var clone = template.cloneNode(true);
          var item = items[k];

          if (item !== null && typeof item === 'object') {
            // Object item: resolve jsdata bindings within the clone.
            var bindings = clone.querySelectorAll('[jsdata]');
            for (var l = 0; l < bindings.length; l++) {
              var bindKey = bindings[l].getAttribute('jsdata');
              if (bindKey in item) {
                bindings[l].textContent = item[bindKey];
              }
            }
            // Also check the clone root itself.
            if (clone.hasAttribute('jsdata')) {
              var rootKey = clone.getAttribute('jsdata');
              if (rootKey in item) {
                clone.textContent = item[rootKey];
              }
            }
          } else {
            // Primitive item: set textContent on clone root.
            clone.textContent = item;
          }

          container.appendChild(clone);
        }
      }
    }
  }

  /**
   * On init, find all [jsif] elements and set up bindings.
   *
   * Two server-rendered forms, both hydrate state from HTML:
   *
   *   Real element  — condition is true:
   *     <p jsif="key">…</p>
   *     A comment marker is inserted before the element as a position anchor.
   *
   *   <template>    — condition is false:
   *     <template jsif="key"><p>…</p></template>
   *     The template itself is the marker; its content element is extracted
   *     and held off-DOM until the condition becomes true.
   */
  function initIfBindings(compEl, state) {
    var bindings = [];
    var els = compEl.querySelectorAll('[jsif]');
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!belongsToComponent(el, compEl)) continue;
      var raw = el.getAttribute('jsif');
      var negated = raw[0] === '!';
      var key = negated ? raw.slice(1) : raw;
      var marker, element, inDom;

      if (el.tagName === 'TEMPLATE') {
        // Condition is false — template is inert, content is off-DOM.
        element = el.content.firstElementChild;
        if (!element) continue; // Skip empty templates.
        marker = el;
        inDom = false;
        state[key] = negated ? true : false;
      } else {
        // Condition is true — element is visible, comment holds its place.
        marker = document.createComment('jsif');
        el.parentNode.insertBefore(marker, el);
        element = el;
        inDom = true;
        state[key] = negated ? false : true;
      }

      bindings.push({ el: element, marker: marker, key: key, negated: negated, inDom: inDom });
    }
    ifBindingsStore.set(compEl, bindings);
  }

  /**
   * For each jsif binding whose key changed, insert or remove the element.
   */
  function updateIfBindings(compEl, state, changedKeys) {
    var bindings = ifBindingsStore.get(compEl);
    if (!bindings) return;
    for (var i = 0; i < bindings.length; i++) {
      var b = bindings[i];
      if (changedKeys && changedKeys.indexOf(b.key) === -1) continue;
      var visible = b.negated ? !state[b.key] : !!state[b.key];
      if (visible && !b.inDom) {
        b.marker.parentNode.insertBefore(b.el, b.marker);
        b.inDom = true;
      } else if (!visible && b.inDom) {
        b.el.parentNode.removeChild(b.el);
        b.inDom = false;
      }
    }
  }

  /**
   * Initialize per-instance state for a component element.
   * Deep-clones def.state, stores it, updates bindings, and calls init().
   */
  function initInstance(compEl, def) {
    if (!def.state) return;
    if (instanceStore.has(compEl)) return; // Already initialized.

    var state = deepClone(def.state);
    instanceStore.set(compEl, { state: state, prev: null });
    initForBindings(compEl);
    hydrateForBindings(compEl, state);
    hydrateBindings(compEl, state);
    initIfBindings(compEl, state);
    updateBindings(compEl, state, null);

    if (typeof def.init === 'function') {
      def.init(compEl, state);
    }
  }

  /**
   * Create a setState closure bound to a specific component element and definition.
   */
  function makeSetState(compEl, def) {
    return function setState(patch) {
      var instance = instanceStore.get(compEl);
      if (!instance) return;

      var prev = {};
      var current = instance.state;
      var keys = Object.keys(current);
      for (var i = 0; i < keys.length; i++) {
        prev[keys[i]] = current[keys[i]];
      }

      // Shallow-merge patch into state.
      var changedKeys = [];
      var patchKeys = Object.keys(patch);
      for (var i = 0; i < patchKeys.length; i++) {
        var k = patchKeys[i];
        if (current[k] !== patch[k]) {
          changedKeys.push(k);
        }
        current[k] = patch[k];
      }

      instance.prev = prev;

      if (changedKeys.length > 0) {
        updateBindings(compEl, current, changedKeys);
        updateForBindings(compEl, current, changedKeys);
        updateIfBindings(compEl, current, changedKeys);
      }

      if (typeof def.update === 'function') {
        def.update(compEl, current, prev);
      }
    };
  }

  /**
   * Tear down a component instance: call its destroy() hook and remove state.
   * Call this before removing a component element from the DOM.
   */
  function destroy(compEl) {
    var instance = instanceStore.get(compEl);
    if (!instance) return;

    var compName = compEl.getAttribute('jscomponent');
    var def = componentRegistry.get(compName);
    if (def && typeof def.destroy === 'function') {
      def.destroy(compEl, instance.state);
    }
    instanceStore.delete(compEl);
  }

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
    var def = componentRegistry.get(compName);
    var remaining = [];
    for (var i = 0; i < eventQueue.length; i++) {
      var entry = eventQueue[i];
      if (entry.compName === compName) {
        if (def && def.actions && def.actions[entry.actionName]) {
          var handler = def.actions[entry.actionName][entry.eventType];
          if (handler) {
            var ctx = null;
            if (def.state) {
              var instance = instanceStore.get(entry.compEl);
              if (instance) {
                ctx = { state: instance.state, setState: makeSetState(entry.compEl, def) };
              }
            }
            if (ctx) {
              handler(entry.event, entry.actionEl, entry.compEl, ctx);
            } else {
              handler(entry.event, entry.actionEl, entry.compEl);
            }
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
                // Build state context if component has state.
                if (def.state) {
                  var instance = instanceStore.get(compEl);
                  if (instance) {
                    handler(event, el, compEl, { state: instance.state, setState: makeSetState(compEl, def) });
                    return;
                  }
                }
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

    // Initialize state for any existing DOM elements with this component name.
    if (def.state) {
      var elements = document.querySelectorAll('[jscomponent="' + name + '"]');
      for (var i = 0; i < elements.length; i++) {
        initInstance(elements[i], def);
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
    register,
    scan,
    // destroy,
  };
})();
