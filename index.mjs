import stylelint from 'stylelint';
import fs, { promises } from 'fs';
import path from 'path';
import postcss from 'postcss';
import { parse } from 'postcss-values-parser';

var ruleName = 'csstools/value-no-unknown-custom-properties';

var messages = stylelint.utils.ruleMessages(ruleName, {
  earlyReference: (name, prop) => `Custom property "${name}" referenced too early (inside declaration "${prop}").`,
  unexpected: (name, prop) => `Unexpected custom property "${name}" inside declaration "${prop}".`
});

var validateDecl = ((decl, {
  result,
  customProperties,
  rejectBadPrefallbacks
}) => {
  const valueAST = parse(decl.value);
  validateValueAST(valueAST, {
    result,
    customProperties,
    decl,
    rejectBadPrefallbacks
  });
}); // validate a value ast

const validateValueAST = (ast, {
  result,
  customProperties,
  decl,
  rejectBadPrefallbacks
}) => {
  if (Object(ast.nodes).length) {
    ast.nodes.forEach(node => {
      if (isVarFunction(node)) {
        const [propertyNode,,
        /* comma */
        ...fallbacks] = node.nodes;
        const propertyName = propertyNode.value;

        if (propertyName in customProperties) {
          return;
        } // conditionally test fallbacks


        if (fallbacks.length) {
          validateValueAST({
            nodes: fallbacks.filter(isVarFunction)
          }, {
            result,
            customProperties,
            decl,
            rejectBadPrefallbacks
          });

          if (!rejectBadPrefallbacks) {
            return;
          }
        } // report unknown custom properties


        stylelint.utils.report({
          message: messages.unexpected(propertyName, decl.prop),
          node: decl,
          result,
          ruleName,
          word: String(propertyName)
        });
      } else {
        validateValueAST(node, {
          result,
          customProperties,
          decl,
          rejectBadPrefallbacks
        });
      }
    });
  }
}; // whether the node is a var() function


const isVarFunction = node => node.type === 'func' && node.name === 'var' && node.nodes[0].isVariable;

var validateResult = ((result, customProperties, rejectBadPrefallbacks) => {
  // validate each declaration
  result.root.walkDecls(decl => {
    if (hasCustomPropertyReference(decl)) {
      validateDecl(decl, {
        result,
        customProperties,
        rejectBadPrefallbacks
      });
    }
  });
}); // match custom property inclusions

const customPropertyReferenceRegExp = /(^|[^\w-])var\([\W\w]+\)/; // whether a declaration references a custom property

const hasCustomPropertyReference = decl => customPropertyReferenceRegExp.test(decl.value);

async function getCustomPropertiesFromRoot(root, result, priorCustomPropertyReferences) {
  // initialize custom selectors
  let customProperties = {}; // resolve current file directory

  let sourceDir = __dirname;

  if (root.source && root.source.input && root.source.input.file) {
    sourceDir = path.dirname(root.source.input.file);
  } // recursively add custom properties from @import statements


  const importPromises = [];
  root.walkAtRules('import', atRule => {
    const fileName = atRule.params.replace(/['|"]/g, '');
    const resolvedFileName = path.resolve(sourceDir, fileName);
    importPromises.push(getCustomPropertiesFromCSSFile(resolvedFileName, result, priorCustomPropertyReferences));
  });
  (await Promise.all(importPromises)).forEach(propertiesFromImport => {
    customProperties = Object.assign(customProperties, propertiesFromImport);
  });

  function checkAST(ast, decl) {
    if (Object(ast.nodes).length) {
      ast.nodes.forEach(node => {
        if (isVarFunction(node)) {
          const [propertyNode,,
          /* comma */
          ...fallbacks] = node.nodes;
          const propertyName = propertyNode.value;
          priorCustomPropertyReferences.set(propertyName, decl);

          if (fallbacks.length) {
            checkAST({
              nodes: fallbacks.filter(isVarFunction)
            }, decl);
          }
        } else {
          checkAST(node, decl);
        }
      });
    }
  } // for each custom property declaration


  root.walkDecls(decl => {
    // Add any uses to collection along the way
    if (priorCustomPropertyReferences && hasCustomPropertyReference(decl)) {
      const ast = parse(decl.value);
      checkAST(ast, decl);
    }

    const {
      prop
    } = decl;

    if (!customPropertyRegExp.test(prop)) {
      return;
    } // Discard uses if not found by time of declaration


    if (priorCustomPropertyReferences && priorCustomPropertyReferences.has(prop)) {
      const dec = priorCustomPropertyReferences.get(prop);
      stylelint.utils.report({
        message: messages.earlyReference(prop, dec.prop),
        node: dec,
        result,
        ruleName,
        word: String(prop)
      });
      priorCustomPropertyReferences.delete(prop);
    } // write the parsed value to the custom property


    customProperties[prop] = decl.value;
  }); // return all custom properties, preferring :root properties over html properties

  return customProperties;
} // match custom properties

const customPropertyRegExp = /^--[A-z][\w-]*$/;

async function getCustomPropertiesFromCSSFile(from, result, priorCustomPropertyReferences) {
  try {
    const css = await promises.readFile(from, 'utf8');
    const root = postcss.parse(css, {
      from
    });
    return await getCustomPropertiesFromRoot(root, result, priorCustomPropertyReferences);
  } catch (e) {
    return {};
  }
}

/* Get Custom Properties from CSS File
/* ========================================================================== */

async function getCustomPropertiesFromCSSFile$1(from, result, map) {
  const css = await readFile(from);
  const root = postcss.parse(css, {
    from
  });
  return await getCustomPropertiesFromRoot(root, result, map);
}
/* Get Custom Properties from Object
/* ========================================================================== */


function getCustomPropertiesFromObject(object) {
  const customProperties = Object.assign({}, Object(object).customProperties, Object(object)['custom-properties']);
  return customProperties;
}
/* Get Custom Properties from JSON file
/* ========================================================================== */


async function getCustomPropertiesFromJSONFile(from) {
  const object = await readJSON(from);
  return getCustomPropertiesFromObject(object);
}
/* Get Custom Properties from JS file
/* ========================================================================== */


async function getCustomPropertiesFromJSFile(from) {
  const object = await import(from);
  return getCustomPropertiesFromObject(object);
}
/* Get Custom Properties from Sources
/* ========================================================================== */


function getCustomPropertiesFromSources(sources, {
  priorCustomPropertyReferences,
  result
}) {
  return sources.map(source => {
    if (source instanceof Promise) {
      return source;
    } else if (source instanceof Function) {
      return source();
    } // read the source as an object


    const opts = source === Object(source) ? source : {
      from: String(source)
    }; // skip objects with Custom Properties

    if (opts.customProperties || opts['custom-properties']) {
      return opts;
    } // source pathname


    const from = path.resolve(String(opts.from || '')); // type of file being read from

    const type = (opts.type || path.extname(from).slice(1)).toLowerCase();
    return {
      type,
      from
    };
  }).reduce(async (customProperties, source) => {
    const {
      type,
      from
    } = await source;

    if (type === 'css') {
      return Object.assign(await customProperties, await getCustomPropertiesFromCSSFile$1(from, result, priorCustomPropertyReferences));
    }

    if (type === 'js') {
      return Object.assign(await customProperties, await getCustomPropertiesFromJSFile(from));
    }

    if (type === 'json') {
      return Object.assign(await customProperties, await getCustomPropertiesFromJSONFile(from));
    }

    return Object.assign(await customProperties, await getCustomPropertiesFromObject(await source));
  }, {});
}
/* Promise-ified utilities
/* ========================================================================== */

const readFile = from => new Promise((resolve, reject) => {
  fs.readFile(from, 'utf8', (error, result) => {
    // With `createRuleTester` removed, may wish to switch to anoher testing
    // framework or tool like https://github.com/csstools/stylelint-tape :
    // https://github.com/stylelint/stylelint/issues/4267
    // istanbul ignore if -- tape testing framework not handling rejections
    if (error) {
      reject(error);
    } else {
      resolve(result);
    }
  });
});

const readJSON = async from => JSON.parse(await readFile(from));

var index = stylelint.createPlugin(ruleName, (method, opts) => {
  // sources to import custom selectors from
  const {
    importFrom = [],
    reportEarlyUses = false,
    rejectBadPrefallbacks = false
  } = Object(opts);
  const imprtFrom = [].concat(importFrom);
  const priorCustomPropertyReferences = reportEarlyUses ? new Map() : null;
  return async (root, result) => {
    // promise any custom selectors are imported
    const customPropertiesPromise = isMethodEnabled(method) ? getCustomPropertiesFromSources(imprtFrom, {
      priorCustomPropertyReferences,
      result
    }) : {}; // validate the method

    const isMethodValid = stylelint.utils.validateOptions(result, ruleName, {
      actual: method,

      possible() {
        return isMethodEnabled(method) || isMethodDisabled(method);
      }

    });

    if (isMethodValid && isMethodEnabled(method)) {
      // all custom properties from the file and imports
      const customProperties = Object.assign(await customPropertiesPromise, await getCustomPropertiesFromRoot(root, result, priorCustomPropertyReferences)); // validate the css root

      validateResult(result, customProperties, rejectBadPrefallbacks);
    }
  };
});

const isMethodEnabled = method => method === true;

const isMethodDisabled = method => method === null || method === false;

export default index;
export { ruleName };
//# sourceMappingURL=index.mjs.map
