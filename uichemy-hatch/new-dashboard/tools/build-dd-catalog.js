#!/usr/bin/env node
/**
 * Generate the PHP dynamic-token catalog from the picker schema.
 *
 *   npm run catalog        (from new-dashboard/)
 *
 * uich-dd-schema.js is the list the visual data picker shows, and it already has
 * to stay in step with the PHP providers. This turns that same list into PHP so
 * the MCP ability (uichemy-composer/dynamic, action="list-fields") can hand an
 * agent the real token names instead of leaving it to guess — WITHOUT anyone
 * hand-maintaining a third copy that quietly drifts from the other two.
 *
 * Re-run it whenever a field is added to uich-dd-schema.js. The output is
 * committed; nothing generates it at runtime.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA = path.join(ROOT, 'uichemy-composer', 'assets', 'js', 'uich-dd-schema.js');
const OUT = path.join(ROOT, 'uichemy-composer', 'includes', 'dynamic', 'class-uich-dd-catalog.php');

const schema = require(SCHEMA);

/** PHP single-quoted string literal. */
const s = (v) => "'" + String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";

const PROVIDER_ORDER = ['post', 'product', 'user', 'term', 'image', 'site', 'request'];
const providers = PROVIDER_ORDER.filter((k) => schema.PROVIDERS[k]);

const lines = [];
const push = (n, str) => lines.push('\t'.repeat(n) + str);

lines.push('<?php');
lines.push('/**');
lines.push(' * Dynamic-token catalog — GENERATED FILE, DO NOT EDIT BY HAND.');
lines.push(' *');
lines.push(' * Source:    uichemy-composer/assets/js/uich-dd-schema.js');
lines.push(' * Generator: new-dashboard/tools/build-dd-catalog.js  (npm run catalog)');
lines.push(' *');
lines.push(' * The picker schema is the list a human sees when building a binding by');
lines.push(' * clicking. This is that same list in PHP, so an MCP agent can be handed the');
lines.push(' * real token names rather than guessing them — a guessed binding renders empty');
lines.push(' * instead of failing, which is the worst way for it to be wrong.');
lines.push(' *');
lines.push(' * Editing this file directly will be overwritten on the next generate. Add the');
lines.push(' * field to uich-dd-schema.js and re-run the generator instead.');
lines.push(' *');
lines.push(' * @package UiChemy');
lines.push(' */');
lines.push('');
lines.push("if ( ! defined( 'ABSPATH' ) ) {");
push(1, 'exit;');
lines.push('}');
lines.push('');
lines.push("if ( ! class_exists( 'Uich_DD_Catalog' ) ) {");
lines.push('');
push(1, '/**');
push(1, ' * The dynamic tokens this build can resolve, by provider.');
push(1, ' */');
push(1, 'class Uich_DD_Catalog {');
lines.push('');
push(2, '/**');
push(2, ' * Every provider with its fields.');
push(2, ' *');
push(2, ' * `extends` means the provider also answers everything the named one does');
push(2, ' * (a product is a post), so a consumer must walk the chain to list it all —');
push(2, ' * tokens() does that.');
push(2, ' *');
push(2, ' * @return array<string,array>');
push(2, ' */');
push(2, 'public static function providers() {');
push(3, 'return array(');

providers.forEach((key) => {
  const p = schema.PROVIDERS[key];
  push(4, `${s(key)} => array(`);
  push(5, `'label'   => ${s(p.label)},`);
  push(5, `'extends' => ${p.extends ? s(p.extends) : 'null'},`);
  push(5, "'fields'  => array(");
  p.fields.forEach((f) => {
    const bits = [`'key' => ${s(f.key)}`, `'label' => ${s(f.label)}`, `'type' => ${s(f.type)}`];
    if (f.provider) bits.push(`'chains_to' => ${s(f.provider)}`);
    if (f.args && f.args.length) {
      bits.push("'args' => array( " + f.args.map((a) => s(a.name)).join(', ') + ' )');
    }
    push(6, 'array( ' + bits.join(', ') + ' ),');
  });
  push(5, '),');
  push(4, '),');
});

push(3, ');');
push(2, '}');
lines.push('');
push(2, '/**');
push(2, ' * One provider\'s tokens, ready to print — inherited fields included.');
push(2, ' *');
push(2, ' * @param string $provider Provider key, e.g. "product".');
push(2, ' * @return array[] Each: token, label, type, [chains_to], [args].');
push(2, ' */');
push(2, 'public static function tokens( $provider ) {');
push(3, '$all = self::providers();');
push(3, '$key = (string) $provider;');
push(3, 'if ( ! isset( $all[ $key ] ) ) {');
push(4, 'return array();');
push(3, '}');
lines.push('');
push(3, '// Walk `extends` first so an inherited field keeps its position, then let');
push(3, '// the provider\'s OWN entry for the same key replace it — product.categories');
push(3, '// reads product_cat, not the post `category` the base entry describes.');
push(3, '$own = array();');
push(3, 'foreach ( $all[ $key ][\'fields\'] as $f ) {');
push(4, '$own[ $f[\'key\'] ] = $f;');
push(3, '}');
lines.push('');
push(3, '$fields = array();');
push(3, '$parent = $all[ $key ][\'extends\'];');
push(3, 'if ( $parent && isset( $all[ $parent ] ) ) {');
push(4, 'foreach ( $all[ $parent ][\'fields\'] as $f ) {');
push(5, '$fields[ $f[\'key\'] ] = isset( $own[ $f[\'key\'] ] ) ? $own[ $f[\'key\'] ] : $f;');
push(4, '}');
push(3, '}');
push(3, 'foreach ( $all[ $key ][\'fields\'] as $f ) {');
push(4, 'if ( ! isset( $fields[ $f[\'key\'] ] ) ) {');
push(5, '$fields[ $f[\'key\'] ] = $f;');
push(4, '}');
push(3, '}');
lines.push('');
push(3, '$out = array();');
push(3, 'foreach ( $fields as $f ) {');
push(4, '$token = $key . \'.\' . $f[\'key\'];');
push(4, 'if ( ! empty( $f[\'args\'] ) ) {');
push(5, '$token .= "(\'" . $f[\'args\'][0] . "\')";');
push(4, '}');
push(4, '$row = array(');
push(5, '\'token\' => \'{{ \' . $token . \' }}\',');
push(5, '\'label\' => $f[\'label\'],');
push(5, '\'type\'  => $f[\'type\'],');
push(4, ');');
push(4, 'if ( ! empty( $f[\'chains_to\'] ) ) {');
push(5, '$row[\'chains_to\'] = $f[\'chains_to\'];');
push(4, '}');
push(4, '$out[] = $row;');
push(3, '}');
lines.push('');
push(3, 'return $out;');
push(2, '}');
lines.push('');
push(2, '/** Provider keys, in picker order. */');
push(2, 'public static function provider_keys() {');
push(3, 'return array_keys( self::providers() );');
push(2, '}');
push(1, '}');
lines.push('}');
lines.push('');

fs.writeFileSync(OUT, lines.join('\n'), 'utf8');

const total = providers.reduce((n, k) => n + schema.getFields(k).length, 0);
console.log(`Wrote ${path.relative(ROOT, OUT)}`);
console.log(`  ${providers.length} providers, ${total} tokens (inherited included)`);
providers.forEach((k) => console.log(`  · ${k.padEnd(9)} ${schema.getFields(k).length}`));
