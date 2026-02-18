Ziw.register('Counter', {
  actions: {
    increment: {
      click: function (event, actionEl, componentEl) {
        var display = componentEl.querySelector('[data-count]');
        var count = parseInt(display.textContent, 10) + 1;
        display.textContent = count;
      }
    },
    decrement: {
      click: function (event, actionEl, componentEl) {
        var display = componentEl.querySelector('[data-count]');
        var count = parseInt(display.textContent, 10) - 1;
        display.textContent = count;
      }
    }
  }
});
