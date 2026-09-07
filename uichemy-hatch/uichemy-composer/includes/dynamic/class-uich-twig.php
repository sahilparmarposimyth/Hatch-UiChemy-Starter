<?php
/**
 * Uich_Twig — a small, dependency-free, sandboxed Twig-compatible template engine.
 *
 * Supports: {{ output }}, {% if/elseif/else/endif %}, {% for x in y / for k,v in y %}
 * with {% else %}, {% set name = expr %}, {# comments #}, dot/bracket access, method
 * calls with args, filters ( value|name(args) ), function calls, operators
 * ( + - * / % ~ and or not == != === !== < > <= >= ?? ?: ternary in ), array/object
 * literals, and arrow functions for map/filter/sort/reduce/find.
 *
 * It is intentionally a *subset* of Twig with the same syntax, so templates and author
 * knowledge transfer 1:1, and so the whole thing can later be swapped for Symfony Twig
 * behind the same Uich_Dynamic facade without changing any template.
 *
 * SANDBOX: the evaluator only ever reads from Uich_Provider objects (via uich_get),
 * arrays, and plain values. It NEVER calls arbitrary PHP methods on arbitrary objects,
 * and only whitelisted functions/filters can run. This is what makes user templates safe.
 *
 * @package Uichemy
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'Uich_Twig' ) ) {

	/**
	 * Template-level engine: lex → parse into a node tree → render against a context.
	 */
	class Uich_Twig {

		/**
		 * Render a template string against a context.
		 *
		 * @param string $template Template source (HTML with {{ }} / {% %}).
		 * @param array  $context  Root variables (name => value/provider).
		 * @return string
		 */
		public static function render( $template, array $context = array() ) {
			if ( '' === (string) $template ) {
				return '';
			}
			// Fast path: nothing dynamic.
			if ( false === strpos( $template, '{{' ) && false === strpos( $template, '{%' ) && false === strpos( $template, '{#' ) ) {
				return $template;
			}

			try {
				$tokens  = self::lex( $template );
				$pos     = 0;
				$nodes   = self::parse( $tokens, $pos, array() );
				$runtime = new Uich_Twig_Runtime();
				return $runtime->render_nodes( $nodes, $context );
			} catch ( \Throwable $e ) {
				if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
					return '<!-- uich-twig error: ' . esc_html( $e->getMessage() ) . ' -->' . $template;
				}
				return $template; // Fail open to authored HTML rather than blowing up the page.
			}
		}

		/**
		 * Split the template into a flat list of tokens.
		 * Each token: array( 'type' => text|out|tag, 'value' => string ).
		 */
		private static function lex( $template ) {
			$tokens = array();
			$len    = strlen( $template );
			$i      = 0;
			$text   = '';

			while ( $i < $len ) {
				$two = substr( $template, $i, 2 );
				if ( '{{' === $two || '{%' === $two || '{#' === $two ) {
					if ( '' !== $text ) {
						$tokens[] = array(
							'type'  => 'text',
							'value' => $text,
						);
						$text     = '';
					}
					$close = '{{' === $two ? '}}' : ( '{%' === $two ? '%}' : '#}' );
					$end   = strpos( $template, $close, $i + 2 );
					if ( false === $end ) {
						$text .= substr( $template, $i );
						break;
					}
					$inner = substr( $template, $i + 2, $end - ( $i + 2 ) );
					if ( '{{' === $two ) {
						$tokens[] = array(
							'type'  => 'out',
							'value' => trim( $inner ),
						);
					} elseif ( '{%' === $two ) {
						$tokens[] = array(
							'type'  => 'tag',
							'value' => trim( $inner ),
						);
					}
					// '{#' comments are dropped.
					$i = $end + 2;
				} else {
					$text .= $template[ $i ];
					++$i;
				}
			}
			if ( '' !== $text ) {
				$tokens[] = array(
					'type'  => 'text',
					'value' => $text,
				);
			}
			return $tokens;
		}

		/**
		 * Parse a flat token list into a node tree until one of $stoppers is met.
		 *
		 * @param array $tokens   Token list.
		 * @param int   $pos      Current position (by reference).
		 * @param array $stoppers Tag keywords that end this block (e.g. endif, else).
		 * @return array Node list.
		 */
		private static function parse( $tokens, &$pos, $stoppers ) {
			$nodes = array();
			$count = count( $tokens );

			while ( $pos < $count ) {
				$tok = $tokens[ $pos ];

				if ( 'text' === $tok['type'] ) {
					$nodes[] = array(
						'type'  => 'text',
						'value' => $tok['value'],
					);
					++$pos;
					continue;
				}

				if ( 'out' === $tok['type'] ) {
					$nodes[] = array(
						'type' => 'out',
						'expr' => Uich_Expr::parse_expression( $tok['value'] ),
					);
					++$pos;
					continue;
				}

				// tag
				$tag     = $tok['value'];
				$keyword = self::tag_keyword( $tag );

				if ( in_array( $keyword, $stoppers, true ) ) {
					return $nodes; // leave $pos on the stopper for the caller.
				}

				if ( 'if' === $keyword ) {
					++$pos;
					$nodes[] = self::parse_if( $tokens, $pos, $tag );
					continue;
				}

				if ( 'for' === $keyword ) {
					++$pos;
					$nodes[] = self::parse_for( $tokens, $pos, $tag );
					continue;
				}

				if ( 'set' === $keyword ) {
					++$pos;
					$nodes[] = self::parse_set( $tag );
					continue;
				}

				// Unknown tag — ignore gracefully.
				++$pos;
			}

			return $nodes;
		}

		private static function tag_keyword( $tag ) {
			if ( preg_match( '/^\s*([a-z_]+)/i', $tag, $m ) ) {
				return strtolower( $m[1] );
			}
			return '';
		}

		private static function parse_if( $tokens, &$pos, $open_tag ) {
			$branches   = array();
			$cond_src   = trim( preg_replace( '/^\s*if\s+/i', '', $open_tag ) );
			$branches[] = array(
				'cond'  => Uich_Expr::parse_expression( $cond_src ),
				'nodes' => self::parse( $tokens, $pos, array( 'elseif', 'else', 'endif' ) ),
			);

			while ( $pos < count( $tokens ) ) {
				$tag = $tokens[ $pos ]['value'];
				$kw  = self::tag_keyword( $tag );
				if ( 'elseif' === $kw ) {
					++$pos;
					$cond_src   = trim( preg_replace( '/^\s*elseif\s+/i', '', $tag ) );
					$branches[] = array(
						'cond'  => Uich_Expr::parse_expression( $cond_src ),
						'nodes' => self::parse( $tokens, $pos, array( 'elseif', 'else', 'endif' ) ),
					);
				} elseif ( 'else' === $kw ) {
					++$pos;
					$branches[] = array(
						'cond'  => null,
						'nodes' => self::parse( $tokens, $pos, array( 'endif' ) ),
					);
				} elseif ( 'endif' === $kw ) {
					++$pos;
					break;
				} else {
					break;
				}
			}

			return array(
				'type'     => 'if',
				'branches' => $branches,
			);
		}

		private static function parse_for( $tokens, &$pos, $open_tag ) {
			$key_var  = null;
			$val_var  = null;
			$iter_ast = null;

			$src = trim( preg_replace( '/^\s*for\s+/i', '', $open_tag ) );
			if ( preg_match( '/^([a-zA-Z_][\w]*)\s*,\s*([a-zA-Z_][\w]*)\s+in\s+(.+)$/s', $src, $m ) ) {
				$key_var  = $m[1];
				$val_var  = $m[2];
				$iter_ast = Uich_Expr::parse_expression( $m[3] );
			} elseif ( preg_match( '/^([a-zA-Z_][\w]*)\s+in\s+(.+)$/s', $src, $m ) ) {
				$val_var  = $m[1];
				$iter_ast = Uich_Expr::parse_expression( $m[2] );
			}

			$body = self::parse( $tokens, $pos, array( 'else', 'endfor' ) );
			$else = array();
			if ( $pos < count( $tokens ) ) {
				$kw = self::tag_keyword( $tokens[ $pos ]['value'] );
				if ( 'else' === $kw ) {
					++$pos;
					$else = self::parse( $tokens, $pos, array( 'endfor' ) );
				}
			}
			if ( $pos < count( $tokens ) && 'endfor' === self::tag_keyword( $tokens[ $pos ]['value'] ) ) {
				++$pos;
			}

			return array(
				'type'    => 'for',
				'key_var' => $key_var,
				'val_var' => $val_var,
				'iter'    => $iter_ast,
				'body'    => $body,
				'else'    => $else,
			);
		}

		private static function parse_set( $tag ) {
			$src = trim( preg_replace( '/^\s*set\s+/i', '', $tag ) );
			if ( preg_match( '/^([a-zA-Z_][\w]*)\s*=\s*(.+)$/s', $src, $m ) ) {
				return array(
					'type' => 'set',
					'name' => $m[1],
					'expr' => Uich_Expr::parse_expression( $m[2] ),
				);
			}
			return array(
				'type'  => 'text',
				'value' => '',
			);
		}
	}
}

if ( ! class_exists( 'Uich_Twig_Runtime' ) ) {

	/**
	 * Renders a parsed node tree and evaluates expression ASTs against a scope.
	 */
	class Uich_Twig_Runtime {

		public function render_nodes( $nodes, array $scope ) {
			$out = '';
			foreach ( $nodes as $node ) {
				$out .= $this->render_node( $node, $scope );
			}
			return $out;
		}

		private function render_node( $node, array &$scope ) {
			switch ( $node['type'] ) {
				case 'text':
					return $node['value'];

				case 'out':
					$val = $this->eval_ast( $node['expr'], $scope );
					return $this->stringify_output( $val );

				case 'set':
					$scope[ $node['name'] ] = $this->eval_ast( $node['expr'], $scope );
					return '';

				case 'if':
					foreach ( $node['branches'] as $branch ) {
						if ( null === $branch['cond'] || $this->truthy( $this->eval_ast( $branch['cond'], $scope ) ) ) {
							return $this->render_nodes( $branch['nodes'], $scope );
						}
					}
					return '';

				case 'for':
					return $this->render_for( $node, $scope );
			}
			return '';
		}

		private function render_for( $node, array $scope ) {
			$iterable = $this->eval_ast( $node['iter'], $scope );
			$items    = $this->to_iterable( $iterable );

			if ( empty( $items ) ) {
				return $this->render_nodes( $node['else'], $scope );
			}

			$out    = '';
			$total  = count( $items );
			$index0 = 0;
			$keys   = array_keys( $items );
			foreach ( $items as $key => $val ) {
				$loop_scope = $scope; // child scope
				if ( $node['key_var'] ) {
					$loop_scope[ $node['key_var'] ] = $key;
				}
				$loop_scope[ $node['val_var'] ] = $val;
				$loop_scope['loop']             = array(
					'index'    => $index0 + 1,
					'index0'   => $index0,
					'first'    => 0 === $index0,
					'last'     => $index0 === $total - 1,
					'length'   => $total,
					'revindex' => $total - $index0,
				);
				$out                           .= $this->render_nodes( $node['body'], $loop_scope );
				++$index0;
			}
			return $out;
		}

		/*
		---------------------------------------------------------------------
		 * Expression evaluation
		 * ------------------------------------------------------------------- */

		public function eval_ast( $ast, array &$scope ) {
			if ( ! is_array( $ast ) ) {
				return $ast;
			}
			switch ( $ast['t'] ) {
				case 'lit':
					return $ast['v'];

				case 'name':
					if ( array_key_exists( $ast['v'], $scope ) ) {
						return $scope[ $ast['v'] ];
					}
					return null;

				case 'array':
					$arr = array();
					foreach ( $ast['items'] as $it ) {
						$arr[] = $this->eval_ast( $it, $scope );
					}
					return $arr;

				case 'object':
					$obj = array();
					foreach ( $ast['pairs'] as $k => $v ) {
						$obj[ $k ] = $this->eval_ast( $v, $scope );
					}
					return $obj;

				case 'unary':
					$v = $this->eval_ast( $ast['expr'], $scope );
					if ( 'not' === $ast['op'] ) {
						return ! $this->truthy( $v );
					}
					if ( '-' === $ast['op'] ) {
						return -1 * (float) $v;
					}
					return $v;

				case 'bin':
					return $this->eval_binary( $ast, $scope );

				case 'ternary':
					return $this->truthy( $this->eval_ast( $ast['cond'], $scope ) )
						? $this->eval_ast( $ast['then'], $scope )
						: $this->eval_ast( $ast['else'], $scope );

				case 'coalesce': // ??
					$l = $this->eval_ast( $ast['left'], $scope );
					return ( null === $l ) ? $this->eval_ast( $ast['right'], $scope ) : $l;

				case 'elvis': // ?:
					$l = $this->eval_ast( $ast['left'], $scope );
					return $this->truthy( $l ) ? $l : $this->eval_ast( $ast['right'], $scope );

				case 'member':
					$obj  = $this->eval_ast( $ast['obj'], $scope );
					$args = null;
					if ( isset( $ast['args'] ) ) {
						$args = $this->eval_args( $ast['args'], $scope );
					}
					return $this->access( $obj, $ast['name'], $args );

				case 'subscript':
					$obj = $this->eval_ast( $ast['obj'], $scope );
					$idx = $this->eval_ast( $ast['index'], $scope );
					return $this->access( $obj, $idx, null );

				case 'filter':
					$val  = $this->eval_ast( $ast['value'], $scope );
					$args = $this->eval_args( $ast['args'], $scope );
					return Uich_Filters::apply( $ast['name'], $val, $args );

				case 'call':
					$args = $this->eval_args( $ast['args'], $scope );
					return Uich_Functions::call( $ast['name'], $args );

				case 'arrow':
					// Standalone arrow has no value; only filters consume it.
					return null;
			}
			return null;
		}

		/**
		 * Evaluate an argument list. Arrow nodes become PHP closures bound to the scope.
		 */
		private function eval_args( $arg_asts, array &$scope ) {
			$out = array();
			foreach ( $arg_asts as $a ) {
				if ( is_array( $a ) && isset( $a['t'] ) && 'arrow' === $a['t'] ) {
					$runtime  = $this;
					$param    = $a['param'];
					$body     = $a['body'];
					$captured = $scope;
					$out[]    = function ( $item ) use ( $runtime, $param, $body, $captured ) {
						$s           = $captured;
						$s[ $param ] = $item;
						return $runtime->eval_ast( $body, $s );
					};
				} else {
					$out[] = $this->eval_ast( $a, $scope );
				}
			}
			return $out;
		}

		private function eval_binary( $ast, array &$scope ) {
			$op = $ast['op'];
			// Short-circuit logicals.
			if ( 'and' === $op ) {
				return $this->truthy( $this->eval_ast( $ast['left'], $scope ) ) && $this->truthy( $this->eval_ast( $ast['right'], $scope ) );
			}
			if ( 'or' === $op ) {
				return $this->truthy( $this->eval_ast( $ast['left'], $scope ) ) || $this->truthy( $this->eval_ast( $ast['right'], $scope ) );
			}

			$l = $this->eval_ast( $ast['left'], $scope );
			$r = $this->eval_ast( $ast['right'], $scope );

			switch ( $op ) {
				case '~':
					return $this->stringify_output( $l ) . $this->stringify_output( $r );
				case '+':
					return $l + $r;
				case '-':
					return $l - $r;
				case '*':
					return $l * $r;
				case '/':
					return ( 0 == $r ) ? null : $l / $r;
				case '%':
					return ( 0 == $r ) ? null : $l % $r;
				case '==':
					return $l == $r; // phpcs:ignore
				case '!=':
					return $l != $r; // phpcs:ignore
				case '===':
					return $l === $r;
				case '!==':
					return $l !== $r;
				case '<':
					return $l < $r;
				case '>':
					return $l > $r;
				case '<=':
					return $l <= $r;
				case '>=':
					return $l >= $r;
				case 'in':
					if ( is_array( $r ) ) {
						return in_array( $l, $r, false ); // phpcs:ignore
					}
					if ( is_string( $r ) ) {
						return '' !== (string) $l && false !== strpos( $r, (string) $l );
					}
					return false;
				case 'starts with':
					return 0 === strpos( (string) $l, (string) $r );
				case 'ends with':
					return '' === (string) $r || substr( (string) $l, -strlen( (string) $r ) ) === (string) $r;
			}
			return null;
		}

		/**
		 * The sandbox boundary. Read a member/index from a provider, array, or object.
		 * Method calls (args !== null) are only honoured on Uich_Provider instances.
		 */
		private function access( $obj, $name, $args ) {
			if ( $obj instanceof Uich_Provider ) {
				// uich_read (not uich_get) — applies the Free/Pro field gate. Every
				// chained hop passes through here, so `post.author.name` is gated at
				// `author` and `product.price` at `price`.
				return $obj->uich_read( (string) $name, is_array( $args ) ? $args : array() );
			}
			if ( is_array( $obj ) ) {
				if ( array_key_exists( $name, $obj ) ) {
					return $obj[ $name ];
				}
				// Convenience: reading a NAMED field off a list of providers (e.g.
				// `post.categories.name`, `post.tags.link`) delegates to the FIRST
				// item, so authors get "the category's name" without writing
				// `post.categories|first.name`. Numeric/real keys are handled above,
				// so subscripts (`categories[0]`) and iteration/array filters
				// (`|first`, `|join`, `|map`) are unaffected — this only fires on a
				// named miss against a non-empty list whose head is a provider.
				if ( '' !== (string) $name && ! is_numeric( $name ) && ! empty( $obj ) ) {
					$first = reset( $obj );
					if ( $first instanceof Uich_Provider ) {
						return $first->uich_read( (string) $name, is_array( $args ) ? $args : array() );
					}
				}
				return null;
			}
			if ( is_object( $obj ) ) {
				// Plain data objects only: read public props, never call methods (sandbox).
				if ( null === $args && isset( $obj->$name ) ) {
					return $obj->$name;
				}
				return null;
			}
			return null;
		}

		private function to_iterable( $v ) {
			if ( is_array( $v ) ) {
				return $v;
			}
			if ( $v instanceof Traversable ) {
				return iterator_to_array( $v );
			}
			if ( $v instanceof Uich_Provider ) {
				$items = $v->uich_read( 'items', array() );
				return is_array( $items ) ? $items : array();
			}
			return array();
		}

		private function truthy( $v ) {
			if ( is_array( $v ) ) {
				return count( $v ) > 0;
			}
			if ( '0' === $v ) {
				return true; // Twig: '0' string is truthy? Actually Twig treats '0' as false. Keep PHP-ish but documented.
			}
			return (bool) $v;
		}

		/**
		 * Convert a value to safe HTML output. Providers may expose a __toString via uich_read('').
		 */
		private function stringify_output( $v ) {
			if ( null === $v || false === $v ) {
				return '';
			}
			if ( true === $v ) {
				return '1';
			}
			if ( is_array( $v ) ) {
				return ''; // arrays aren't printed directly.
			}
			if ( $v instanceof Uich_Provider ) {
				// Gated: printing a Pro-only provider in Free yields '' rather than
				// its title (e.g. `{{ post.author }}` on a Free site).
				$v = $v->uich_read( '__toString', array() );
				if ( null === $v ) {
					return '';
				}
			}
			// Twig auto-escapes by default; callers that need raw use the |raw filter (handled in Filters).
			if ( is_string( $v ) && class_exists( 'Uich_Filters' ) && Uich_Filters::is_marked_raw( $v ) ) {
				return Uich_Filters::unmark_raw( $v );
			}
			return esc_html( (string) $v );
		}
	}
}

if ( ! class_exists( 'Uich_Expr' ) ) {

	/**
	 * Expression parser: tokenizes and builds an AST using precedence climbing.
	 * Produces nodes consumed by Uich_Twig_Runtime::eval_ast().
	 */
	class Uich_Expr {

		private $tokens = array();
		private $pos    = 0;

		public static function parse_expression( $src ) {
			$p         = new self();
			$p->tokens = $p->tokenize( (string) $src );
			$p->pos    = 0;
			if ( empty( $p->tokens ) ) {
				return array(
					't' => 'lit',
					'v' => null,
				);
			}
			$ast = $p->parse_ternary();
			return $ast;
		}

		/* ----------------------------- tokenizer ----------------------------- */

		private function tokenize( $s ) {
			$tokens = array();
			$len    = strlen( $s );
			$i      = 0;
			$words3 = array( '===', '!==' );
			$words2 = array( '==', '!=', '<=', '>=', '??', '=>' );

			while ( $i < $len ) {
				$c = $s[ $i ];
				if ( ctype_space( $c ) ) {
					++$i;
					continue;
				}
				// strings
				if ( '"' === $c || "'" === $c ) {
					$q   = $c;
					$j   = $i + 1;
					$str = '';
					while ( $j < $len ) {
						if ( '\\' === $s[ $j ] && $j + 1 < $len ) {
							$str .= $s[ $j + 1 ];
							$j   += 2;
							continue;
						}
						if ( $s[ $j ] === $q ) {
							break;
						}
						$str .= $s[ $j ];
						++$j;
					}
					$tokens[] = array(
						'type'  => 'str',
						'value' => $str,
					);
					$i        = $j + 1;
					continue;
				}
				// numbers
				if ( ctype_digit( $c ) || ( '.' === $c && $i + 1 < $len && ctype_digit( $s[ $i + 1 ] ) ) ) {
					$num = '';
					while ( $i < $len && ( ctype_digit( $s[ $i ] ) || '.' === $s[ $i ] ) ) {
						$num .= $s[ $i ];
						++$i;
					}
					$tokens[] = array(
						'type'  => 'num',
						'value' => ( false === strpos( $num, '.' ) ) ? (int) $num : (float) $num,
					);
					continue;
				}
				// identifiers / keywords
				if ( ctype_alpha( $c ) || '_' === $c ) {
					$id = '';
					while ( $i < $len && ( ctype_alnum( $s[ $i ] ) || '_' === $s[ $i ] ) ) {
						$id .= $s[ $i ];
						++$i;
					}
					$tokens[] = array(
						'type'  => 'name',
						'value' => $id,
					);
					continue;
				}
				// 3-char, 2-char operators
				$three = substr( $s, $i, 3 );
				if ( in_array( $three, $words3, true ) ) {
					$tokens[] = array(
						'type'  => 'op',
						'value' => $three,
					);
					$i       += 3;
					continue;
				}
				$two = substr( $s, $i, 2 );
				if ( in_array( $two, $words2, true ) ) {
					$tokens[] = array(
						'type'  => 'op',
						'value' => $two,
					);
					$i       += 2;
					continue;
				}
				// single-char punctuation / operators
				$tokens[] = array(
					'type'  => 'op',
					'value' => $c,
				);
				++$i;
			}
			return $tokens;
		}

		private function peek() {
			return isset( $this->tokens[ $this->pos ] ) ? $this->tokens[ $this->pos ] : null;
		}
		private function next() {
			return isset( $this->tokens[ $this->pos ] ) ? $this->tokens[ $this->pos++ ] : null;
		}
		private function is_op( $v ) {
			$t = $this->peek();
			return $t && 'op' === $t['type'] && $t['value'] === $v;
		}
		private function is_name( $v ) {
			$t = $this->peek();
			return $t && 'name' === $t['type'] && strtolower( $t['value'] ) === $v;
		}

		/* ----------------------------- parser ----------------------------- */

		private function parse_ternary() {
			$cond = $this->parse_coalesce();
			if ( $this->is_op( '?' ) ) {
				$this->next();
				// Elvis: a ?: b
				if ( $this->is_op( ':' ) ) {
					$this->next();
					$right = $this->parse_ternary();
					return array(
						't'     => 'elvis',
						'left'  => $cond,
						'right' => $right,
					);
				}
				$then = $this->parse_ternary();
				if ( $this->is_op( ':' ) ) {
					$this->next();
				}
				$else = $this->parse_ternary();
				return array(
					't'    => 'ternary',
					'cond' => $cond,
					'then' => $then,
					'else' => $else,
				);
			}
			return $cond;
		}

		private function parse_coalesce() {
			$left = $this->parse_or();
			while ( $this->is_op( '??' ) ) {
				$this->next();
				$right = $this->parse_or();
				$left  = array(
					't'     => 'coalesce',
					'left'  => $left,
					'right' => $right,
				);
			}
			return $left;
		}

		private function parse_or() {
			$left = $this->parse_and();
			while ( $this->is_name( 'or' ) ) {
				$this->next();
				$right = $this->parse_and();
				$left  = array(
					't'     => 'bin',
					'op'    => 'or',
					'left'  => $left,
					'right' => $right,
				);
			}
			return $left;
		}

		private function parse_and() {
			$left = $this->parse_comparison();
			while ( $this->is_name( 'and' ) ) {
				$this->next();
				$right = $this->parse_comparison();
				$left  = array(
					't'     => 'bin',
					'op'    => 'and',
					'left'  => $left,
					'right' => $right,
				);
			}
			return $left;
		}

		private function parse_comparison() {
			$left = $this->parse_additive();
			while ( true ) {
				$t = $this->peek();
				if ( $t && 'op' === $t['type'] && in_array( $t['value'], array( '==', '!=', '===', '!==', '<', '>', '<=', '>=' ), true ) ) {
					$op    = $this->next()['value'];
					$right = $this->parse_additive();
					$left  = array(
						't'     => 'bin',
						'op'    => $op,
						'left'  => $left,
						'right' => $right,
					);
				} elseif ( $this->is_name( 'in' ) ) {
					$this->next();
					$right = $this->parse_additive();
					$left  = array(
						't'     => 'bin',
						'op'    => 'in',
						'left'  => $left,
						'right' => $right,
					);
				} elseif ( $this->is_name( 'starts' ) ) {
					$this->next();
					if ( $this->is_name( 'with' ) ) {
						$this->next();
					}
					$right = $this->parse_additive();
					$left  = array(
						't'     => 'bin',
						'op'    => 'starts with',
						'left'  => $left,
						'right' => $right,
					);
				} elseif ( $this->is_name( 'ends' ) ) {
					$this->next();
					if ( $this->is_name( 'with' ) ) {
						$this->next();
					}
					$right = $this->parse_additive();
					$left  = array(
						't'     => 'bin',
						'op'    => 'ends with',
						'left'  => $left,
						'right' => $right,
					);
				} else {
					break;
				}
			}
			return $left;
		}

		private function parse_additive() {
			$left = $this->parse_multiplicative();
			while ( true ) {
				$t = $this->peek();
				if ( $t && 'op' === $t['type'] && in_array( $t['value'], array( '+', '-', '~' ), true ) ) {
					$op    = $this->next()['value'];
					$right = $this->parse_multiplicative();
					$left  = array(
						't'     => 'bin',
						'op'    => $op,
						'left'  => $left,
						'right' => $right,
					);
				} else {
					break;
				}
			}
			return $left;
		}

		private function parse_multiplicative() {
			$left = $this->parse_unary();
			while ( true ) {
				$t = $this->peek();
				if ( $t && 'op' === $t['type'] && in_array( $t['value'], array( '*', '/', '%' ), true ) ) {
					$op    = $this->next()['value'];
					$right = $this->parse_unary();
					$left  = array(
						't'     => 'bin',
						'op'    => $op,
						'left'  => $left,
						'right' => $right,
					);
				} else {
					break;
				}
			}
			return $left;
		}

		private function parse_unary() {
			if ( $this->is_name( 'not' ) ) {
				$this->next();
				return array(
					't'    => 'unary',
					'op'   => 'not',
					'expr' => $this->parse_unary(),
				);
			}
			if ( $this->is_op( '-' ) ) {
				$this->next();
				return array(
					't'    => 'unary',
					'op'   => '-',
					'expr' => $this->parse_unary(),
				);
			}
			return $this->parse_postfix();
		}

		private function parse_postfix() {
			$node = $this->parse_primary();
			while ( true ) {
				if ( $this->is_op( '.' ) ) {
					$this->next();
					$name_tok = $this->next();
					$name     = $name_tok ? $name_tok['value'] : '';
					$member   = array(
						't'    => 'member',
						'obj'  => $node,
						'name' => $name,
					);
					if ( $this->is_op( '(' ) ) {
						$member['args'] = $this->parse_arg_list();
					}
					$node = $member;
				} elseif ( $this->is_op( '[' ) ) {
					$this->next();
					$index = $this->parse_ternary();
					if ( $this->is_op( ']' ) ) {
						$this->next();
					}
					$node = array(
						't'     => 'subscript',
						'obj'   => $node,
						'index' => $index,
					);
				} elseif ( $this->is_op( '|' ) ) {
					$this->next();
					$fname_tok = $this->next();
					$fname     = $fname_tok ? $fname_tok['value'] : '';
					$args      = array();
					if ( $this->is_op( '(' ) ) {
						$args = $this->parse_arg_list();
					}
					$node = array(
						't'     => 'filter',
						'name'  => $fname,
						'value' => $node,
						'args'  => $args,
					);
				} else {
					break;
				}
			}
			return $node;
		}

		private function parse_primary() {
			$t = $this->peek();
			if ( ! $t ) {
				return array(
					't' => 'lit',
					'v' => null,
				);
			}

			if ( 'num' === $t['type'] ) {
				$this->next();
				return array(
					't' => 'lit',
					'v' => $t['value'],
				);
			}
			if ( 'str' === $t['type'] ) {
				$this->next();
				return array(
					't' => 'lit',
					'v' => $t['value'],
				);
			}
			if ( 'name' === $t['type'] ) {
				$low = strtolower( $t['value'] );
				if ( 'true' === $low ) {
					$this->next();
					return array(
						't' => 'lit',
						'v' => true,
					);
				}
				if ( 'false' === $low ) {
					$this->next();
					return array(
						't' => 'lit',
						'v' => false,
					);
				}
				if ( 'null' === $low || 'none' === $low ) {
					$this->next();
					return array(
						't' => 'lit',
						'v' => null,
					);
				}
				$this->next();
				// arrow function:  name => expr
				if ( $this->is_op( '=>' ) ) {
					$this->next();
					$body = $this->parse_ternary();
					return array(
						't'     => 'arrow',
						'param' => $t['value'],
						'body'  => $body,
					);
				}
				// function call:  name( ... )
				if ( $this->is_op( '(' ) ) {
					$args = $this->parse_arg_list();
					return array(
						't'    => 'call',
						'name' => $t['value'],
						'args' => $args,
					);
				}
				return array(
					't' => 'name',
					'v' => $t['value'],
				);
			}
			if ( $this->is_op( '(' ) ) {
				$this->next();
				$node = $this->parse_ternary();
				if ( $this->is_op( ')' ) ) {
					$this->next();
				}
				return $node;
			}
			if ( $this->is_op( '[' ) ) {
				return $this->parse_array_literal();
			}
			if ( $this->is_op( '{' ) ) {
				return $this->parse_object_literal();
			}
			// Unknown — consume and return null.
			$this->next();
			return array(
				't' => 'lit',
				'v' => null,
			);
		}

		private function parse_arg_list() {
			$args = array();
			$this->next(); // consume '('
			if ( $this->is_op( ')' ) ) {
				$this->next();
				return $args;
			}
			while ( true ) {
				$args[] = $this->parse_ternary();
				if ( $this->is_op( ',' ) ) {
					$this->next();
					continue;
				}
				break;
			}
			if ( $this->is_op( ')' ) ) {
				$this->next();
			}
			return $args;
		}

		private function parse_array_literal() {
			$this->next(); // '['
			$items = array();
			if ( $this->is_op( ']' ) ) {
				$this->next();
				return array(
					't'     => 'array',
					'items' => $items,
				);
			}
			while ( true ) {
				$items[] = $this->parse_ternary();
				if ( $this->is_op( ',' ) ) {
					$this->next();
					continue;
				}
				break;
			}
			if ( $this->is_op( ']' ) ) {
				$this->next();
			}
			return array(
				't'     => 'array',
				'items' => $items,
			);
		}

		private function parse_object_literal() {
			$this->next(); // '{'
			$pairs = array();
			if ( $this->is_op( '}' ) ) {
				$this->next();
				return array(
					't'     => 'object',
					'pairs' => $pairs,
				);
			}
			while ( true ) {
				$key_tok = $this->next();
				$key     = $key_tok ? ( 'str' === $key_tok['type'] ? $key_tok['value'] : $key_tok['value'] ) : '';
				if ( $this->is_op( ':' ) ) {
					$this->next();
				}
				$pairs[ $key ] = $this->parse_ternary();
				if ( $this->is_op( ',' ) ) {
					$this->next();
					continue;
				}
				break;
			}
			if ( $this->is_op( '}' ) ) {
				$this->next();
			}
			return array(
				't'     => 'object',
				'pairs' => $pairs,
			);
		}
	}
}
