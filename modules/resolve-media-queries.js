

var ExecutionEnvironment = require('exenv');

var _matchMedia = ExecutionEnvironment.canUseDOM &&
  window &&
  window.matchMedia &&
  (mediaQueryString => window.matchMedia(mediaQueryString));

var mediaQueryListByQueryString = {};

var _onMediaQueryChange = function (component, util, query, mediaQueryList) {
  var state = {};
  state[query] = mediaQueryList.matches;
  util.setStyleState(component, '_all', state);
};

var resolveMediaQueries = function ({component, style, config, util}) {
  var newStyle = style;
  var matchMedia = config.matchMedia || _matchMedia;
  if (!matchMedia) {
    return newStyle;
  }

  Object.keys(style)
  .filter(function (name) { return name.indexOf('@media') === 0; })
  .map(function (query) {
    var mediaQueryStyles = style[query];
    query = query.replace('@media ', '');

    // Create a global MediaQueryList if one doesn't already exist
    var mql = mediaQueryListByQueryString[query];
    if (!mql) {
      mediaQueryListByQueryString[query] = mql = matchMedia(query);
    }

    // Keep track of which keys already have listeners
    if (!component._radiumMediaQueryListenersByQuery) {
      component._radiumMediaQueryListenersByQuery = {};
    }

    if (!component._radiumMediaQueryListenersByQuery[query]) {
      var listener = _onMediaQueryChange.bind(null, component, util, query);
      mql.addListener(listener);
      component._radiumMediaQueryListenersByQuery[query] = {
        remove() { mql.removeListener(listener); }
      };
    }

    // Apply media query states
    if (mql.matches) {
      newStyle = util.mergeStyles([newStyle, mediaQueryStyles]);
    }
  });

  // Remove media queries
  newStyle = Object.keys(newStyle).reduce(
    (styleWithoutMedia, key) => {
      if (key.indexOf('@media') !== 0) {
        styleWithoutMedia[key] = newStyle[key];
      }
      return styleWithoutMedia;
    },
    {}
  );

  return {
    style: newStyle
  };
};

// Exposing methods for tests is ugly, but the alternative, re-requiring the
// module each time, is too slow
resolveMediaQueries.__clearStateForTests = function () {
  mediaQueryListByQueryString = {};
};

module.exports = resolveMediaQueries;
