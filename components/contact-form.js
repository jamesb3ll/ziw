Ziw.register('ContactForm', {
  state: { name: '', submitted: false },

  init: function (compEl, state) {
    console.log('ContactForm init', state);
  },
  update: function (compEl, state, prevState) {
    console.log('ContactForm update', state, prevState);
  },

  actions: {
    submit: {
      click: function (event, actionEl, compEl, { state, setState }) {
        if (!state.name.trim()) return;
        setState({ submitted: true });
      }
    }
  }
});
