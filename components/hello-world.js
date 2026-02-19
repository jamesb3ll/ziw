Ziw.register('HelloWorld', {
  state: { showHelloWorld: false },
  init: function (compEl, state) {
    console.log('HelloWorld init', state);
  },
  update: function (compEl, state, prevState) {
    console.log('HelloWorld update', state, prevState);
  },
  actions: {
    greet: {
      click: function (event, actionEl, componentEl, { state, setState }) {
        setState({ showHelloWorld: !state.showHelloWorld });
      }
    }
  }
});
