Ziw.register('TodoInput', {
  state: { items: [] },

  actions: {
    addTodo: {
      click: function (event, actionEl, compEl, { state, setState }) {
        addItem(compEl, state, setState);
      },
      keydown: function (event, actionEl, compEl, { state, setState }) {
        if (event.key === 'Enter') {
          addItem(compEl, state, setState);
        }
      }
    }
  }
});

function addItem(compEl, state, setState) {
  var input = compEl.querySelector('input');
  var text = input.value.trim();
  if (!text) return;
  setState({ items: state.items.concat(text) });
  input.value = '';
}
