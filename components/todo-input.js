Ziw.register('TodoInput', {
  actions: {
    addTodo: {
      click: function (event, actionEl, componentEl) {
        addItem(componentEl);
      },
      keydown: function (event, actionEl, componentEl) {
        if (event.key === 'Enter') {
          addItem(componentEl);
        }
      }
    }
  }
});

function addItem(componentEl) {
  var input = componentEl.querySelector('input');
  var text = input.value.trim();
  if (!text) return;
  var li = document.createElement('li');
  li.textContent = text;
  componentEl.querySelector('ul').appendChild(li);
  input.value = '';
}
