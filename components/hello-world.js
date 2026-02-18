Ziw.register('HelloWorld', {
  actions: {
    wrapper: {
      mouseover: function (event, actionEl, componentEl) {
        console.log('HelloWorld wrapper mouseover');
      }
    },
    greet: {
      click: function (event, actionEl, componentEl) {
        window.alert('Hello from Ziw!');
      }
    }
  }
});
