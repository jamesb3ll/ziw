# Ziw

HTML-first JavaScript framework. Tiny runtime. JS lazily loaded, only when needed.

## How it works

Write plain HTML with two attributes:

- `jscomponent="Name"` marks an element as a component root
- `jsaction="actionName"` marks an element as triggering a named action

Ziw uses a single capture-phase event listener on `document` to intercept events. When a user interacts with a `jsaction` element, Ziw walks up the DOM to find the nearest `jscomponent` ancestor, looks up the registered handler, and calls it. No virtual DOM, no build step, no rendering pipeline.

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
  <button jsaction="decrement">–</button>
  <span jsdata="count">0</span>
  <button jsaction="increment">+</button>
</section>

<!-- Or eagerly load:
 <script src="/components/counter.js""></script>
 <section jscomponent="Counter">
 -->
```

Component files just call `Ziw.register()` as a side effect -- no module system or bundler required.

## State

Components can declare initial state. Handlers receive `{ state, setState }` as a fourth argument. Calling `setState` shallow-merges a patch and updates all bindings.

```js
Ziw.register('Counter', {
  state: { count: 0 },
  actions: {
    increment: {
      click(event, actionEl, compEl, { state, setState }) {
        setState({ count: state.count + 1 });
      }
    },
    decrement: {
      click(event, actionEl, compEl, { state, setState }) {
        setState({ count: state.count - 1 });
      }
    }
  }
});
```

State is stored per element instance via a `WeakMap`, so multiple instances of the same component on the same page each have independent state.

Components without `state` work exactly as before — the fourth argument is only passed when `state` is defined.

### Lifecycle hooks

All hooks are optional.

```js
Ziw.register('Name', {
  state: { /* ... */ },

  init(compEl, state) { },            // Called once when the component activates
  update(compEl, state, prev) { },    // Called after every setState

  actions: { /* ... */ }
});
```

## HTML bindings

### `jsdata="key"`

Binds an element's `textContent` to a state key. Updated automatically on `setState`.

```html
<section jscomponent="Counter" jssrc="./components/counter.js" jsload="interaction">
  <button jsaction="decrement">–</button>
  <span jsdata="count">0</span>
  <button jsaction="increment">+</button>
</section>
```

The content in the HTML (`0` above) is the server-rendered initial value, visible before JS loads. Once the component activates, the binding takes over.

### `jsfor="key"`

Repeats an element's first child for each item in a state array. The first child acts as the template.

```html
<ul jsfor="items">
  <li>An existing item</li>
</ul>
```

**Hydration:** if the server renders children into the `jsfor` container, Ziw reads them to populate the initial state — HTML is the source of truth. For object arrays, use `jsdata` bindings inside the template:

```html
<ul jsfor="todos">
  <li><span jsdata="text">Buy milk</span> &mdash; <span jsdata="date">Mon</span></li>
</ul>
```

State shape: `{ todos: [{ text: 'Buy milk', date: 'Mon' }] }`

### `jsif="key"`

Removes an element from the DOM when the state key is falsy, re-inserts it when truthy. Prefix with `!` to invert.

The server determines the initial visibility by which HTML form it renders:

**Condition starts true** — render the real element:
```html
<p jsif="loggedIn">Welcome back!</p>
```

**Condition starts false** — wrap in `<template>`:
```html
<template jsif="loggedIn"><p>Welcome back!</p></template>
```

Both forms hydrate state from the HTML — no flash of incorrect content in either case. `!` negation works on both:

```html
<p jsif="loggedIn">Welcome back!</p>
<template jsif="!loggedIn"><p>Please log in.</p></template>
```

### `jsattr-foo="key"`

Sets an element attribute from a state key. Use any attribute name after the `jsattr-` prefix.

```html
<button jsattr-disabled="isLoading">Submit</button>
<img jsattr-src="avatarUrl" jsattr-alt="avatarAlt">
```

- `false`, `null`, or `undefined` → attribute is removed
- `true` → attribute is set with no value (correct for boolean attributes like `disabled`)
- Any other value → attribute is set to `String(value)`

**Hydration:** attribute bindings are output-only. Use `jsdata` or `jsbind` if you need to read a value from the HTML into state.

### `jsbind="key"`

Two-way binding for `<input>`, `<select>`, and `<textarea>`. Syncs the element's value to state on `input`/`change` events, and updates the element when state changes programmatically.

```html
<input type="text" jsbind="username">
<input type="checkbox" jsbind="agreed">
<select jsbind="country">
  <option value="us">United States</option>
  <option value="ca">Canada</option>
</select>
```

Checkboxes and radios use `el.checked`; everything else uses `el.value`.

**Hydration:** on init, Ziw reads the element's current value into state — the server-rendered value is the source of truth.

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

```js
Ziw.register('Name', {
  state: { key: value },

  init(compEl, state) { },
  update(compEl, state, prev) { },

  actions: {
    actionName: {
      click(event, actionEl, compEl, { state, setState }) { },
      keydown(event, actionEl, compEl, { state, setState }) { }
    }
  }
});
```

### `Ziw.scan(root?)`

Re-scan the DOM (or a subtree) for new `[jscomponent][jssrc]` elements. Called automatically on page load. Call it manually after inserting dynamic HTML.

### `Ziw.destroy(compEl)`

Tear down a component instance before removing its element from the DOM. Calls the `destroy` lifecycle hook and cleans up internal state.

```js
Ziw.destroy(el);
```

## Running the demo

Any static file server works:

```
npx serve .
```

Open the page and check the Network tab -- only `ziw.js` loads initially. Component scripts load based on their `jsload` strategy.
