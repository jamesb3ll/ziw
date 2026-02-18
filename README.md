# Ziw

HTML-first JavaScript framework. Tiny runtime. JS lazily loaded, only when needed.

## How it works

Write plain HTML with two attributes:

- `jscomponent="Name"` marks an element as a component root
- `jsaction="actionName"` marks an element as triggering a named action

Ziw uses a single capture-phase event listener on `document` to intercept events. When a user interacts with a `jsaction` element, Ziw walks up the DOM to find the nearest `jscomponent` ancestor, looks up the registered handler, and calls it. No virtual DOM, no build step, no rendering pipeline.

```html
<section jscomponent="Counter">
  <button jsaction="decrement">–</button>
  <span data-count>0</span>
  <button jsaction="increment">+</button>
</section>
```

```js
Ziw.register('Counter', {
  actions: {
    increment: {
      click(event, actionEl, componentEl) {
        var display = componentEl.querySelector('[data-count]');
        display.textContent = parseInt(display.textContent, 10) + 1;
      }
    },
    decrement: {
      click(event, actionEl, componentEl) {
        var display = componentEl.querySelector('[data-count]');
        display.textContent = parseInt(display.textContent, 10) - 1;
      }
    }
  }
});
```

## Lazy loading

Zero JS loads until it's needed. Two additional attributes control when component scripts load:

- `jssrc="./path.js"` -- URL of the component's JS file
- `jsload="strategy"` -- when to fetch and execute it

### Load strategies

| Value | Behavior |
|-------|----------|
| `eager` | Load immediately on page scan (default if `jssrc` is present) |
| `interaction` | Load on first user interaction within the component; the triggering event is replayed after the script loads |
| `visible` | Load when the element enters the viewport (IntersectionObserver) |
| `idle` | Load during `requestIdleCallback` (falls back to `setTimeout`) |

```html
<!-- Only ziw.js in a script tag -- components load themselves -->
<script src="ziw.js"></script>

<section jscomponent="Counter" jssrc="./components/counter.js" jsload="interaction">
  <!-- HTML renders instantly. JS loads on first click. -->
</section>
```

Component files just call `Ziw.register()` as a side effect -- no module system or bundler required.

## Action bubbling

Actions bubble through nested components. If `InnerWidget` doesn't handle an action, Ziw walks up to `Outer`:

```html
<section jscomponent="Outer">
  <div jscomponent="InnerWidget">
    <button jsaction="outerClick">Handled by Outer</button>
  </div>
</section>
```

## JS API

### `Ziw.register(name, definition)`

Register a component. `name` must match the `jscomponent` attribute in HTML.

The definition object has an `actions` map. Each action maps event types to handler functions:

```js
Ziw.register('Name', {
  actions: {
    actionName: {
      click(event, actionEl, componentEl) { /* ... */ },
      keydown(event, actionEl, componentEl) { /* ... */ }
    }
  }
});
```

Handler arguments:

- `event` -- the original DOM event
- `actionEl` -- the element with the `jsaction` attribute
- `componentEl` -- the nearest ancestor with `jscomponent`

### `Ziw.scan(root?)`

Re-scan the DOM (or a subtree) for new `[jscomponent][jssrc]` elements. Called automatically on page load. Call it manually after inserting dynamic HTML.

## Running the demo

Any static file server works:

```
npx serve .
```

Open the page and check the Network tab -- only `ziw.js` loads initially. Component scripts load based on their `jsload` strategy.
