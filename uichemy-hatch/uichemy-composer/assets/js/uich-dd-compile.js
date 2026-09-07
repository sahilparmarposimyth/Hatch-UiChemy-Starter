/**
 * uich-dd-compile.js — convert between a structured BINDING object and Twig text.
 *
 * The binding object is the source of truth (per CROSS-CMS-AND-VISUAL-DATA.md): the visual
 * picker edits the object, this module compiles it to Twig for output, and parses Twig back
 * into the object so a chip round-trips. Complex expressions we can't model fall back to a
 * { raw: true, code } chip that still shows in the UI and re-emits verbatim.
 *
 * Loads in both node (module.exports) and browser (window.UichDD).
 */
(function (root) {
	'use strict';

	/* ----------------------------- literals ----------------------------- */

	function lit(v) {
		if ( v === null || v === undefined || v === '' ) { return "''"; }
		var s = String( v );
		// Bare number if it's a clean integer/decimal.
		if ( /^-?\d+(\.\d+)?$/.test( s ) ) { return s; }
		// true/false/null keywords pass through.
		if ( s === 'true' || s === 'false' || s === 'null' ) { return s; }
		return "'" + s.replace( /'/g, "\\'" ) + "'";
	}

	function argsToString(args) {
		if ( ! args || ! args.length ) { return ''; }
		return '(' + args.map( lit ).join( ', ' ) + ')';
	}

	/* --------------------------- binding -> twig ------------------------- */

	function compileBinding(binding) {
		if ( ! binding ) { return ''; }
		if ( binding.raw ) { return '{{ ' + binding.code + ' }}'; }

		var expr = binding.source || '';
		( binding.steps || [] ).forEach( function ( step ) {
			// Fields backed by a meta key (ACF/Meta Box) compile to .meta('key').
			if ( step.metaKey ) { expr += ".meta('" + step.metaKey + "')"; }
			else { expr += '.' + step.field + argsToString( step.args ); }
		} );
		( binding.filters || [] ).forEach( function ( f ) {
			expr += '|' + f.name + argsToString( f.args );
		} );
		if ( binding.fallback !== undefined && binding.fallback !== null && binding.fallback !== '' ) {
			expr += '|default(' + lit( binding.fallback ) + ')';
		}
		return '{{ ' + expr + ' }}';
	}

	/* ------------------- cross-CMS proof: binding -> Liquid (Shopify) ------------------- */
	// Demonstrates the "binding model is the source of truth; engines are render targets"
	// architecture (CROSS-CMS-AND-VISUAL-DATA.md). Same binding → Liquid for Shopify.
	var LIQUID_FILTERS = { upper: 'upcase', lower: 'downcase', capitalize: 'capitalize', currency: 'money', truncate: 'truncate', date: 'date', 'default': 'default', join: 'join', first: 'first', last: 'last', length: 'size' };
	function liquidArg( a ) { return /^-?\d+(\.\d+)?$/.test( String( a ) ) ? String( a ) : "'" + String( a ).replace( /'/g, "\\'" ) + "'"; }
	function compileToLiquid( binding ) {
		if ( ! binding ) { return ''; }
		if ( binding.raw ) { return '{{ ' + binding.code + ' }}'; }
		var expr = binding.source || '';
		( binding.steps || [] ).forEach( function ( step ) {
			// ACF meta → Shopify metafields; plain fields keep dot access.
			if ( step.metaKey ) { expr += '.metafields.custom.' + step.metaKey; }
			else { expr += '.' + step.field; }
		} );
		( binding.filters || [] ).forEach( function ( f ) {
			var name = LIQUID_FILTERS[ f.name ] || f.name;
			expr += ' | ' + name + ( ( f.args && f.args.length ) ? ': ' + f.args.map( liquidArg ).join( ', ' ) : '' );
		} );
		if ( binding.fallback !== undefined && binding.fallback !== null && binding.fallback !== '' ) {
			expr += " | default: '" + String( binding.fallback ).replace( /'/g, "\\'" ) + "'";
		}
		return '{{ ' + expr + ' }}';
	}

	/* --------------------------- twig -> binding ------------------------- */

	// Split a string on a delimiter char, ignoring delimiters inside quotes/parens/brackets.
	function topSplit(str, delim) {
		var out = [], depth = 0, quote = '', cur = '';
		for ( var i = 0; i < str.length; i++ ) {
			var c = str[ i ];
			if ( quote ) {
				if ( c === quote && str[ i - 1 ] !== '\\' ) { quote = ''; }
				cur += c; continue;
			}
			if ( c === '"' || c === "'" ) { quote = c; cur += c; continue; }
			if ( c === '(' || c === '[' || c === '{' ) { depth++; cur += c; continue; }
			if ( c === ')' || c === ']' || c === '}' ) { depth--; cur += c; continue; }
			if ( c === delim && depth === 0 ) { out.push( cur ); cur = ''; continue; }
			cur += c;
		}
		out.push( cur );
		return out;
	}

	function parseArgs(inside) {
		var raw = topSplit( inside, ',' );
		return raw.map( function ( a ) {
			a = a.trim();
			if ( a === '' ) { return ''; }
			if ( ( a[0] === "'" || a[0] === '"' ) && a[ a.length - 1 ] === a[0] ) {
				return a.slice( 1, -1 ).replace( /\\'/g, "'" );
			}
			return a; // number / keyword
		} );
	}

	// Parse "field('a','b')" -> { field, args }
	function parseCall(token) {
		token = token.trim();
		var m = token.match( /^([a-zA-Z_][\w]*)\s*\((.*)\)\s*$/s );
		if ( m ) { return { field: m[1], args: parseArgs( m[2] ) }; }
		return { field: token, args: [] };
	}

	function isSimpleExpr(chain) {
		// Reject anything with operators/ternary that we can't model as a chip.
		return ! /[+\-*/%~?]|==|!=|<|>|\band\b|\bor\b|\bnot\b/.test( chain );
	}

	function parseBinding(twig) {
		if ( typeof twig !== 'string' ) { return null; }
		var m = twig.match( /^\s*\{\{\s*([\s\S]*?)\s*\}\}\s*$/ );
		if ( ! m ) { return null; }
		var inner = m[1].trim();

		var segs = topSplit( inner, '|' ).map( function ( s ) { return s.trim(); } );
		var chain = segs.shift();

		if ( ! isSimpleExpr( chain ) ) {
			return { raw: true, code: inner };
		}

		var parts = topSplit( chain, '.' ).map( function ( s ) { return s.trim(); } );
		var source = parts.shift();
		var steps = parts.map( parseCall );

		var fallback;
		var filters = [];
		segs.forEach( function ( seg ) {
			var call = parseCall( seg );
			if ( call.field === 'default' ) {
				fallback = call.args.length ? call.args[0] : '';
			} else {
				filters.push( { name: call.field, args: call.args } );
			}
		} );

		return { source: source, steps: steps, filters: filters, fallback: fallback };
	}

	/* ----------------------------- loop -> twig ------------------------- */

	function compileLoop(cfg) {
		cfg = cfg || {};
		var src = cfg.sourceKey || 'get_posts';
		var alias = cfg.alias || 'item';
		var pairs = [];

		if ( src === 'get_posts' ) {
			if ( cfg.postType ) { pairs.push( "post_type: " + lit( cfg.postType ) ); }
			pairs.push( 'posts_per_page: ' + ( parseInt( cfg.perPage, 10 ) || 10 ) );
			if ( cfg.orderby ) { pairs.push( 'orderby: ' + lit( cfg.orderby ) ); }
			if ( cfg.order ) { pairs.push( 'order: ' + lit( cfg.order ) ); }
			if ( cfg.term ) {
				pairs.push( "tax_query: [ { taxonomy: " + lit( cfg.taxonomy || 'category' ) + ", field: 'slug', terms: " + lit( cfg.term ) + " } ]" );
			}
		} else if ( src === 'get_products' ) {
			pairs.push( 'posts_per_page: ' + ( parseInt( cfg.perPage, 10 ) || 12 ) );
			if ( cfg.orderby ) { pairs.push( 'orderby: ' + lit( cfg.orderby ) ); }
			if ( cfg.order ) { pairs.push( 'order: ' + lit( cfg.order ) ); }
			if ( cfg.term ) {
				pairs.push( "tax_query: [ { taxonomy: 'product_cat', field: 'slug', terms: " + lit( cfg.term ) + " } ]" );
			}
		} else if ( src === 'get_terms' ) {
			pairs.push( 'taxonomy: ' + lit( cfg.taxonomy || 'category' ) );
			pairs.push( 'number: ' + ( parseInt( cfg.perPage, 10 ) || 10 ) );
			if ( cfg.orderby ) { pairs.push( 'orderby: ' + lit( cfg.orderby ) ); }
		} else if ( src === 'get_users' ) {
			pairs.push( 'number: ' + ( parseInt( cfg.perPage, 10 ) || 10 ) );
			if ( cfg.role ) { pairs.push( 'role: ' + lit( cfg.role ) ); }
		}

		var query = src + '({ ' + pairs.join( ', ' ) + ' })';
		var open = '{% for ' + alias + ' in ' + query + ' %}';
		var close = '{% endfor %}';
		var inner = cfg.inner !== undefined ? cfg.inner : '\n  \n';
		return { open: open, close: close, full: open + inner + close };
	}

	/* -------------------------- condition -> twig ---------------------- */

	function compileCondition(cfg) {
		cfg = cfg || {};
		var expr = cfg.expr || '';
		var op = cfg.op || '==';
		var cond;
		switch ( op ) {
			case 'is_set':   cond = expr; break;
			case 'is_empty': cond = 'not ' + expr; break;
			case '>':
			case '<':        cond = expr + ' ' + op + ' ' + lit( cfg.value ); break;
			default:         cond = expr + ' ' + op + ' ' + lit( cfg.value ); break;
		}
		var open = '{% if ' + cond + ' %}';
		var close = '{% endif %}';
		var inner = cfg.inner !== undefined ? cfg.inner : '\n  \n';
		return { open: open, close: close, full: open + inner + close };
	}

	/* ----------------------------- chip label -------------------------- */

	// Human label for a binding chip: "Post · Author · Name · upper".
	// Friendly labels for common loop / {% set %} variable names that aren't
	// schema providers, so e.g. `cat.name` reads "Category · Name" instead of
	// the raw variable "cat · Name". Falls back to Title Case for anything else.
	var UICH_ALIAS_LABELS = {
		cat: 'Category', category: 'Category', cats: 'Categories', categories: 'Categories',
		tag: 'Tag', tags: 'Tags', term: 'Term', terms: 'Terms',
		item: 'Item', post: 'Post', posts: 'Posts', product: 'Product', products: 'Products',
		user: 'User', users: 'Users', author: 'Author', img: 'Image', image: 'Image'
	};
	function uichTitleCase(s) {
		s = String( s == null ? '' : s );
		return s ? s.charAt( 0 ).toUpperCase() + s.slice( 1 ).replace( /_/g, ' ' ) : s;
	}

	function bindingLabel(binding, schema) {
		if ( ! binding ) { return ''; }
		if ( binding.raw ) { return binding.code; }
		var parts = [];
		var prov = schema && schema.PROVIDERS[ binding.source ];
		var srcLabel = prov ? prov.label : ( UICH_ALIAS_LABELS[ binding.source ] || uichTitleCase( binding.source ) );
		// Drop the "This " prefix from provider labels ("This Post" → "Post") so
		// binding labels read cleanly (e.g. "Post · Title", not "This Post · Title").
		srcLabel = srcLabel.replace( /^This\s+/i, '' );
		parts.push( srcLabel );
		( binding.steps || [] ).forEach( function ( s ) {
			parts.push( s.field.charAt( 0 ).toUpperCase() + s.field.slice( 1 ).replace( /_/g, ' ' ) );
		} );
		( binding.filters || [] ).forEach( function ( f ) { parts.push( f.name ); } );
		return parts.join( ' · ' );
	}

	var lib = {
		compileBinding: compileBinding,
		compileToLiquid: compileToLiquid,
		parseBinding: parseBinding,
		compileLoop: compileLoop,
		compileCondition: compileCondition,
		bindingLabel: bindingLabel,
		_topSplit: topSplit
	};

	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = lib;
	}
	root.UichDD = Object.assign( root.UichDD || {}, { compile: lib } );
} )( typeof window !== 'undefined' ? window : globalThis );
