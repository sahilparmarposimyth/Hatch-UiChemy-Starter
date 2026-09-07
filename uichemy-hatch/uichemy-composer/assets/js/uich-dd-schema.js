/**
 * uich-dd-schema.js — the provider / field / filter catalog for the visual data picker.
 *
 * This MUST stay in sync with the PHP providers (includes/dynamic/class-uich-providers.php)
 * and filters (class-uich-filters.php). It is the menu the picker shows so a non-technical
 * user can build a binding by clicking (source -> field -> filter -> fallback) instead of
 * typing Twig. Field `provider` marks a chainable step (post.author -> user provider).
 *
 * Loads in both node (module.exports) and browser (window.UichDD).
 */
(function (root) {
	'use strict';

	// Root providers available by page context. The picker also injects loop aliases.
	var PROVIDERS = {
		post: {
			label: 'This Post',
			fields: [
				{ key: 'title', label: 'Title', type: 'text' },
				{ key: 'content', label: 'Content', type: 'html' },
				{ key: 'excerpt', label: 'Excerpt', type: 'text' },
				{ key: 'link', label: 'Link', type: 'url' },
				{ key: 'date', label: 'Date', type: 'date', args: [ { name: 'format', label: 'Format', default: 'F j, Y' } ] },
				{ key: 'id', label: 'ID', type: 'number' },
				{ key: 'slug', label: 'Slug', type: 'text' },
				{ key: 'status', label: 'Status', type: 'text' },
				{ key: 'comment_count', label: 'Comment count', type: 'number' },
				{ key: 'author', label: 'Author', type: 'provider', provider: 'user' },
				{ key: 'thumbnail', label: 'Featured image', type: 'provider', provider: 'image' },
				{ key: 'categories', label: 'Categories', type: 'array', provider: 'term' },
				{ key: 'tags', label: 'Tags', type: 'array', provider: 'term' },
				// Adjacent-post navigation. Chainable back into `post`, so the picker
				// drills Previous post -> Title / Link / Featured image; resolves to
				// nothing at the first / last post so the link can be hidden with
				// {% if post.prev %}. Backed by Uich_Post_Provider_Pro::adjacent(), so
				// fieldIsPro() marks both Pro without Pro installed — listed rather than
				// hidden, which is how every other gated field here behaves.
				{ key: 'prev', label: 'Previous post', type: 'provider', provider: 'post' },
				{ key: 'next', label: 'Next post', type: 'provider', provider: 'post' },
				{ key: 'meta', label: 'Custom field…', type: 'text', args: [ { name: 'key', label: 'Field key', default: '' } ] }
			]
		},
		// Mirrors Uich_Product_Provider (Pro). `extends: 'post'` inherits every post
		// field; where a key appears in BOTH lists the product entry wins (see
		// getFields), which is how `categories` reads product_cat here rather than
		// the post `category` the inherited entry describes.
		product: {
			label: 'This Product',
			extends: 'post',
			fields: [
				/* pricing */
				{ key: 'price', label: 'Price (raw number)', type: 'number' },
				{ key: 'price_html', label: 'Price (formatted)', type: 'html' },
				{ key: 'regular_price', label: 'Regular price', type: 'number' },
				{ key: 'sale_price', label: 'Sale price', type: 'number' },
				{ key: 'sale_percentage', label: 'Discount %', type: 'number' },
				{ key: 'is_on_sale', label: 'Is on sale?', type: 'bool' },
				{ key: 'sale_from', label: 'Sale starts', type: 'date', args: [ { name: 'format', label: 'Format', default: 'F j, Y' } ] },
				{ key: 'sale_to', label: 'Sale ends', type: 'date', args: [ { name: 'format', label: 'Format', default: 'F j, Y' } ] },
				{ key: 'currency', label: 'Currency code', type: 'text' },
				{ key: 'currency_symbol', label: 'Currency symbol', type: 'text' },
				/* identity */
				{ key: 'sku', label: 'SKU', type: 'text' },
				{ key: 'type', label: 'Product type (simple / variable…)', type: 'text' },
				{ key: 'is_featured', label: 'Featured?', type: 'bool' },
				{ key: 'is_downloadable', label: 'Downloadable?', type: 'bool' },
				{ key: 'is_virtual', label: 'Virtual?', type: 'bool' },
				/* stock */
				{ key: 'stock_status', label: 'Stock status', type: 'text' },
				{ key: 'stock_quantity', label: 'Stock quantity', type: 'number' },
				{ key: 'is_in_stock', label: 'In stock?', type: 'bool' },
				{ key: 'is_on_backorder', label: 'On backorder?', type: 'bool' },
				{ key: 'availability', label: 'Availability text', type: 'text' },
				/* content */
				{ key: 'short_description', label: 'Short description', type: 'html' },
				{ key: 'description', label: 'Description', type: 'html' },
				{ key: 'purchase_note', label: 'Purchase note', type: 'html' },
				/* taxonomies */
				{ key: 'categories', label: 'Product categories', type: 'array', provider: 'term' },
				{ key: 'tags', label: 'Product tags', type: 'array', provider: 'term' },
				{ key: 'brand', label: 'Brands', type: 'array', provider: 'term' },
				{ key: 'category_list', label: 'Categories (linked list)', type: 'html' },
				{ key: 'tag_list', label: 'Tags (linked list)', type: 'html' },
				{ key: 'attribute', label: 'Attribute…', type: 'text', args: [ { name: 'name', label: 'Attribute name', default: 'color' } ] },
				{ key: 'attributes', label: 'All attributes (label → value)', type: 'array' },
				/* commerce actions */
				{ key: 'add_to_cart_url', label: 'Add-to-cart URL', type: 'url' },
				{ key: 'add_to_cart_text', label: 'Add-to-cart label', type: 'text' },
				{ key: 'is_purchasable', label: 'Purchasable?', type: 'bool' },
				{ key: 'cart_url', label: 'Cart URL', type: 'url' },
				{ key: 'checkout_url', label: 'Checkout URL', type: 'url' },
				{ key: 'shop_url', label: 'Shop URL', type: 'url' },
				/* reviews */
				{ key: 'average_rating', label: 'Average rating', type: 'number' },
				{ key: 'review_count', label: 'Review count', type: 'number' },
				{ key: 'rating_html', label: 'Star rating (markup)', type: 'html' },
				{ key: 'reviews_allowed', label: 'Reviews allowed?', type: 'bool' },
				{ key: 'total_sales', label: 'Total sales', type: 'number' },
				/* shipping */
				{ key: 'weight', label: 'Weight', type: 'text' },
				{ key: 'length', label: 'Length', type: 'text' },
				{ key: 'width', label: 'Width', type: 'text' },
				{ key: 'height', label: 'Height', type: 'text' },
				{ key: 'dimensions', label: 'Dimensions (formatted)', type: 'text' },
				/* related products — chainable back into `product` */
				{ key: 'related', label: 'Related products', type: 'array', provider: 'product', args: [ { name: 'limit', label: 'How many', default: '4' } ] },
				{ key: 'upsells', label: 'Upsells', type: 'array', provider: 'product' },
				{ key: 'cross_sells', label: 'Cross-sells', type: 'array', provider: 'product' },
				{ key: 'variations', label: 'Variations', type: 'array', provider: 'product' },
				/* media */
				{ key: 'gallery', label: 'Gallery', type: 'array', provider: 'image' }
			]
		},
		user: {
			label: 'Current User',
			fields: [
				{ key: 'name', label: 'Display name', type: 'text' },
				{ key: 'id', label: 'ID', type: 'number' },
				{ key: 'url', label: 'Website', type: 'url' },
				{ key: 'bio', label: 'Bio', type: 'text' },
				{ key: 'link', label: 'Posts URL', type: 'url' },
				{ key: 'avatar', label: 'Avatar URL', type: 'url', args: [ { name: 'size', label: 'Size', default: '96' } ] },
				{ key: 'email', label: 'Email (admins)', type: 'text' },
				{ key: 'meta', label: 'Custom field…', type: 'text', args: [ { name: 'key', label: 'Field key', default: '' } ] }
			]
		},
		term: {
			label: 'This Term',
			fields: [
				{ key: 'name', label: 'Name', type: 'text' },
				{ key: 'id', label: 'ID', type: 'number' },
				{ key: 'slug', label: 'Slug', type: 'text' },
				{ key: 'description', label: 'Description', type: 'text' },
				{ key: 'count', label: 'Post count', type: 'number' },
				{ key: 'link', label: 'Link', type: 'url' }
			]
		},
		image: {
			label: 'Image',
			fields: [
				{ key: 'src', label: 'URL', type: 'url', args: [ { name: 'size', label: 'Size', default: 'full' } ] },
				{ key: 'alt', label: 'Alt text', type: 'text' },
				{ key: 'width', label: 'Width', type: 'number' },
				{ key: 'height', label: 'Height', type: 'number' },
				{ key: 'caption', label: 'Caption', type: 'text' }
			]
		},
		site: {
			label: 'Site',
			fields: [
				{ key: 'name', label: 'Name', type: 'text' },
				{ key: 'description', label: 'Tagline', type: 'text' },
				{ key: 'url', label: 'Home URL', type: 'url' },
				{ key: 'language', label: 'Language', type: 'text' },
				{ key: 'icon', label: 'Site icon', type: 'provider', provider: 'image' },
				{ key: 'logo', label: 'Logo', type: 'provider', provider: 'image' },
				{ key: 'option', label: 'Option…', type: 'text', args: [ { name: 'key', label: 'Option name', default: '' } ] }
			]
		},
		request: {
			label: 'URL / Request',
			fields: [
				{ key: 'get', label: 'Query parameter…', type: 'text', args: [ { name: 'key', label: 'Param name', default: '' } ] },
				{ key: 'url', label: 'Current URL', type: 'url' },
				{ key: 'referrer', label: 'Referrer', type: 'url' }
			]
		}
	};

	// Filters grouped by the value types they apply to. `any` always shows.
	var FILTERS = [
		{ name: 'upper', label: 'UPPERCASE', types: [ 'text' ] },
		{ name: 'lower', label: 'lowercase', types: [ 'text' ] },
		{ name: 'capitalize', label: 'Capitalize', types: [ 'text' ] },
		{ name: 'title', label: 'Title Case', types: [ 'text' ] },
		{ name: 'trim', label: 'Trim spaces', types: [ 'text' ] },
		{ name: 'truncate', label: 'Truncate…', types: [ 'text' ], args: [ { name: 'length', label: 'Length', default: '100' } ] },
		{ name: 'excerpt', label: 'Excerpt (words)…', types: [ 'text', 'html' ], args: [ { name: 'words', label: 'Words', default: '25' } ] },
		{ name: 'striptags', label: 'Strip HTML', types: [ 'html', 'text' ] },
		{ name: 'date', label: 'Format date…', types: [ 'date' ], args: [ { name: 'format', label: 'Format', default: 'F j, Y' } ] },
		{ name: 'time_ago', label: 'Time ago', types: [ 'date' ] },
		{ name: 'number_format', label: 'Number format…', types: [ 'number' ], args: [ { name: 'decimals', label: 'Decimals', default: '0' } ] },
		{ name: 'round', label: 'Round…', types: [ 'number' ], args: [ { name: 'precision', label: 'Decimals', default: '0' } ] },
		{ name: 'currency', label: 'As currency', types: [ 'number' ] },
		{ name: 'join', label: 'Join with…', types: [ 'array' ], args: [ { name: 'glue', label: 'Separator', default: ', ' } ] },
		{ name: 'length', label: 'Count', types: [ 'array' ] },
		{ name: 'first', label: 'First item', types: [ 'array' ] },
		{ name: 'last', label: 'Last item', types: [ 'array' ] },
		{ name: 'reverse', label: 'Reverse', types: [ 'array' ] },
		{ name: 'slug', label: 'Slugify', types: [ 'text' ] },
		{ name: 'wpautop', label: 'Auto paragraphs', types: [ 'html' ] },
		{ name: 'raw', label: 'Raw (allow HTML)', types: [ 'html', 'text' ] }
	];

	// Loop sources for the loop builder.
	var LOOP_SOURCES = [
		{ key: 'get_posts', label: 'Posts', alias: 'post', postType: true },
		{ key: 'get_products', label: 'Products (WooCommerce)', alias: 'product', postType: false, taxonomy: 'product_cat' },
		{ key: 'get_terms', label: 'Terms / Categories', alias: 'term' },
		{ key: 'get_users', label: 'Users', alias: 'user' }
	];

	var ORDERBY = [ 'date', 'title', 'menu_order', 'rand', 'ID', 'name', 'count' ];
	var CONDITION_OPS = [
		{ key: '==', label: 'is' },
		{ key: '!=', label: 'is not' },
		{ key: '>', label: 'greater than' },
		{ key: '<', label: 'less than' },
		{ key: 'is_set', label: 'is set' },
		{ key: 'is_empty', label: 'is empty' }
	];

	function getFields(providerKey) {
		var p = PROVIDERS[ providerKey ];
		if ( ! p ) { return []; }
		if ( ! p.extends || ! PROVIDERS[ p.extends ] ) { return p.fields.slice(); }

		// Inherited fields keep their position, but a provider's OWN entry for the
		// same key replaces the inherited one — `product.categories` reads
		// product_cat, so it must not be listed twice with the post description.
		var own = {};
		p.fields.forEach( function ( f ) { own[ f.key ] = f; } );

		var out = PROVIDERS[ p.extends ].fields.map( function ( f ) {
			return own[ f.key ] || f;
		} );

		var listed = {};
		out.forEach( function ( f ) { listed[ f.key ] = 1; } );
		p.fields.forEach( function ( f ) {
			if ( ! listed[ f.key ] ) { out.push( f ); }
		} );

		return out;
	}

	function filtersForType(type) {
		return FILTERS.filter( function ( f ) {
			return ( f.types.indexOf( type ) !== -1 ) || ( f.types.indexOf( 'any' ) !== -1 );
		} );
	}

	/* ------------------- optional-plugin integration gating ------------------- */
	// Some sources depend on an optional plugin (WooCommerce products, …). The
	// server reports which are active synchronously via
	// window.uichAtomFields.integrations ({ woo, acf, jet }); a source tied to an
	// inactive integration is hidden from the pickers. An unknown/absent flag is
	// treated as ACTIVE so a stale or missing localize never hides a core source.
	var SOURCE_INTEGRATION      = { product: 'woo' };
	var LOOP_SOURCE_INTEGRATION = { get_products: 'woo' };

	function activeIntegrations() {
		return ( typeof window !== 'undefined' && window.uichAtomFields && window.uichAtomFields.integrations ) || {};
	}
	function integrationActive(name) {
		if ( ! name ) { return true; }
		return activeIntegrations()[ name ] !== false;
	}
	function sourceAvailable(key) { return integrationActive( SOURCE_INTEGRATION[ key ] ); }

	/* ----------------------------- Free / Pro tiering -------------------------- */
	// Free ships four dynamic tags: Post Title, Post Image, Post Content and Post
	// URL. Everything else in this catalog is Pro — including every Term/Category
	// field. This mirrors uichemy_dynamic_free_fields() in
	// includes/uichemy-pro-gate.php — the PHP list is the one that actually enforces
	// (a Pro field resolves to nothing in Free), so KEEP THE TWO IN SYNC. Here it
	// only decides what the picker offers.
	//
	// `image` carries the whole chain because it IS the Post Image tag (an <img>
	// needs src/alt/width/height). `post.id` is intentionally absent: it resolves in
	// Free as loop plumbing ("Exclude current post") but is not offered as a tag.
	// `term` is empty on purpose — Category Title went Pro on 2026-07-31 — which
	// makes sourceIsPro('term') true and locks the whole source.
	var FREE_FIELDS = {
		post:  [ 'title', 'content', 'link', 'thumbnail' ],
		term:  [],
		image: [ 'src', 'alt', 'width', 'height', 'caption' ]
	};

	function isPro() {
		return !! ( typeof window !== 'undefined' && window.uichAtomFields && window.uichAtomFields.isPro );
	}

	function proUrl() {
		var cfg = ( typeof window !== 'undefined' && window.uichAtomFields ) || {};
		return cfg.proUrl || 'https://uichemy.com/pricing/';
	}

	/** True when this field needs Pro in the current build. */
	function fieldIsPro(providerKey, fieldKey) {
		if ( isPro() ) { return false; }
		var free = FREE_FIELDS[ providerKey ];
		if ( ! free ) { return true; }            // whole source is Pro (product, user, site, request…)
		return free.indexOf( fieldKey ) === -1;
	}

	/** True when every field of a source is Pro, so the source itself is locked. */
	function sourceIsPro(providerKey) {
		if ( isPro() ) { return false; }
		var free = FREE_FIELDS[ providerKey ];
		return ! free || ! free.length;
	}

	// Free loops over POSTS only. Products / Terms / Users / External API are Pro —
	// mirrors uichemy_free_loop_sources(), which is what actually enforces (a Pro
	// source returns an empty collection, so the loop shows its empty state).
	var FREE_LOOP_SOURCES = [ 'get_posts' ];

	/** True when this loop source needs Pro in the current build. */
	function loopSourceIsPro(key) {
		if ( isPro() ) { return false; }
		return FREE_LOOP_SOURCES.indexOf( key ) === -1;
	}

	function loopSourceAvailable(key) { return integrationActive( LOOP_SOURCE_INTEGRATION[ key ] ); }
	function availableSources(list) {
		return ( list || [] ).filter( function ( k ) { return sourceAvailable( k ); } );
	}
	function availableLoopSources() {
		return LOOP_SOURCES.filter( function ( s ) { return loopSourceAvailable( s.key ); } );
	}

	var POST_TYPES = [];
	// Introspected custom (ACF) fields collected for the picker's dedicated "ACF"
	// group. Each carries the real provider it binds to (source) so it still
	// compiles to <source>.meta('key') — there is no standalone `acf` provider.
	var ACF_FIELDS = [];

	// Merge live-introspected fields (ACF/Meta Box/registered meta) + post types into the schema.
	// Called once on editor load from the /atom-fields REST response.
	function extend(data) {
		if ( ! data ) { return; }
		ACF_FIELDS = [];
		var seenAcf = {};
		[ 'post', 'product', 'user', 'term', 'site' ].forEach( function ( prov ) {
			if ( ! data[ prov ] || ! PROVIDERS[ prov ] ) { return; }
			var have = {};
			getFields( prov ).forEach( function ( f ) { have[ f.key ] = 1; } );
			data[ prov ].forEach( function ( f ) {
				if ( ! have[ f.key ] ) { PROVIDERS[ prov ].fields.push( f ); have[ f.key ] = 1; }
				// A field backed by a meta key is a discovered custom (ACF) field:
				// remember it (with its provider) for the ACF group. Dedupe by key
				// across providers so a shared field lists once (first provider wins).
				if ( f.metaKey && ! seenAcf[ f.metaKey ] ) {
					seenAcf[ f.metaKey ] = 1;
					ACF_FIELDS.push( Object.assign( {}, f, { source: prov } ) );
				}
			} );
		} );
		if ( Array.isArray( data.postTypes ) ) { POST_TYPES = data.postTypes; }
	}
	function postTypes() { return POST_TYPES; }
	function acfFields() { return ACF_FIELDS.slice(); }

	var lib = {
		PROVIDERS: PROVIDERS,
		FILTERS: FILTERS,
		LOOP_SOURCES: LOOP_SOURCES,
		ORDERBY: ORDERBY,
		CONDITION_OPS: CONDITION_OPS,
		getFields: getFields,
		filtersForType: filtersForType,
		integrationActive: integrationActive,
		isPro: isPro,
		proUrl: proUrl,
		FREE_FIELDS: FREE_FIELDS,
		FREE_LOOP_SOURCES: FREE_LOOP_SOURCES,
		fieldIsPro: fieldIsPro,
		sourceIsPro: sourceIsPro,
		loopSourceIsPro: loopSourceIsPro,
		sourceAvailable: sourceAvailable,
		loopSourceAvailable: loopSourceAvailable,
		availableSources: availableSources,
		availableLoopSources: availableLoopSources,
		extend: extend,
		postTypes: postTypes,
		acfFields: acfFields
	};

	if ( typeof module !== 'undefined' && module.exports ) {
		module.exports = lib;
	}
	root.UichDD = Object.assign( root.UichDD || {}, { schema: lib } );
} )( typeof window !== 'undefined' ? window : globalThis );
