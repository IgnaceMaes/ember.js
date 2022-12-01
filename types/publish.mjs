#!/usr/bin/env node
// @ts-check

/**
  This script is used to publish Ember's type definitions. The basic workflow
  is:

  1. Run `tsc` against the Ember packages which make up its public API, with
     the output being `/types/stable`.

  2. Wrap each emitted module in a `declare module` statement. While doing so,
     keep track of the full list of emitted modules.

  3. Check that each module emitted is included in `types/stable/index.d.ts`,
     if and only if it also appears in a list of stable types modules defined
     in this script, so that they all "show up" to end users. That list will
     eventually be the list of *all* modules, but this allows us to publish
     iteratively as we gain confidence in the stability of the types.

  This is *not* an optimal long-term publishing strategy. We would prefer to
  generate per-package roll-ups, using a Rollup plugin or some such, but we are
  currently blocked on a number of internal circular dependencies as well as
  the difficulty of avoiding multiple definitions of the same types reused
  across many rollups.

  @packageDocumentation
 */

import glob from 'glob';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import MagicString from 'magic-string';

/**
  Modules we know we are not ready to expose yet, mostly because they do not
  have enough annotations on their internals to make the generated types clear
  about what is public and what is private.

  Notably, the modules will still be published, but they won't be visible to
  consumers because the only way they *become* visible is by being included in
  the set of type-only side effect imports, which excludes exactly these
  modules.
 */
const PREVIEW_MODULES = [
  '@ember/-internals/bootstrap/index.d.ts',
  '@ember/-internals/browser-environment/index.d.ts',
  '@ember/-internals/browser-environment/lib/has-dom.d.ts',
  '@ember/-internals/container/index.d.ts',
  '@ember/-internals/container/lib/container.d.ts',
  '@ember/-internals/container/lib/registry.d.ts',
  '@ember/-internals/environment/index.d.ts',
  '@ember/-internals/environment/lib/context.d.ts',
  '@ember/-internals/environment/lib/env.d.ts',
  '@ember/-internals/environment/lib/global.d.ts',
  '@ember/-internals/error-handling/index.d.ts',
  '@ember/-internals/glimmer/index.d.ts',
  '@ember/-internals/glimmer/lib/component-managers/curly.d.ts',
  '@ember/-internals/glimmer/lib/component-managers/mount.d.ts',
  '@ember/-internals/glimmer/lib/component-managers/outlet.d.ts',
  '@ember/-internals/glimmer/lib/component-managers/root.d.ts',
  '@ember/-internals/glimmer/lib/component.d.ts',
  '@ember/-internals/glimmer/lib/components/abstract-input.d.ts',
  '@ember/-internals/glimmer/lib/components/input.d.ts',
  '@ember/-internals/glimmer/lib/components/internal.d.ts',
  '@ember/-internals/glimmer/lib/components/link-to.d.ts',
  '@ember/-internals/glimmer/lib/components/textarea.d.ts',
  '@ember/-internals/glimmer/lib/dom.d.ts',
  '@ember/-internals/glimmer/lib/environment.d.ts',
  '@ember/-internals/glimmer/lib/glimmer-component-docs.d.ts',
  '@ember/-internals/glimmer/lib/glimmer-tracking-docs.d.ts',
  '@ember/-internals/glimmer/lib/helper.d.ts',
  '@ember/-internals/glimmer/lib/helpers/-disallow-dynamic-resolution.d.ts',
  '@ember/-internals/glimmer/lib/helpers/-in-element-null-check.d.ts',
  '@ember/-internals/glimmer/lib/helpers/-normalize-class.d.ts',
  '@ember/-internals/glimmer/lib/helpers/-resolve.d.ts',
  '@ember/-internals/glimmer/lib/helpers/-track-array.d.ts',
  '@ember/-internals/glimmer/lib/helpers/action.d.ts',
  '@ember/-internals/glimmer/lib/helpers/array.d.ts',
  '@ember/-internals/glimmer/lib/helpers/component.d.ts',
  '@ember/-internals/glimmer/lib/helpers/concat.d.ts',
  '@ember/-internals/glimmer/lib/helpers/each-in.d.ts',
  '@ember/-internals/glimmer/lib/helpers/fn.d.ts',
  '@ember/-internals/glimmer/lib/helpers/get.d.ts',
  '@ember/-internals/glimmer/lib/helpers/hash.d.ts',
  '@ember/-internals/glimmer/lib/helpers/helper.d.ts',
  '@ember/-internals/glimmer/lib/helpers/if-unless.d.ts',
  '@ember/-internals/glimmer/lib/helpers/internal-helper.d.ts',
  '@ember/-internals/glimmer/lib/helpers/log.d.ts',
  '@ember/-internals/glimmer/lib/helpers/modifier.d.ts',
  '@ember/-internals/glimmer/lib/helpers/mut.d.ts',
  '@ember/-internals/glimmer/lib/helpers/page-title.d.ts',
  '@ember/-internals/glimmer/lib/helpers/readonly.d.ts',
  '@ember/-internals/glimmer/lib/helpers/unbound.d.ts',
  '@ember/-internals/glimmer/lib/helpers/unique-id.d.ts',
  '@ember/-internals/glimmer/lib/modifiers/action.d.ts',
  '@ember/-internals/glimmer/lib/modifiers/internal.d.ts',
  '@ember/-internals/glimmer/lib/modifiers/on.d.ts',
  '@ember/-internals/glimmer/lib/renderer.d.ts',
  '@ember/-internals/glimmer/lib/resolver.d.ts',
  '@ember/-internals/glimmer/lib/setup-registry.d.ts',
  '@ember/-internals/glimmer/lib/syntax/in-element.d.ts',
  '@ember/-internals/glimmer/lib/syntax/let.d.ts',
  '@ember/-internals/glimmer/lib/syntax/mount.d.ts',
  '@ember/-internals/glimmer/lib/syntax/outlet.d.ts',
  '@ember/-internals/glimmer/lib/syntax/utils.d.ts',
  '@ember/-internals/glimmer/lib/template_registry.d.ts',
  '@ember/-internals/glimmer/lib/template.d.ts',
  '@ember/-internals/glimmer/lib/utils/bindings.d.ts',
  '@ember/-internals/glimmer/lib/utils/curly-component-state-bucket.d.ts',
  '@ember/-internals/glimmer/lib/utils/debug-render-message.d.ts',
  '@ember/-internals/glimmer/lib/utils/iterator.d.ts',
  '@ember/-internals/glimmer/lib/utils/managers.d.ts',
  '@ember/-internals/glimmer/lib/utils/outlet.d.ts',
  '@ember/-internals/glimmer/lib/utils/process-args.d.ts',
  '@ember/-internals/glimmer/lib/utils/serialization-first-node-helpers.d.ts',
  '@ember/-internals/glimmer/lib/utils/string.d.ts',
  '@ember/-internals/glimmer/lib/utils/to-bool.d.ts',
  '@ember/-internals/glimmer/lib/views/outlet.d.ts',
  '@ember/-internals/meta/index.d.ts',
  '@ember/-internals/meta/lib/meta.d.ts',
  '@ember/-internals/metal/index.d.ts',
  '@ember/-internals/metal/lib/alias.d.ts',
  '@ember/-internals/metal/lib/array_events.d.ts',
  '@ember/-internals/metal/lib/array.d.ts',
  '@ember/-internals/metal/lib/cache.d.ts',
  '@ember/-internals/metal/lib/cached.d.ts',
  '@ember/-internals/metal/lib/chain-tags.d.ts',
  '@ember/-internals/metal/lib/change_event.d.ts',
  '@ember/-internals/metal/lib/computed_cache.d.ts',
  '@ember/-internals/metal/lib/computed.d.ts',
  '@ember/-internals/metal/lib/decorator.d.ts',
  '@ember/-internals/metal/lib/dependent_keys.d.ts',
  '@ember/-internals/metal/lib/deprecate_property.d.ts',
  '@ember/-internals/metal/lib/each_proxy_events.d.ts',
  '@ember/-internals/metal/lib/events.d.ts',
  '@ember/-internals/metal/lib/expand_properties.d.ts',
  '@ember/-internals/metal/lib/get_properties.d.ts',
  '@ember/-internals/metal/lib/injected_property.d.ts',
  '@ember/-internals/metal/lib/libraries.d.ts',
  '@ember/-internals/metal/lib/namespace_search.d.ts',
  '@ember/-internals/metal/lib/observer.d.ts',
  '@ember/-internals/metal/lib/path_cache.d.ts',
  '@ember/-internals/metal/lib/properties.d.ts',
  '@ember/-internals/metal/lib/property_events.d.ts',
  '@ember/-internals/metal/lib/property_get.d.ts',
  '@ember/-internals/metal/lib/property_set.d.ts',
  '@ember/-internals/metal/lib/set_properties.d.ts',
  '@ember/-internals/metal/lib/tags.d.ts',
  '@ember/-internals/metal/lib/tracked.d.ts',
  '@ember/-internals/overrides/index.d.ts',
  '@ember/-internals/routing/index.d.ts',
  '@ember/-internals/runtime/index.d.ts',
  '@ember/-internals/runtime/lib/ext/rsvp.d.ts',
  '@ember/-internals/runtime/lib/mixins/-proxy.d.ts',
  '@ember/-internals/runtime/lib/mixins/action_handler.d.ts',
  '@ember/-internals/runtime/lib/mixins/comparable.d.ts',
  '@ember/-internals/runtime/lib/mixins/container_proxy.d.ts',
  '@ember/-internals/runtime/lib/mixins/registry_proxy.d.ts',
  '@ember/-internals/runtime/lib/mixins/target_action_support.d.ts',
  '@ember/-internals/utils/index.d.ts',
  '@ember/-internals/utils/lib/cache.d.ts',
  '@ember/-internals/utils/lib/dictionary.d.ts',
  '@ember/-internals/utils/lib/ember-array.d.ts',
  '@ember/-internals/utils/lib/get-debug-name.d.ts',
  '@ember/-internals/utils/lib/guid.d.ts',
  '@ember/-internals/utils/lib/inspect.d.ts',
  '@ember/-internals/utils/lib/intern.d.ts',
  '@ember/-internals/utils/lib/invoke.d.ts',
  '@ember/-internals/utils/lib/is_proxy.d.ts',
  '@ember/-internals/utils/lib/lookup-descriptor.d.ts',
  '@ember/-internals/utils/lib/make-array.d.ts',
  '@ember/-internals/utils/lib/mandatory-setter.d.ts',
  '@ember/-internals/utils/lib/name.d.ts',
  '@ember/-internals/utils/lib/spec.d.ts',
  '@ember/-internals/utils/lib/super.d.ts',
  '@ember/-internals/utils/lib/symbol.d.ts',
  '@ember/-internals/utils/lib/to-string.d.ts',
  '@ember/-internals/utils/types.d.ts',
  '@ember/-internals/views/index.d.ts',
  '@ember/-internals/views/lib/compat/attrs.d.ts',
  '@ember/-internals/views/lib/compat/fallback-view-registry.d.ts',
  '@ember/-internals/views/lib/component_lookup.d.ts',
  '@ember/-internals/views/lib/mixins/action_support.d.ts',
  '@ember/-internals/views/lib/mixins/child_views_support.d.ts',
  '@ember/-internals/views/lib/mixins/class_names_support.d.ts',
  '@ember/-internals/views/lib/mixins/view_state_support.d.ts',
  '@ember/-internals/views/lib/mixins/view_support.d.ts',
  '@ember/-internals/views/lib/system/action_manager.d.ts',
  '@ember/-internals/views/lib/system/event_dispatcher.d.ts',
  '@ember/-internals/views/lib/system/utils.d.ts',
  '@ember/-internals/views/lib/views/core_view.d.ts',
  '@ember/-internals/views/lib/views/states.d.ts',
  '@ember/-internals/views/lib/views/states/default.d.ts',
  '@ember/-internals/views/lib/views/states/destroying.d.ts',
  '@ember/-internals/views/lib/views/states/has_element.d.ts',
  '@ember/-internals/views/lib/views/states/in_dom.d.ts',
  '@ember/-internals/views/lib/views/states/pre_render.d.ts',
  '@ember/application/index.d.ts',
  '@ember/application/instance.d.ts',
  '@ember/application/lib/lazy_load.d.ts',
  '@ember/application/namespace.d.ts',
  '@ember/array/index.d.ts',
  '@ember/array/mutable.d.ts',
  '@ember/array/proxy.d.ts',
  '@ember/canary-features/index.d.ts',
  '@ember/component/helper.d.ts',
  '@ember/component/index.d.ts',
  '@ember/component/template-only.d.ts',
  '@ember/controller/index.d.ts',
  '@ember/debug/container-debug-adapter.d.ts',
  '@ember/debug/data-adapter.d.ts',
  '@ember/debug/index.d.ts',
  '@ember/debug/lib/capture-render-tree.d.ts',
  '@ember/debug/lib/deprecate.d.ts',
  '@ember/debug/lib/handlers.d.ts',
  '@ember/debug/lib/testing.d.ts',
  '@ember/debug/lib/warn.d.ts',
  '@ember/deprecated-features/index.d.ts',
  '@ember/destroyable/index.d.ts',
  '@ember/engine/index.d.ts',
  '@ember/engine/instance.d.ts',
  '@ember/engine/lib/engine-parent.d.ts',
  '@ember/enumerable/index.d.ts',
  '@ember/enumerable/mutable.d.ts',
  '@ember/error/index.d.ts',
  '@ember/helper/index.d.ts',
  '@ember/instrumentation/index.d.ts',
  '@ember/modifier/index.d.ts',
  '@ember/object/-internals.d.ts',
  '@ember/object/compat.d.ts',
  '@ember/object/computed.d.ts',
  '@ember/object/core.d.ts',
  '@ember/object/evented.d.ts',
  '@ember/object/events.d.ts',
  '@ember/object/index.d.ts',
  '@ember/object/internals.d.ts',
  '@ember/object/lib/computed/computed_macros.d.ts',
  '@ember/object/lib/computed/reduce_computed_macros.d.ts',
  '@ember/object/mixin.d.ts',
  '@ember/object/observable.d.ts',
  '@ember/object/observers.d.ts',
  '@ember/object/promise-proxy-mixin.d.ts',
  '@ember/object/proxy.d.ts',
  '@ember/polyfills/index.d.ts',
  '@ember/polyfills/lib/assign.d.ts',
  '@ember/renderer/index.d.ts',
  '@ember/routing/-internals.d.ts',
  '@ember/routing/auto-location.d.ts',
  '@ember/routing/hash-location.d.ts',
  '@ember/routing/history-location.d.ts',
  '@ember/routing/index.d.ts',
  '@ember/routing/lib/cache.d.ts',
  '@ember/routing/lib/controller_for.d.ts',
  '@ember/routing/lib/dsl.d.ts',
  '@ember/routing/lib/engines.d.ts',
  '@ember/routing/lib/generate_controller.d.ts',
  '@ember/routing/lib/location-utils.d.ts',
  '@ember/routing/lib/query_params.d.ts',
  '@ember/routing/lib/route-info.d.ts',
  '@ember/routing/lib/router_state.d.ts',
  '@ember/routing/lib/routing-service.d.ts',
  '@ember/routing/lib/transition.d.ts',
  '@ember/routing/lib/utils.d.ts',
  '@ember/routing/location.d.ts',
  '@ember/routing/none-location.d.ts',
  '@ember/routing/route-info.d.ts',
  '@ember/routing/route.d.ts',
  '@ember/routing/router-service.d.ts',
  '@ember/routing/router.d.ts',
  '@ember/routing/transition.d.ts',
  '@ember/runloop/index.d.ts',
  '@ember/service/index.d.ts',
  '@ember/string/index.d.ts',
  '@ember/string/lib/string_registry.d.ts',
  '@ember/template-compilation/index.d.ts',
  '@ember/template-factory/index.d.ts',
  '@ember/template/index.d.ts',
  '@ember/test/adapter.d.ts',
  '@ember/test/index.d.ts',
  '@ember/utils/index.d.ts',
  '@ember/utils/lib/compare.d.ts',
  '@ember/utils/lib/is_blank.d.ts',
  '@ember/utils/lib/is_empty.d.ts',
  '@ember/utils/lib/is_none.d.ts',
  '@ember/utils/lib/is_present.d.ts',
  '@ember/utils/lib/is-equal.d.ts',
  '@ember/utils/lib/type-of.d.ts',
  '@ember/version/index.d.ts',
  '@glimmer/tracking/index.d.ts',
  '@glimmer/tracking/primitives/cache.d.ts',
  'ember-template-compiler/index.d.ts',
  'ember-template-compiler/lib/plugins/assert-against-attrs.d.ts',
  'ember-template-compiler/lib/plugins/assert-against-named-outlets.d.ts',
  'ember-template-compiler/lib/plugins/assert-input-helper-without-block.d.ts',
  'ember-template-compiler/lib/plugins/assert-reserved-named-arguments.d.ts',
  'ember-template-compiler/lib/plugins/assert-splattribute-expression.d.ts',
  'ember-template-compiler/lib/plugins/index.d.ts',
  'ember-template-compiler/lib/plugins/transform-action-syntax.d.ts',
  'ember-template-compiler/lib/plugins/transform-each-in-into-each.d.ts',
  'ember-template-compiler/lib/plugins/transform-each-track-array.d.ts',
  'ember-template-compiler/lib/plugins/transform-in-element.d.ts',
  'ember-template-compiler/lib/plugins/transform-quoted-bindings-into-just-bindings.d.ts',
  'ember-template-compiler/lib/plugins/transform-resolutions.d.ts',
  'ember-template-compiler/lib/plugins/transform-wrap-mount-and-outlet.d.ts',
  'ember-template-compiler/lib/plugins/utils.d.ts',
  'ember-template-compiler/lib/system/bootstrap.d.ts',
  'ember-template-compiler/lib/system/calculate-location-display.d.ts',
  'ember-template-compiler/lib/system/compile-options.d.ts',
  'ember-template-compiler/lib/system/compile.d.ts',
  'ember-template-compiler/lib/system/dasherize-component-name.d.ts',
  'ember-template-compiler/lib/system/initializer.d.ts',
  'ember-template-compiler/lib/system/precompile.d.ts',
  'ember-testing/index.d.ts',
  'ember-testing/lib/adapters/adapter.d.ts',
  'ember-testing/lib/adapters/qunit.d.ts',
  'ember-testing/lib/ext/application.d.ts',
  'ember-testing/lib/ext/rsvp.d.ts',
  'ember-testing/lib/helpers.d.ts',
  'ember-testing/lib/helpers/and_then.d.ts',
  'ember-testing/lib/helpers/current_path.d.ts',
  'ember-testing/lib/helpers/current_route_name.d.ts',
  'ember-testing/lib/helpers/current_url.d.ts',
  'ember-testing/lib/helpers/pause_test.d.ts',
  'ember-testing/lib/helpers/visit.d.ts',
  'ember-testing/lib/helpers/wait.d.ts',
  'ember-testing/lib/initializers.d.ts',
  'ember-testing/lib/setup_for_testing.d.ts',
  'ember-testing/lib/test.d.ts',
  'ember-testing/lib/test/adapter.d.ts',
  'ember-testing/lib/test/helpers.d.ts',
  'ember-testing/lib/test/on_inject_helpers.d.ts',
  'ember-testing/lib/test/pending_requests.d.ts',
  'ember-testing/lib/test/promise.d.ts',
  'ember-testing/lib/test/run.d.ts',
  'ember-testing/lib/test/waiters.d.ts',
  'ember/index.d.ts',
];

const MODULES_PLACEHOLDER = '~~~MODULES GO HERE~~~';

const BASE_INDEX_D_TS = `\
/**
  *Provides **stable** type definitions for Ember.js.*

  This module is generated automatically as part of Ember's publishing process and
  should never be edited manually.

  To use these type definitions, add this import to any TypeScript file in your
  Ember app or addon:

  \`\`\`ts
  import 'ember-source/types';
  import 'ember-source/types/preview';
  \`\`\`

  @module
 */

// This works because each of these modules presents \`declare module\` definition
// of the module and *only* that, so importing this file in turn makes those
// module declarations "visible" automatically throughout a consuming project.
// Combined with use of \`typesVersions\` (or, in the future, possibly \`exports\`)
// in \`package.json\`, this allows users to import the types without knowing the
// exact layout details.
//
// Somewhat annoyingly, every single module in the graph must appear here. For
// now, while we are publishing ambient types, that means we must maintain this
// by hand. When we start emitting types from the source, we will need to do the
// same work, but automatically.

// STATUS NOTE: this does not yet include Ember's full public API, only the
// subset of it for which we have determined the types are ready to stabilize.
//
// Over time, it will come to include *all* of Ember's types, and the matching
// \`preview\` types will become empty. This is means that someone who writes the
// import we recommend--
//
// \`\`\`ts
// import 'ember-source/types';
// import 'ember-source/types/preview';
// \`\`\`
//
// --will always get the most up-to-date mix of preview and stable types, with
// no extra effort required.

${MODULES_PLACEHOLDER}
`;

const TYPES_DIR = path.join('types', 'stable');

async function main() {
  fs.rmSync(TYPES_DIR, { recursive: true, force: true });
  fs.mkdirSync(TYPES_DIR, { recursive: true });

  spawnSync('yarn', ['tsc', '--project', 'tsconfig/publish-types.json']);

  // This is rooted in the `TYPES_DIR` so that the result is just the names of
  // the modules, as generated directly from the tsconfig above.
  let moduleNames = glob.sync('**/*.d.ts', {
    ignore: 'index.d.ts', // ignore the root file itself if it somehow exists
    cwd: TYPES_DIR,
  });

  let status = 'success';
  for (let moduleName of moduleNames) {
    let result = wrapInDeclareModule(moduleName);
    if (result !== 'success') {
      status = result;
    }
  }

  let sideEffectModules = moduleNames
    .filter((moduleName) => !PREVIEW_MODULES.includes(moduleName))
    .map((moduleName) => {
      // We need to import "package root" types as such, *not* via the actual
      // module which provides them, or TS does not see them correctly via the
      // side effect imports, so transform them accordingly:
      // `@ember/owner/index.d.ts` -> `@ember/owner`
      let moduleOrPackagePath = moduleName.replace(/\/index.d.ts$/, '');

      // Then create a relative path *to* the path on disk so that the
      // side-effect import is e.g. `import './@ember/owner';`, which makes it
      // resolve the actual local file, *not* go looking for some other package.
      return `import './${moduleOrPackagePath}';`;
    })
    .join('\n');

  let stableIndexDTsContents = BASE_INDEX_D_TS.replace(MODULES_PLACEHOLDER, sideEffectModules);
  fs.writeFileSync(path.join(TYPES_DIR, 'index.d.ts'), stableIndexDTsContents);

  process.exit(status === 'success' ? 0 : 1);
}

/**
 * @param {string} moduleName
 * @return {'success' | 'failure'}
 */
function wrapInDeclareModule(moduleName) {
  let modulePath = path.join(TYPES_DIR, moduleName);

  /** @type {string} */
  let contents;
  try {
    contents = fs.readFileSync(modulePath, { encoding: 'utf-8' });
  } catch (e) {
    console.error(`Error reading ${modulePath}: ${e}`);
    return 'failure';
  }

  let moduleNameForDeclaration = moduleName.replace('/index.d.ts', '');

  // This is a horrible nightmare of a hack; in a later PR I'm going to just
  // replace all of this by going ahead and using recast or such. As annoying as
  // that will be, it will be *way* more reliable.
  let string = new MagicString(contents);
  string
    .replace(/^export declare /gm, 'export ') // g for global, m for multiline
    .replace(/^declare /gm, '') // g for global, m for multiline
    .indent('  ')
    .prepend(`declare module '${moduleNameForDeclaration}' {\n`)
    .append('}\n');

  try {
    fs.writeFileSync(modulePath, string.toString());
  } catch (e) {
    console.error(`Error writing ${modulePath}: ${e}`);
    return 'failure';
  }

  return 'success';
}

// Run it!
main();