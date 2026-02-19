Ziw.register('Counter', {
  state: { count: 0 },
  actions: {
    increment: {
      click: function (event, actionEl, compEl, { state, setState }) {
        setState({ count: state.count + 1 });
      }
    },
    decrement: {
      click: function (event, actionEl, compEl, { state, setState }) {
        setState({ count: state.count - 1 });
      }
    }
  }
});
