Ziw.register('Outer', {
  actions: {
    outerClick: {
      click: function (event, actionEl, componentEl) {
        componentEl.querySelector('[data-outer-status]').textContent =
          'Outer handled outerClick!';
      }
    }
  }
});

Ziw.register('InnerWidget', {
  actions: {
    innerClick: {
      click: function (event, actionEl, componentEl) {
        componentEl.querySelector('[data-inner-status]').textContent =
          'InnerWidget handled innerClick!';
      }
    }
  }
});
