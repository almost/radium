/* @flow */

var Prefixer = require('./prefixer');
var checkProps = require('./check-props');
var getState = require('./get-state');
var getStateKey = require('./get-state-key');
var mergeStyles = require('./merge-styles');
var resolveInteractionStyles = require('./resolve-interaction-styles');
var resolveMediaQueries = require('./resolve-media-queries');

var ExecutionEnvironment = require('exenv');
var React = require('react');

// babel-eslint 3.1.7 fails here for some reason, error:
//   0:0  error  Cannot call method 'isSequenceExpression' of undefined
//
// declare class RadiumComponent extends ReactComponent {
//   _lastMouseDown: number,
//   _radiumMediaQueryListenersByQuery: Object<string, {remove: () => void}>,
//   _radiumMouseUpListener: {remove: () => void},
// }

var _setStyleState = function (component, key, stateKey, value) {
  var existing = component._lastRadiumState ||
    component.state && component.state._radiumStyleState || {};

  var state = { _radiumStyleState: {...existing} };
  state._radiumStyleState[key] = {...state._radiumStyleState[key]};
  state._radiumStyleState[key][stateKey] = value;

  component._lastRadiumState = state._radiumStyleState;
  component.setState(state);
};

// Wrapper around React.cloneElement. To avoid processing the same element
// twice, whenever we clone an element add a special non-enumerable prop to
// make sure we don't process this element again.
var _cloneElement = function (renderedElement, newProps, newChildren) {
  var clone = React.cloneElement(
    renderedElement,
    {
      ...newProps,
      _radiumDidResolveStyles: true
    },
    newChildren
  );

  return clone;
};

//
// The nucleus of Radium. resolveStyles is called on the rendered elements
// before they are returned in render. It iterates over the elements and
// children, rewriting props to add event handlers required to capture user
// interactions (e.g. mouse over). It also replaces the style prop because it
// adds in the various interaction styles (e.g. :hover).
//
var resolveStyles = function (
  component: any, // ReactComponent, flow+eslint complaining
  renderedElement: any, // ReactElement
  config: Object = {},
  existingKeyMap?: {[key: string]: bool}
): any { // ReactElement
  existingKeyMap = existingKeyMap || {};

  if (
    !renderedElement ||
    // Bail if we've already processed this element. This ensures that only the
    // owner of an element processes that element, since the owner's render
    // function will be called first (which will always be the case, since you
    // can't know what else to render until you render the parent component).
    (renderedElement.props && renderedElement.props._radiumDidResolveStyles)
  ) {
    return renderedElement;
  }

  // Recurse over children first in case we bail early. Note that children only
  // include those rendered in `this` component. Child nodes in other components
  // will not be here, so each component needs to use Radium.
  var oldChildren = renderedElement.props.children;
  var newChildren = oldChildren;
  if (oldChildren) {
    var childrenType = typeof oldChildren;
    if (childrenType === 'string' || childrenType === 'number') {
      // Don't do anything with a single primitive child
      newChildren = oldChildren;
    } else if (childrenType === 'function') {
      // Wrap the function, resolving styles on the result
      newChildren = function () {
        var result = oldChildren.apply(this, arguments);
        if (React.isValidElement(result)) {
          return resolveStyles(component, result, config, existingKeyMap);
        }
        return result;
      };
    } else if (React.Children.count(oldChildren) === 1 && oldChildren.type) {
      // If a React Element is an only child, don't wrap it in an array for
      // React.Children.map() for React.Children.only() compatibility.
      var onlyChild = React.Children.only(oldChildren);
      newChildren = resolveStyles(component, onlyChild, config, existingKeyMap);
    } else {
      newChildren = React.Children.map(
        oldChildren,
        function (child) {
          if (React.isValidElement(child)) {
            return resolveStyles(component, child, config, existingKeyMap);
          }

          return child;
        }
      );
    }
  }

  var props = renderedElement.props;
  var newProps = {};

  // Recurse over props, just like children
  Object.keys(props).forEach(prop => {
    // We already recurse over children above
    if (prop === 'children') {
      return;
    }

    var propValue = props[prop];
    if (React.isValidElement(propValue)) {
      newProps[prop] = resolveStyles(
        component,
        propValue,
        config,
        existingKeyMap
      );
    }
  });

  var hasResolvedProps = Object.keys(newProps).length > 0;

  // Bail early if element is not a simple ReactDOMElement.
  if (
    !React.isValidElement(renderedElement) ||
    typeof renderedElement.type !== 'string'
  ) {
    if (oldChildren === newChildren && !hasResolvedProps) {
      return renderedElement;
    }

    return _cloneElement(
      renderedElement,
      hasResolvedProps ? newProps : {},
      newChildren
    );
  }

  var style = props.style;

  // Convenient syntax for multiple styles: `style={[style1, style2, etc]}`
  // Ignores non-objects, so you can do `this.state.isCool && styles.cool`.
  if (Array.isArray(style)) {
    style = mergeStyles(style);
  }

  checkProps(component, style);

  // Bail early if no style.
  if (!style) {
    if (newChildren || hasResolvedProps) {
      return _cloneElement(renderedElement, newProps, newChildren);
    }

    return renderedElement;
  }

  // We need a unique key to correlate state changes due to user interaction
  // with the rendered element, so we know to apply the proper interactive
  // styles.
  var originalKey = renderedElement.ref || renderedElement.key;
  var key = getStateKey(originalKey);

  var alreadyGotKey = false;
  var getKey = function () {
    if (alreadyGotKey) {
      return key;
    }

    alreadyGotKey = true;

    if (existingKeyMap[key]) {
      throw new Error(
        'Radium requires each element with interactive styles to have a unique ' +
        'key, set using either the ref or key prop. ' +
        (originalKey ?
          'Key "' + originalKey + '" is a duplicate.' :
          'Multiple elements have no key specified.')
      );
    }

    existingKeyMap[key] = true;

    return key;
  };

  var prefix = function ({component, style}) {
    var newStyle = Prefixer.getPrefixedStyle(component, style);
    return {style: newStyle};
  };

  var plugins = [resolveMediaQueries, resolveInteractionStyles, prefix];

  var currentStyle = style;
  plugins.forEach(plugin => {
    var result = plugin({
      ExecutionEnvironment,
      component,
      config,
      getState: stateKey => getState(component.state, getKey(), stateKey),
      mergeStyles,
      props,
      setState: (stateKey, value, elementKey) =>
        _setStyleState(component, elementKey || getKey(), stateKey, value),
      style: currentStyle
    });

    currentStyle = result.style;

    newProps = {...newProps, ...result.props};

    if (result.componentFields) {
      Object.keys(result.componentFields).forEach(newComponentFieldName => {
        component[newComponentFieldName] =
          result.componentFields[newComponentFieldName];
      });
    }
  });

  checkProps(component, currentStyle);

  newProps.style = currentStyle;

  return _cloneElement(renderedElement, newProps, newChildren);
};

module.exports = resolveStyles;
